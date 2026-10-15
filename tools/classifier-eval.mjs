#!/usr/bin/env node
/**
 * Mede o caminho DE PRODUCAO da classificacao: batch do cell-vision ->
 * signatureFromBatch -> ItemClassifier, sobre capturas reais.
 *
 * Compara o inset simetrico que a lib usa (12%) com o inset calibrado so no
 * topo (13,5% da altura), medido por tools/calib-crop.mjs. O recorte que a
 * biblioteca escolheu e um palpite; este teste escolhe por numero.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Usa o compilado: o modo strip-only do Node não aceita parameter properties
// do TypeScript, e o classificador usa um no construtor.
const { ItemClassifier } = await import('../apps/workers/dist/classifier.js');
const { signatureFromBatch, GALLERY_GRID } = await import('../packages/shared/dist/gallery.js');
const { decodeSignature } = await import('../packages/shared/dist/gallery.js');
const vision = require('../packages/native/cell-vision/index.js');
const { decodePng } = await import('./lib/png.mjs');

const ROI = { x: 152, y: 367, width: 416, height: 624 };
const GALLERY = 'H:/Arcgxapp-ref/dados/models/gallery.json';
const FILES = [
  'H:/Arcgxapp-ref/captures/inventario-01.png',
  'H:/Arcgxapp-ref/captures/inventario-02.png',
  'H:/Arcgxapp-ref/captures/ao-vivo-01.png',
];

const gallery = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));
const ids = Object.keys(gallery.items);
const vecs = ids.map((id) => decodeSignature(gallery.items[id]));

function cos(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
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

const clf = new ItemClassifier({ minScore: 0.72, minMargin: 0.06 });
clf.load(gallery);
console.log(`galeria: ${clf.size} icones\n`);

/** inset so no topo: recorta a faixa de cima da celula antes do downscale */
const MODES = [
  { name: 'DEFAULT_INSET da lib (novo)', fn: (b, s, i) => signatureFromBatch(b, s, i) },
  { name: 'simetrico 12% (antigo padrao)', fn: (b, s, i) => signatureFromBatch(b, s, i, GALLERY_GRID, 0.12) },
  { name: 'simetrico 6%', fn: (b, s, i) => signatureFromBatch(b, s, i, GALLERY_GRID, 0.06) },
  { name: 'sem inset', fn: (b, s, i) => signatureFromBatch(b, s, i, GALLERY_GRID, 0) },
  { name: 'topo 20% + lado 3%', fn: (b, s, i) => signatureFromBatch(b, s, i, GALLERY_GRID, { top: 0.2, side: 0.03 }) },
  { name: 'topo 27% + lado 6%', fn: (b, s, i) => signatureFromBatch(b, s, i, GALLERY_GRID, { top: 0.27, side: 0.06 }) },
];

const BATCH = 96;
const totals = new Map(MODES.map((m) => [m.name, { ok: 0, total: 0, score: 0, margin: 0 }]));

for (const file of FILES) {
  const img = decodePng(fs.readFileSync(file));
  const { width: W, height: H, data } = img;
  const bgra = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i += 4) {
    bgra[i] = data[i + 2]; bgra[i + 1] = data[i + 1]; bgra[i + 2] = data[i]; bgra[i + 3] = 255;
  }

  const batch = vision.prepareClassifierBatch(bgra, W, H, ROI, BATCH);
  console.log(`${file.split('/').pop()}: grade ${batch.cols}x${batch.rows} = ${batch.cells.length} celulas`);


  for (const mode of MODES) {
    for (let i = 0; i < batch.cells.length; i++) {
      const sig = mode.fn(batch.data, BATCH, i);
      const t = totals.get(mode.name);
      t.total++;

      const d = clf.matchCell(sig);
      if (d.itemId) t.ok++;

      const { best, second } = bestTwo(sig);
      t.score += best;
      t.margin += best - second;
    }
  }
  console.log('');
}

console.log('resumo por recorte:');
console.log('  recorte                          casados   nota med   margem med');
for (const [name, t] of totals) {
  console.log(
    `  ${name.padEnd(32)}  ${String(t.ok + '/' + t.total).padStart(6)}    ` +
    `${(t.score / t.total).toFixed(3)}      ${(t.margin / t.total).toFixed(4)}`,
  );
}

