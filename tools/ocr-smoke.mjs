import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ocr = require('../packages/native/ocr/index.js');
const { decodePng } = await import('./lib/png.mjs');

const file = process.argv[2] || 'H:/Arcgxapp-ref/captures/inventario-01.png';
const rx = Number(process.argv[3] ?? 0);
const ry = Number(process.argv[4] ?? 0);
const rw = Number(process.argv[5] ?? 0);
const rh = Number(process.argv[6] ?? 0);

const img = decodePng(fs.readFileSync(file));
const W = img.width;
const H = img.height;
const x = rx || 0;
const y = ry || 0;
const w = rw || W;
const h = rh || H;

console.log('\n== OCR (Windows.Media.Ocr) ==\n');
console.log(`  arquivo : ${file.split('/').pop()}`);
console.log(`  recorte : ${x},${y} ${w}x${h}`);
console.log(`  suporte : ${JSON.stringify(ocr.ocrSupport())}\n`);

// BGRA, sem padding — é o que o addon espera e o que o wgc-capture entrega.
const bgra = Buffer.allocUnsafe(w * h * 4);
for (let row = 0; row < h; row++) {
  for (let col = 0; col < w; col++) {
    const s = ((y + row) * W + (x + col)) * 4;
    const d = (row * w + col) * 4;
    bgra[d] = img.data[s + 2];
    bgra[d + 1] = img.data[s + 1];
    bgra[d + 2] = img.data[s];
    bgra[d + 3] = 255;
  }
}

let t0 = Date.now();
const r = ocr.recognize(bgra, w, h);
const wall = Date.now() - t0;

if (!r) {
  console.log('  devolveu null\n');
} else {
  console.log(`  ${r.words.length} palavras em ${r.ms.toFixed(1)} ms (parede: ${wall} ms)\n`);
  const lines = new Map();
  for (const word of r.words) {
    const key = Math.round(word.y / 14);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(word);
  }
  for (const [, words] of [...lines.entries()].sort((a, b) => a[0] - b[0])) {
    words.sort((a, b) => a.x - b.x);
    const text = words.map((v) => v.text).join(' ');
    const box = words[0];
    console.log(
      `   y=${String(Math.round(box.y)).padStart(4)} x=${String(Math.round(box.x)).padStart(4)}  ${text}`,
    );
  }
}
console.log('');