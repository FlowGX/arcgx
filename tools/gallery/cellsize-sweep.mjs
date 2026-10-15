/**
 * O tamanho do batch é o gargalo, não a assinatura.
 *
 * A célula tem 91×91 px. O `worker-runtime.ts` pede `cellSize=12`, então o Rust
 * reamostra para 12×12 e entrega **144 pixels** por célula para uma
 * assinatura de 432 dimensões. Nenhuma assinatura recupera o que não chegou
 * até ela — foi por isso que a troca por dHash deu margem melhor mas o teto
 * continuou baixo.
 *
 * Este script mede o teto em função do `cellSize`.
 */

import { readFileSync } from 'node:fs';

import { S, decodePng, montarCelula, reamostrarBilinear } from './build.mjs';

const G = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery.js');
const M = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery-multi.js');

const CELULAS = [];
for (let r = 0; r < 5; r++)
  for (let c = 0; c < 4; c++)
    CELULAS.push({ x: [154, 257, 361, 465][c], y: [378, 482, 586, 690, 794][r], w: 91, h: 91 });

const img = decodePng(readFileSync('H:/Arcgxapp-ref/captures/inventario-01.png'));
const px = img.canais === 4 ? 4 : 3;

const recorte = (c) => {
  const rgb = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) {
    const sy = c.y + y;
    if (sy < 0 || sy >= img.h) continue;
    for (let x = 0; x < S; x++) {
      const sx = c.x + x;
      if (sx < 0 || sx >= img.w) continue;
      const p = (sy * img.w + sx) * px;
      const d = (y * S + x) * 3;
      rgb[d] = img.data[p];
      rgb[d + 1] = img.data[p + 1];
      rgb[d + 2] = img.data[p + 2];
    }
  }
  return rgb;
};

const celulasRGB = CELULAS.map(recorte);

const itens = JSON.parse(readFileSync('H:/Arcgxapp/dados/game/items.json', 'utf8')).items;
const alvos = Object.values(itens).filter((i) => i.imageFilename);
console.log(`baixando arte de ${alvos.length} itens...`);
const arte = [];
{
  let i = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      for (;;) {
        const k = i++;
        if (k >= alvos.length) return;
        const it = alvos[k];
        try {
          const r = await fetch(it.imageFilename);
          if (!r.ok) throw new Error('http');
          arte.push(decodePng(Buffer.from(await r.arrayBuffer())));
        } catch {
          /* segue */
        }
      }
    }),
  );
}
console.log(`artes: ${arte.length}\n`);

const GEO = { x: 19, y: 16, size: 58 };

console.log('cellSize  px/celula  nota_media  margem_media  aceitas(.70/.01)');
console.log('-'.repeat(70));

for (const cellSize of [12, 16, 24, 32, 48, 64, 96]) {
  const sigs = celulasRGB.map((rgb) =>
    M.signatureFromBatchMulti(reamostrarBilinear(rgb, cellSize), cellSize, 0),
  );
  const gal = arte.map((im) =>
    M.signatureFromBatchMulti(
      reamostrarBilinear(montarCelula(im, GEO), cellSize),
      cellSize,
      0,
    ),
  );

  let somaNota = 0;
  let somaMargem = 0;
  let aceitas = 0;
  for (const sig of sigs) {
    let a = -1;
    let b = -1;
    for (const g of gal) {
      const c = G.cosine(sig, g);
      if (c > a) {
        b = a;
        a = c;
      } else if (c > b) b = c;
    }
    const m = a - (b < 0 ? 0 : b);
    somaNota += a;
    somaMargem += m;
    if (a >= 0.7 && m >= 0.01) aceitas++;
  }

  const n = sigs.length;
  console.log(
    String(cellSize).padStart(8) +
      String(cellSize * cellSize).padStart(11) +
      (somaNota / n).toFixed(4).padStart(13) +
      (somaMargem / n).toFixed(4).padStart(14) +
      `${aceitas}/${n}`.padStart(20),
  );
}
