import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const requireCjs = createRequire(import.meta.url);
const { WorkerPool } = await import(
  pathToFileURL(path.resolve('H:/Arcgxapp/apps/workers/dist/pool.js')).href
);
const { decodePng } = await import('./lib/png.mjs');

const file = process.argv[2] || 'H:/Arcgxapp-ref/captures/inventario-01.png';
const ROI = { x: 152, y: 367, width: 416, height: 624 };

const img = decodePng(fs.readFileSync(file));
const W = img.width;
const H = img.height;

// BGRA — o que o wgc-capture entrega e o que o worker consome
const bgra = new Uint8Array(img.data.length);
for (let i = 0; i < img.data.length; i += 4) {
  bgra[i] = img.data[i + 2];
  bgra[i + 1] = img.data[i + 1];
  bgra[i + 2] = img.data[i];
  bgra[i + 3] = 255;
}

console.log('\n== worker: scan completo (visao + classificacao + OCR) ==\n');
console.log(`  captura : ${file.split('/').pop()}  ${W}x${H}`);
console.log(`  ROI     : ${ROI.x},${ROI.y} ${ROI.width}x${ROI.height}\n`);

const pool = new WorkerPool({
  kind: 'scan',
  modelsDir: 'H:/Arcgxapp/models',
});

const t0 = Date.now();
let r;
try {
  r = await pool.request({
    type: 'scan',
    frame: { width: W, height: H, pixels: bgra },
    roi: ROI,
    gridCols: 4,
    gridRows: 5,
  });
} catch (err) {
  console.log(`  FALHOU: ${err.message}`);
  process.exit(1);
}
const wall = Date.now() - t0;

console.log(`  total   : ${wall} ms (worker: ${r.ms.toFixed(1)} ms)\n`);
console.log(`  grade   : ${r.grid ? `${r.grid.cols}x${r.grid.rows}` : '—'}  fallback=${r.fallback}`);
console.log(`  celulas : ${r.cells.length}`);

const named = r.cells.filter((c) => c.itemId).length;
console.log(`  com item: ${named}/${r.cells.length}`);
// todas as células: é a distribuição de nota que define o limiar, e as 6
// primeiras não dizem nada sobre as outras 14.
// O retângulo vem junto porque a calibragem da galeria precisa recortar
// exatamente onde o worker recortou — Geometricamente os dois precisam ler
// a mesma região, e no detetor quem tem a verdade é ele.
for (const c of r.cells) {
  const g = c.geom ?? c.rect ?? c;
  console.log(
    `    cel ${String(c.index).padStart(2)}  ${String(c.itemId ?? '(desconhecido)').replace(/_/g, ' ').slice(0, 30).padEnd(32)} ${c.score.toFixed(4)}  x=${g.x} y=${g.y} ${g.width}x${g.height}`,
  );
}

console.log('');
if (!r.ocr) {
  console.log('  OCR     : ausente (addon nao carregou no worker)');
} else if (r.ocr.unavailable) {
  console.log(`  OCR     : indisponivel — ${r.ocr.unavailable}`);
} else {
  console.log(`  OCR     : ${r.ocr.boxes.length} palavras em ${r.ocr.ms.toFixed(0)} ms`);
  const lines = new Map();
  for (const b of r.ocr.boxes) {
    const key = Math.round(b.rect.y / 16);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(b);
  }
  for (const [, boxes] of [...lines.entries()].sort((a, b) => a[0] - b[0])) {
    boxes.sort((a, b) => a.rect.x - b.rect.x);
    const x = Math.round(boxes[0].rect.x);
    const y = Math.round(boxes[0].rect.y);
    console.log(`    y=${String(y).padStart(4)} x=${String(x).padStart(4)}  ${boxes.map((v) => v.text).join(' ')}`);
  }
}
console.log('');

// A pool segura a worker thread viva; sem sair o processo nao encerra.
process.exit(0);