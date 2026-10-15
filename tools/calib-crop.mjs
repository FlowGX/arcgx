#!/usr/bin/env node
/**
 * Varre o recorte da celula e mede qual recorte casa melhor com a galeria.
 *
 * O template (`items_ingame`, 128x128) tem arte + moldura fina. A celula do
 * jogo tem borda, arte centralizada e barra inferior de durabilidade. Sem
 * alinhar os dois enquadramentos, o descritor 12x12 carrega informacao que o
 * template nao tem — e nenhuma combinacao casa.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

import { decodePng } from './lib/png.mjs';
import { cosine } from '../packages/shared/src/gallery.ts';

const require = createRequire(import.meta.url);
const vision = require('../packages/native/cell-vision/index.js');

const GALLERY = 'H:/Arcgxapp-ref/dados/models/gallery.json';
const ROI = { x: 152, y: 367, width: 416, height: 624 };

const gallery = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));
const ids = Object.keys(gallery.items);
const vecs = ids.map((id) => {
  const bin = Buffer.from(gallery.items[id], 'base64');
  const v = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) v[i] = (bin[i] > 127 ? bin[i] - 256 : bin[i]) / 127;
  return v;
});

const img = decodePng(fs.readFileSync('H:/Arcgxapp-ref/captures/inventario-01.png'));
const { width: W, height: H, data } = img;
// O addon le BGRA. `Buffer.from(data)` seria RGBA e trocaria os pesos de R e B
// na deteccao de borda — foi o que inflou a calibragem anterior.
const bgra = Buffer.allocUnsafe(data.length);
for (let i = 0; i < data.length; i += 4) {
  bgra[i] = data[i + 2]; bgra[i + 1] = data[i + 1]; bgra[i + 2] = data[i]; bgra[i + 3] = data[i + 3];
}

const b = vision.prepareClassifierBatch(bgra, W, H, ROI, 12);

function crop(rect, size) {
  const { x, y, width: cw, height: ch } = rect;
  const out = new Float32Array(size * size * 3);
  for (let py = 0; py < size; py++) {
    const sy = Math.round(y + ((py + 0.5) * ch) / size - 0.5);
    for (let px = 0; px < size; px++) {
      const sx = Math.round(x + ((px + 0.5) * cw) / size - 0.5);
      for (let c = 0; c < 3; c++) out[(py * size + px) * 3 + c] = data[(sy * W + sx) * 4 + c];
    }
  }
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / 255;
  let n = 0;
  for (const v of out) n += v * v;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

function score(sig) {
  let bs = -Infinity, ss = -Infinity, bi = 0;
  for (let i = 0; i < vecs.length; i++) {
    const s = cosine(sig, vecs[i]);
    if (!(s > -Infinity)) continue;
    if (s > bs) { ss = bs; bs = s; bi = i; }
    else if (s > ss) { ss = s; }
  }
  if (!Number.isFinite(ss)) ss = 0;
  return { best: bs, margin: bs - ss, id: ids[bi] };
}

const results = [];
for (const insetT of [6, 10, 14, 18, 22]) {
  for (const insetS of [0, 4, 8]) {
    for (const insetB of [0, 6, 12, 18]) {
      const cell = b.cells[0];
      const rect = {
        x: cell.x + insetS,
        y: cell.y + insetT,
        width: cell.width - insetS * 2,
        height: cell.height - insetT - insetB,
      };
      if (rect.width < 24 || rect.height < 24) continue;
      const sig = crop(rect, 12);
      let sumBest = 0, sumMargin = 0, worstMargin = 1;
      for (const c of b.cells) {
        const r = score(crop({
          x: c.x + insetS, y: c.y + insetT,
          width: c.width - insetS * 2, height: c.height - insetT - insetB,
        }, 12));
        sumBest += r.best;
        sumMargin += r.margin;
        if (r.margin < worstMargin) worstMargin = r.margin;
      }
      results.push({ insetT, insetS, insetB, avg: sumBest / b.cells.length, margin: sumMargin / b.cells.length, worst: worstMargin });
    }
  }
}

results.sort((a, b) => b.margin - a.margin);
console.log('top 12 por margem media (corte: topo / lados / base):\n');
console.log('  T   L   B   |  nota media   margem media   pior margem');
for (const r of results.slice(0, 12)) {
  console.log(`  ${String(r.insetT).padStart(2)}  ${String(r.insetS).padStart(2)}  ${String(r.insetB).padStart(2)}  |    ${r.avg.toFixed(3)}       ${r.margin.toFixed(4)}        ${r.worst.toFixed(4)}`);
}