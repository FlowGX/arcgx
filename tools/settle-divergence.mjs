import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vision = require('../packages/native/cell-vision/index.js');
const { decodePng } = await import('./lib/png.mjs');
const { signatureFromBatch, normalizeSignature, GALLERY_GRID } = await import(
  '../packages/shared/dist/gallery.js'
);

const gallery = JSON.parse(fs.readFileSync('H:/Arcgxapp/models/gallery.json', 'utf8'));
const ids = Object.keys(gallery.items);
const vecs = ids.map((id) => {
  const bin = Buffer.from(gallery.items[id], 'base64');
  const v = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) v[i] = (bin[i] > 127 ? bin[i] - 256 : bin[i]) / 127;
  return v;
});
function cos(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    d += x * y; na += x * x; nb += y * y;
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
function bestTwo(sig) {
  let best = -Infinity, second = -Infinity, bi = 0;
  for (let i = 0; i < vecs.length; i++) {
    const s = cos(sig, vecs[i]);
    if (s > best) { second = best; best = s; bi = i; }
    else if (s > second) second = s;
  }
  return { best, second, id: ids[bi] };
}

/** Mesma geometria da lib, escrita aqui do zero. */
function mine(batch, size, index, top = 0.135, side = 0.06) {
  const grid = GALLERY_GRID;
  const plane = size * size;
  const base = index * 3 * plane;
  const padTop = Math.floor(size * top);
  const padSide = Math.floor(size * side);
  const innerW = Math.max(2, size - 2 * padSide);
  const innerH = Math.max(2, size - padTop - padSide);
  const out = new Float32Array(grid * grid * 3);
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      let r = 0, g = 0, b = 0, n = 0;
      const x0 = padSide + Math.floor((gx * innerW) / grid);
      const y0 = padTop + Math.floor((gy * innerH) / grid);
      const x1 = Math.min(size, padSide + Math.ceil(((gx + 1) * innerW) / grid));
      const y1 = Math.min(size, padTop + Math.ceil(((gy + 1) * innerH) / grid));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * size + x;
          r += batch[base + p] ?? 0;
          g += batch[base + plane + p] ?? 0;
          b += batch[base + 2 * plane + p] ?? 0;
          n++;
        }
      }
      const o = (gy * grid + gx) * 3;
      out[o] = n ? (r / n) * 255 : 255;
      out[o + 1] = n ? (g / n) * 255 : 255;
      out[o + 2] = n ? (b / n) * 255 : 255;
    }
  }
  return normalizeSignature(out);
}

const img = decodePng(fs.readFileSync('H:/Arcgxapp-ref/captures/inventario-01.png'));
const { width: W, height: H, data } = img;
const bgra = Buffer.allocUnsafe(data.length);
for (let i = 0; i < data.length; i += 4) {
  bgra[i] = data[i + 2]; bgra[i + 1] = data[i + 1]; bgra[i + 2] = data[i]; bgra[i + 3] = 255;
}
const SIZE = 96;
const b = vision.prepareClassifierBatch(bgra, W, H, { x: 152, y: 367, width: 416, height: 624 }, SIZE);

console.log('\n== a lib e a reimplementacao dao o mesmo? ==\n');
let same = 0;
for (let i = 0; i < 5; i++) {
  const a = signatureFromBatch(b.data, SIZE, i, GALLERY_GRID);
  const c = mine(b.data, SIZE, i);
  const d = cos(a, c);
  if (d > 0.999) same++;
  console.log(`  cel ${i}: cos = ${d.toFixed(6)}   (1.000000 = identicas)`);
}
console.log(`\n  identicas: ${same}/5\n`);

console.log('== e o casamento com a galeria? ==\n');
for (let i = 0; i < 5; i++) {
  const lib = bestTwo(signatureFromBatch(b.data, SIZE, i, GALLERY_GRID));
  const own = bestTwo(mine(b.data, SIZE, i));
  console.log(
    `  cel ${i}:  lib ${lib.best.toFixed(3)} (2o ${lib.second.toFixed(3)}) ${lib.id.padEnd(22)}` +
    ` |  minha ${own.best.toFixed(3)} (2o ${own.second.toFixed(3)}) ${own.id}`,
  );
}
console.log('');