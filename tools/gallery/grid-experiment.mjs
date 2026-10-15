/**
 * Experimento: resolução da assinatura.
 *
 * O classificador já acerta o registro (20/20 acima de 0,90), mas as margens
 * são minúsculas — primeiro e segundo colocados empatam, e o `minMargin` do
 * matcher rejeita tudo. A causa provável é a grade: 12×12×3 = 432 números
 * sobre uma região de ~79×75 px dá blocos de 6×6, onde ícones diferentes ficam
 * quase iguais.
 *
 * Este script mede a grade contra uma galeria de teste e reporta **margem**,
 * que é a métrica que decide se o matcher aceita.
 *
 *   node tools/gallery/grid-experiment.mjs [--sample 300]
 */

import { readFileSync } from 'node:fs';

import { S, decodePng, montarCelula, celulaParaBatch } from './build.mjs';

const G = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery.js');

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const GEO = { x: 18, y: 16, size: 60 };
const GRADE = { cols: 4, rows: 5, x0: 152, y0: 367, passo: 104 };

const img = decodePng(readFileSync(arg('capture', 'H:/Arcgxapp-ref/captures/inventario-01.png')));

function celulas() {
  const px = img.canais === 4 ? 4 : 3;
  const out = [];
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
      out.push(celulaParaBatch(rgb));
    }
  }
  return out;
}

const batches = celulas();
const itens = JSON.parse(readFileSync(arg('items', 'H:/Arcgxapp/dados/game/items.json'), 'utf8')).items;
const todos = Object.values(itens).filter((i) => i.imageFilename);
const N = Number(arg('sample', '300'));
const passo = Math.max(1, Math.floor(todos.length / N));
const sub = todos.filter((_, k) => k % passo === 0).slice(0, N);

console.log(`células: ${batches.length} | galeria de teste: ${sub.length} itens\n`);

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
          /* arte fora do ar: segue */
        }
      }
    }),
  );
}
console.log(`artes baixadas: ${arte.length}\n`);

console.log('grade  dims   nota_media  margem_media  celulas aceitas (score>=0.90 e margem>=0.02)');
console.log('-'.repeat(84));

for (const grid of [12, 14, 16, 20, 24, 28]) {
  const gal = arte.map(([, im]) =>
    G.signatureFromBatch(celulaParaBatch(montarCelula(im, GEO)), S, 0, grid),
  );

  let somaNota = 0;
  let somaMargem = 0;
  let aceitas = 0;

  for (const b of batches) {
    const sig = G.signatureFromBatch(b, S, 0, grid);
    let a = -1;
    let b2 = -1;
    for (const g of gal) {
      const c = G.cosine(sig, g);
      if (c > a) {
        b2 = a;
        a = c;
      } else if (c > b2) b2 = c;
    }
    somaNota += a;
    somaMargem += a - (b2 < 0 ? 0 : b2);
    if (a >= 0.9 && a - (b2 < 0 ? 0 : b2) >= 0.02) aceitas++;
  }

  const n = batches.length;
  console.log(
    String(grid).padStart(5) +
      '  ' +
      `${grid * grid * 3}`.padEnd(6) +
      (somaNota / n).toFixed(4).padStart(10) +
      (somaMargem / n).toFixed(4).padStart(14) +
      `${aceitas}/${n}`.padStart(34),
  );
}
