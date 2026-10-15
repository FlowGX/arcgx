/**
 * Afina a ROI do BOLSO SEGURO.
 *
 * ## ## ## O sintoma
 *
 * O jogo escreve `0/3` e o Tesseract devolve `00/3`. Nao e erro de digito: e
 * um caractere **antes** do numero sendo lido como `0`. A capacidade e 3
 * (3 slots, em `apps/main/src/scan/panels.ts`) e `00/3` nao bate com a grade,
 * o que e a unica checagem de sanidade disponivel aqui.
 *
 * A ROI comeca em x=1600, e o nome do painel vem antes. Entra um pedaco do
 * texto anterior e o motor junta. Deslocar para a direita until o caractere
 * fantasma sumir — sem cortar o primeiro digito de verdade.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createWorker, PSM } from 'tesseract.js';

import { rgbaParaPng } from './lib/png.mjs';

const require = createRequire(import.meta.url);
const cap = require('@arcgx/wgc-capture');

const RAIZ = 'H:/Arcgxapp';
const args = process.argv.slice(2);
const frame = args[0];
if (!frame) {
  console.error('uso: node afinar-bolso.mjs <frame.raw>');
  process.exit(1);
}

const raw = new Uint8Array(readFileSync(frame));
const f = { width: 1920, height: 1080, data: raw };

function crop(x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const s = ((y + yy) * f.width + x + xx) * 4;
      const d = (yy * w + xx) * 4;
      out[d] = f.data[s + 2];
      out[d + 1] = f.data[s + 1];
      out[d + 2] = f.data[s];
      out[d + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

const worker = await createWorker('eng', 1, {
  langPath: `${RAIZ}/apps/main/resources/ocr`,
  cacheMethod: 'none',
  logger: () => {},
});
await worker.setParameters({
  tessedit_char_whitelist: '0123456789/.,',
  tessedit_pageseg_mode: PSM.SINGLE_LINE,
});

console.log(`frame: ${frame}`);
console.log('\nvarredura de x (y=666, h=30):');
for (const x of [1570, 1585, 1600, 1615, 1630, 1645, 1660, 1675]) {
  const img = crop(x, 666, 110, 30);
  const { data } = await worker.recognize(rgbaParaPng(img.data, img.width, img.height));
  const txt = (data.text ?? '').trim().replace(/\s+/g, '');
  console.log(`  x=${x}  "${txt}"  conf=${(data.confidence ?? 0).toFixed(0)}`);
}

console.log('\nvarredura de y (x=1615, w=110):');
for (const y of [650, 658, 666, 674, 682, 690]) {
  const img = crop(1615, y, 110, 30);
  const { data } = await worker.recognize(rgbaParaPng(img.data, img.width, img.height));
  const txt = (data.text ?? '').trim().replace(/\s+/g, '');
  console.log(`  y=${y}  "${txt}"  conf=${(data.confidence ?? 0).toFixed(0)}`);
}

await worker.terminate();