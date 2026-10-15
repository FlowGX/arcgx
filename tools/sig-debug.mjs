import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { signatureFromBatch } = await import('../packages/shared/dist/gallery.js');
const vision = require('../packages/native/cell-vision/index.js');
const { decodePng } = await import('./lib/png.mjs');

const img = decodePng(fs.readFileSync('H:/Arcgxapp-ref/captures/inventario-01.png'));
const { width: W, height: H, data } = img;
const bgra = Buffer.allocUnsafe(data.length);
for (let i = 0; i < data.length; i += 4) {
  bgra[i] = data[i + 2]; bgra[i + 1] = data[i + 1]; bgra[i + 2] = data[i]; bgra[i + 3] = 255;
}
const b = vision.prepareClassifierBatch(bgra, W, H, { x: 152, y: 367, width: 416, height: 624 }, 96);
console.log('cellSize:', b.cellSize, ' cells:', b.cells.length, ' data:', b.data.length, ' esperado:', b.cells.length * 3 * 96 * 96);

const s0 = signatureFromBatch(b.data, b.cellSize, 0);
const s1 = signatureFromBatch(b.data, b.cellSize, 0, 12, { top: 0.135, side: 0.06 });
const s2 = signatureFromBatch(b.data, b.cellSize, 0, 12, 0.12);
const s3 = signatureFromBatch(b.data, b.cellSize, 0, 12, 0);

function cos(a, b2) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] || 0, y = b2[i] || 0; d += x * y; na += x * x; nb += y * y; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
console.log('cos(default, {top,side}) =', cos(s0, s1).toFixed(6));
console.log('cos(default, 0.12)        =', cos(s0, s2).toFixed(6));
console.log('cos(default, 0)           =', cos(s0, s3).toFixed(6));
console.log('default   [0..5]:', Array.from(s0.slice(0, 6)).map((x) => x.toFixed(3)).join(', '));
console.log('top/side  [0..5]:', Array.from(s1.slice(0, 6)).map((x) => x.toFixed(3)).join(', '));
console.log('sem inset [0..5]:', Array.from(s3.slice(0, 6)).map((x) => x.toFixed(3)).join(', '));