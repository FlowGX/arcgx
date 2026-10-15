/**
 * Calibração da posição do ícone dentro da célula.
 *
 * ## O problema
 *
 * A assinatura remove a moldura da célula antes de comparar. Para a galeria
 * (ícone puro) ser comparável com a célula do jogo (ícone + borda + barra), o
 * ícone da galeria tem de ser montado **na mesma posição** que ocupa na célula.
 * Essa posição não é óbvia: a célula medida tem 96 px e o ícone aparece
 * deslocado para cima, porque embaixo dele fica a barra de quantidade.
 *
 * Adivinhar (`y=25, size=34` porque "parecia certo") é exatamente o que fez a
 * primeira tentativa casar 0 de 20. Aqui a posição é **medida**: varre-se a
 * geometria e vence a que produz o melhor casamento contra uma captura real.
 *
 * ## Métrica
 *
 * Não usa o limiar de confiança — usa a **média do melhor cosine** de cada
 * célula contra a galeria. Com o catálogo inteiro, um item errado ainda pode
 * dar cosine alto; a média de 20 células afasta oShip dos deltas grandes.
 *
 *   node tools/gallery/calibrate.mjs [--capture <png>] [--items <items.json>]
 *                                     [--sample 250]
 */

import { readFileSync } from 'node:fs';

import { S, decodePng, montarCelula, celulaParaBatch } from './build.mjs';

const G = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery.js');

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

/* ------------------------------------------------ geometria da captura */

const CAPTURE =
  arg('capture', 'H:/Arcgxapp-ref/captures/inventario-01.png');

/** Medido nas capturas reais: grade 4×5 com passo 104. */
const GRADE = { cols: 4, rows: 5, x0: 152, y0: 367, passo: 104 };

function extrairCelulas(img) {
  const celulas = [];
  for (let r = 0; r < GRADE.rows; r++) {
    for (let c = 0; c < GRADE.cols; c++) {
      const cx = GRADE.x0 + c * GRADE.passo;
      const cy = GRADE.y0 + r * GRADE.passo;
      const rgb = Buffer.alloc(S * S * 3);
      const px = img.canais === 4 ? 4 : 3;
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
      celulas.push(celulaParaBatch(rgb));
    }
  }
  return celulas;
}

/* ------------------------------------------------------------- utilidades */

const cosine = (a, b) => {
  let s = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
};

async function comConc(alvos, conc) {
  let i = 0;
  const out = [];
  await Promise.all(
    Array.from({ length: conc }, async () => {
      for (;;) {
        const k = i++;
        if (k >= alvos.length) return;
        const it = alvos[k];
        try {
          const r = await fetch(it.imageFilename);
          if (!r.ok) throw new Error('http');
          out.push([it.id, decodePng(Buffer.from(await r.arrayBuffer()))]);
        } catch {
          /* arte fora do ar: segue */
        }
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ run */

const captura = decodePng(readFileSync(CAPTURE));
console.log(`captura ${CAPTURE.split('/').pop()}: ${captura.w}x${captura.h}`);

const celulas = extrairCelulas(captura);
console.log(`células extraídas: ${celulas.length}`);

const assinaturasCelula = celulas.map((b) => G.signatureFromBatch(b, S, 0, G.GALLERY_GRID));

const itens = JSON.parse(readFileSync(arg('items', 'H:/Arcgxapp/dados/game/items.json'), 'utf8')).items;
const amostra = Object.values(itens).filter((i) => i.imageFilename);
const N = Number(arg('sample', '250'));
// amostra espaçada: os primeiros N do catálogo podem ser só materiais
const passoAmostra = Math.max(1, Math.floor(amostra.length / N));
const sub = amostra.filter((_, k) => k % passoAmostra === 0).slice(0, N);

console.log(`galeria de teste: ${sub.length} itens\n`);

const arte = await comConc(sub, 8);
console.log(`artes baixadas: ${arte.length}\n`);

const CANDIDATOS = [];
for (const y of [13, 16, 19, 22, 25, 28]) {
  for (const size of [34, 40, 43, 46, 49, 52, 56, 60]) {
    CANDIDATOS.push({ x: Math.round((S - size) / 2), y, size });
  }
}
console.log(`geometrias a testar: ${CANDIDATOS.length}\n`);
console.log('   y  size   media   max   acima de 0.90');

let melhor = null;
for (const geo of CANDIDATOS) {
  const gal = [];
  for (const [id, img] of arte) {
    const batch = celulaParaBatch(montarCelula(img, geo));
    gal.push(G.signatureFromBatch(batch, S, 0, G.GALLERY_GRID));
  }

  let soma = 0;
  let max = 0;
  let acima = 0;
  for (const sig of assinaturasCelula) {
    let best = 0;
    for (const g of gal) {
      const c = cosine(sig, g);
      if (c > best) best = c;
    }
    soma += best;
    if (best > max) max = best;
    if (best > 0.9) acima++;
  }
  const media = soma / assinaturasCelula.length;
  const linha = `  ${String(geo.y).padStart(3)}  ${String(geo.size).padStart(4)}   ${media.toFixed(4)}  ${max.toFixed(3)}   ${acima}/${assinaturasCelula.length}`;
  console.log(linha);
  if (!melhor || media > melhor.media) melhor = { geo, media, max, acima };
}

console.log('\n--- melhor geometria ---');
console.log(JSON.stringify(melhor, null, 2));
