#!/usr/bin/env node
/**
 * Fase 4 em captura REAL: detecta as celulas do ARMAZENAMENTO e classifica
 * cada uma contra a galeria de icones.
 *
 *   node tools/phase4-real.mjs [captura ...]
 *
 * Sem ground truth: o objetivo aqui e medir a taxa de casamento e a qualidade
 * do palpite (margem sobre o segundo colocado), nao provar o item certo.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

import { decodePng, signature } from './lib/png.mjs';
import { cosine } from '../packages/shared/src/gallery.ts';

const require = createRequire(import.meta.url);
const vision = require('../packages/native/cell-vision/index.js');

const files = process.argv.slice(2);
if (!files.length) {
  files.push(
    'H:/Arcgxapp-ref/captures/inventario-01.png',
    'H:/Arcgxapp-ref/captures/inventario-02.png',
  );
}

const GALLERY = 'H:/Arcgxapp-ref/dados/models/gallery.json';

// ROI medida: 4 colunas x 5 linhas completas, passo 104
const ROI = { x: 152, y: 367, width: 416, height: 624 };

// Recorte calibrado: tira so a borda superior. Medido por tools/calib-crop.mjs
// varrendo (topo, lados, base) nas duas capturas — 14 px de topo leva a nota
// media de 0.641 para 0.803 e a margem de 0.017 para 0.062.
const INSET_TOP = 14;

const gallery = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));
const ids = Object.keys(gallery.items);
const cache = new Map();
const vecs = ids.map((id) => {
  const bin = Buffer.from(gallery.items[id], 'base64');
  const v = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) v[i] = (bin[i] > 127 ? bin[i] - 256 : bin[i]) / 127;
  cache.set(id, v);
  return v;
});
console.log(`galeria: ${ids.length} icones, grade ${gallery.grid}x${gallery.grid}\n`);

function toImage(rgba, w, h, rect, size) {
  // recorte bilinear do celula -> Float32Array RGB (size x size)
  const out = new Float32Array(size * size * 3);
  const { x: rx, y: ry, width: cw, height: ch } = rect;
  for (let py = 0; py < size; py++) {
    const fy = ry + ((py + 0.5) * ch) / size - 0.5;
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
    const y1 = Math.max(0, Math.min(h - 1, y0 + 1));
    const wy = fy - Math.floor(fy);
    for (let px = 0; px < size; px++) {
      const fx = rx + ((px + 0.5) * cw) / size - 0.5;
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)));
      const x1 = Math.max(0, Math.min(w - 1, x0 + 1));
      const wx = fx - Math.floor(fx);
      const o = (py * size + px) * 3;
      for (let c = 0; c < 3; c++) {
        const p00 = rgba[(y0 * w + x0) * 4 + c];
        const p01 = rgba[(y0 * w + x1) * 4 + c];
        const p10 = rgba[(y1 * w + x0) * 4 + c];
        const p11 = rgba[(y1 * w + x1) * 4 + c];
        const top = p00 + (p01 - p00) * wx;
        const bot = p10 + (p11 - p10) * wx;
        out[o + c] = top + (bot - top) * wy;
      }
    }
  }
  return out;
}

function center(values) {
  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = (values[i] - mean) / 255;
  let n = 0;
  for (const v of out) n += v * v;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

const MIN_SCORE = 0.72;
const MIN_MARGIN = 0.06;

for (const file of files) {
  const img = decodePng(fs.readFileSync(file));
  const { width: W, height: H, data } = img;
  // Dois formatos, dois consumidores:
//   bgra -> o addon Rust (to_gray chama luma(px[0],px[1],px[2]), 0.2126 no 3o)
//   data -> o descritor em JS (RGB, como o PNG entrega)
// Usar o mesmo buffer nos dois inverte os canais de um deles.
const bgra = Buffer.allocUnsafe(data.length);
for (let i = 0; i < data.length; i += 4) {
  bgra[i] = data[i + 2]; bgra[i + 1] = data[i + 1]; bgra[i + 2] = data[i]; bgra[i + 3] = data[i + 3];
}

  const b = vision.prepareClassifierBatch(bgra, W, H, ROI, 12);
  console.log(`=== ${file.split('/').pop()} ===`);
  console.log(`grade ${b.cols}x${b.rows} = ${b.cells.length} celulas (${b.ms.toFixed(1)}ms)\n`);

  let matched = 0;
  const rows = [];
  for (const cell of b.cells) {
    const rect = {
      x: cell.x, y: cell.y + INSET_TOP,
      width: cell.width, height: cell.height - INSET_TOP,
    };
    const px12 = toImage(data, W, H, rect, 12);
    const sig = center(px12);

    let bi = -1;
    let bs = -Infinity;
    let si = -1;
    let ss = -Infinity;
    for (let i = 0; i < vecs.length; i++) {
      const s = cosine(sig, vecs[i]);
      if (s > bs) { ss = bs; si = bi; bs = s; bi = i; }
      else if (s > ss) { ss = s; si = i; }
    }
    if (!Number.isFinite(ss)) ss = 0;
    const ok = bs >= MIN_SCORE && bs - ss >= MIN_MARGIN;
    if (ok) matched++;
    rows.push({ cell, best: ids[bi], score: bs, second: si >= 0 ? ids[si] : null, ss, ok });
  }

  for (const r of rows) {
    console.log(
      `  cel ${String(r.cell.index).padStart(2)}  ${r.ok ? 'OK ' : '?? '} ` +
      `${r.score.toFixed(3)} (2o ${r.ss.toFixed(3)})  ${r.best}` +
      (r.ok && r.second ? `   <- ${r.second}` : ''),
    );
  }
  console.log(`\n  classificados: ${matched}/${rows.length}\n`);
}