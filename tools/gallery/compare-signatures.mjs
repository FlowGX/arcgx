/**
 * Compara a assinatura por grade com a multiescala, na captura real.
 *
 *   node tools/gallery/compare-signatures.mjs [captura.png]
 *
 * A métrica é a **margem** entre top-1 e top-2, não a nota. A nota já está
 * alta (0.90+) desde a galeria própria; o que reprova o casamento é o empate
 * com o segundo colocado. Se a margem não melhorar, a assinatura não está
 * separando ícones parecidos e trocar de limiar só aumenta o erro.
 */

import { readFileSync } from 'node:fs';

import { S, decodePng, montarCelula, celulaParaBatch } from 'file:///H:/Arcgxapp/tools/gallery/build.mjs';

const G = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery.js');
const M = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery-multi.js');

const CAPTURE = process.argv[2] ?? 'H:/Arcgxapp-ref/captures/inventario-01.png';
const GEO = { x: 18, y: 16, size: 60 };
const GRADE = { cols: 4, rows: 5, x0: 152, y0: 367, passo: 104 };

const img = decodePng(readFileSync(CAPTURE));
const px = img.canais === 4 ? 4 : 3;

/* células do jogo */
const batches = [];
for (let r = 0; r < GRADE.rows; r++) {
  for (let c = 0; c < GRADE.cols; c++) {
    const cx = GRADE.x0 + c * GRADE.passo;
    const cy = GRADE.y0 + r * GRADE.passo;
    const rgb = Buffer.alloc(S * S * 3);
    for (let y = 0; y < S; y++) {
      const sy = cy + y;
      if (sy < 0 || sy >= img.h) continue;
      for (let x = 0; x < S; x++) {
        const sx = cx + x;
        if (sx < 0 || sx >= img.w) continue;
        const p = (sy * img.w + sx) * px;
        const d = (y * S + x) * 3;
        rgb[d] = img.data[p];
        rgb[d + 1] = img.data[p + 1];
        rgb[d + 2] = img.data[p + 2];
      }
    }
    batches.push(celulaParaBatch(rgb));
  }
}

/* galeria de teste */
const itens = JSON.parse(readFileSync('H:/Arcgxapp/dados/game/items.json', 'utf8')).items;
const todos = Object.values(itens).filter((i) => i.imageFilename);
const passo = Math.max(1, Math.floor(todos.length / 400));
const sub = todos.filter((_, k) => k % passo === 0).slice(0, 400);

const arte = [];
{
  let i = 0;
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      for (;;) {
        const k = i++;
        if (k >= sub.length) return;
        const it = sub[k];
        try {
          const r = await fetch(it.imageFilename);
          if (!r.ok) throw new Error('http');
          arte.push([it.id, decodePng(Buffer.from(await r.arrayBuffer()))]);
        } catch {
          /* segue */
        }
      }
    }),
  );
}
console.log(`células: ${batches.length} | itens na galeria de teste: ${arte.length}\n`);

/**
 * Cada assinador é embrulhado numa função de UM argumento.
 *
 * `signatureFromBatch(batch, batchSize, index, grid)` e
 * `signatureFromBatchMulti(batch, batchSize, index)` precisam dos parâmetros de
 * posição. Passar só o batch deixa `batchSize` undefined, o laço não roda e
 * devolve vetor de zeros — o que produzia "nota média 1.0000" sem sentido.
 */
const porGrade = (b) => G.signatureFromBatch(b, S, 0, G.GALLERY_GRID);
const porMultiescala = (b) => M.signatureFromBatchMulti(b, S, 0);

function avaliar(nomeAssinatura, rotulo) {
  const gal = arte.map(([, im]) => nomeAssinatura(celulaParaBatch(montarCelula(im, GEO))));
  let somaNota = 0;
  let somaMargem = 0;
  let aceitas = 0;
  const linhas = [];

  for (const b of batches) {
    const sig = nomeAssinatura(b);
    let a = -1;
    let b2 = -1;
    let idA = '';
    for (let k = 0; k < gal.length; k++) {
      const c = G.cosine(sig, gal[k]);
      if (c > a) {
        b2 = a;
        a = c;
        idA = arte[k][0];
      } else if (c > b2) b2 = c;
    }
    const m = a - (b2 < 0 ? 0 : b2);
    somaNota += a;
    somaMargem += m;
    if (a >= 0.9 && m >= 0.02) aceitas++;
    linhas.push([idA, a, m]);
  }

  const n = batches.length;
  console.log(`--- ${rotulo} ---`);
  console.log('  nota media  :', (somaNota / n).toFixed(4));
  console.log('  margem media:', (somaMargem / n).toFixed(4));
  console.log('  aceitas     :', `${aceitas}/${n}`, '(nota>=0.90 e margem>=0.02)');
  return { linhas, media: somaMargem / n, aceitas };
}

const antigo = avaliar(porGrade, 'GRADE 12x12 (atual)');
console.log('');
const novo = avaliar(porMultiescala, 'MULTIESCALA (novo)');

/**
 * Limiar por métrica.
 *
 * A nota da assinatura antiga e da nova **nao sao comparaveis**: dHash e
 * invariante a brilho, entao a multiescala naturalmente tem nota mais baixa
 * (0,79 contra 0,94) mesmo sendo a melhor das duas em margem. Reprovado por
 * `nota >= 0.90`, o classificador novo nunca aceitaria nada — o limiar tem de
 * ser medido na escala da assinatura que ele vai usar.
 */
console.log('\n--- limiar por margem (nota alta nao discrimina) ---');
console.log('  limiar   aceita');
for (const lim of [0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05]) {
  const n = novo.linhas.filter(([, nota, margem]) => nota >= 0.7 && margem >= lim).length;
  const a = antigo.linhas.filter(([, nota, margem]) => nota >= 0.9 && margem >= lim).length;
  console.log(`  ${lim.toFixed(3)}    multiescala ${String(n).padStart(2)}/20   grade ${String(a).padStart(2)}/20`);
}

console.log('\n--- margem por celula (antigo -> novo) ---');
for (let i = 0; i < antigo.linhas.length; i++) {
  const a = antigo.linhas[i];
  const b = novo.linhas[i];
  console.log(
    `  ${String(i + 1).padStart(2)}  ${a[0].replace(/[-_]/g, ' ').slice(0, 26).padEnd(28)} ` +
      `${a[1].toFixed(3)}/${a[2].toFixed(4)}  ->  ${b[1].toFixed(3)}/${b[2].toFixed(4)}  ${b[2] > a[2] ? '+' : ''}`,
  );
}
