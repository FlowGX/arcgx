/**
 * Geometria da grade medida pelo detector, sem chute.
 *
 *   node tools/gallery/grid-geometry.mjs [captura.png]
 *
 * O classificador precisa da grade **real**. Assumir `{x0:152, y0:367, passo:104}`
 * produziu células 18/19/20 com similaridade 1.0000 entre si — a mesma imagem
 * contada três vezes, e por isso três "casamentos" idênticos que pareciam
 * acertos. Quem sabe a grade é o `cell-vision`, que já é validado.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { decodePng } from 'file:///H:/Arcgxapp/tools/lib/png.mjs';

const requireCjs = createRequire(import.meta.url);
const vision = requireCjs('H:/Arcgxapp/packages/native/cell-vision/index.js');

const file = process.argv[2] ?? 'H:/Arcgxapp-ref/captures/inventario-01.png';
const img = decodePng(readFileSync(file));

// `tools/lib/png.mjs` devolve `{ width, height, data }` — os campos têm outros
// nomes que o meu decodificador (`w`/`h`), e usar `img.w` dava NaN num
// Buffer.alloc, que era o erro na primeira tentativa.
console.log(`captura: ${file.split('/').pop()} ${img.width}x${img.height}\n`);

// o detector trabalha em BGRA
const w = img.width;
const h = img.height;
const bgra = Buffer.alloc(w * h * 4);
for (let i = 0; i < w * h; i++) {
  bgra[i * 4] = img.data[i * 3 + 2];
  bgra[i * 4 + 1] = img.data[i * 3 + 1];
  bgra[i * 4 + 2] = img.data[i * 3];
  bgra[i * 4 + 3] = 255;
}

console.log(`captura: ${file.split('/').pop()} ${w}x${h}\n`);

/**
 * Recorta a ROI num buffer próprio.
 *
 * É o que o worker faz antes de chamar o detector: passar o frame inteiro com
 * um ROI deslocado não é a mesma coisa, porque o detector projeta bandas na
 * altura/linha do buffer que recebe.
 */
function recortar(frame, W, x, y, rw, rh) {
  const out = Buffer.alloc(rw * rh * 4);
  for (let j = 0; j < rh; j++) {
    for (let i = 0; i < rw; i++) {
      const s = ((y + j) * W + (x + i)) * 4;
      const d = (j * rw + i) * 4;
      out[d] = frame[s];
      out[d + 1] = frame[s + 1];
      out[d + 2] = frame[s + 2];
      out[d + 3] = 255;
    }
  }
  return out;
}

const roi = { x: 152, y: 367, width: 416, height: 624 };
const region = recortar(bgra, w, roi.x, roi.y, roi.width, roi.height);

console.log('ROI ARMAZENAMENTO 152,367 416x624');
console.log('  recortada para', region.length / 4, 'px\n');

// o `cellSize` que o worker passa é o tamanho do LADO da amostra do batch.
// `12` é o que a linha de produção usa — sem ele o detector escolhe outro.
const cellSize = Number(process.argv[3] ?? 12);
const batch = vision.prepareClassifierBatch(
  region,
  roi.width,
  roi.height,
  { x: 0, y: 0, width: roi.width, height: roi.height },
  cellSize,
);

console.log(`  celulas detectadas: ${batch.cells.length}  (${batch.cols}x${batch.rows})`);
console.log(`  cellSize=${batch.cellSize}  ms=${batch.ms}\n`);

for (const c of batch.cells.slice(0, 24)) {
  console.log(
    `    #${String(c.index).padStart(2)}  x=${c.x} y=${c.y} ${c.width}x${c.height} conf=${c.confidence.toFixed(3)}`,
  );
}

const dups = [];
for (let i = 0; i < batch.cells.length; i++)
  for (let j = i + 1; j < batch.cells.length; j++) {
    if (batch.cells[i].x === batch.cells[j].x && batch.cells[i].y === batch.cells[j].y)
      dups.push(`${i}=${j}`);
  }
console.log(`\n  células com MESMA origem: ${dups.length}${dups.length ? ' -> ' + dups.join(' ') : ''}`);
