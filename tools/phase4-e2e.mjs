/**
 * Teste ponta a ponta da Fase 4: detectar celulas -> classificar.
 *
 * Monta um inventario usando icones REAIS da galeria (nao formas abstratas),
 * passa pelo cell-vision e ve se cada celula volta com o item certo.
 *
 *   node tools/phase4-e2e.mjs [--cells 24] [--gallery dados/models/gallery.json]
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { decodePng, signature } from './lib/png.mjs';
import {
  GALLERY_GRID,
  decodeSignature,
  matchSignature,
  prepareGallery,
  signatureFromBatch,
} from '../packages/shared/dist/gallery.js';

const require = createRequire(import.meta.url);
const vision = require('../packages/native/cell-vision/index.js');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};

const GALLERY_PATH = opt('--gallery', 'H:/Arcgxapp-ref/dados/models/gallery.json');
const CELL_COUNT = Number(opt('--cells', 24));
const COLS = 6;

const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  console.log(`  FALHA ${m}`);
  process.exitCode = 1;
};
const info = (m) => console.log(`  ..    ${m}`);

console.log('\n== fase 4: deteccao + classificacao ==\n');

/* ------------------------------------------------------------- galeria */

const gallery = JSON.parse(readFileSync(GALLERY_PATH, 'utf8'));
const idx = prepareGallery(gallery);
info(`galeria: ${idx.ids.length} icones`);

/* ------------------------------------------- icones de teste (reais) */

const RAW = 'https://raw.githubusercontent.com/RaidTheory/arcraiders-data/main/';

async function loadPng(id) {
  for (const d of ['images/items_ingame/', 'images/items/']) {
    const res = await fetch(`${RAW}${d}${id}.png`);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      return decodePng(buf);
    } catch {
      /* proximo */
    }
  }
  return null;
}

// escolhe icones distintos entre si (ignora os que tem gêmeo ambiguo)
const ids = idx.ids.slice();
const chosen = [];
const used = new Set();
for (const id of ids) {
  if (chosen.length >= CELL_COUNT) break;
  if (used.has(id)) continue;

  const sig = decodeSignature(gallery.items[id]);
  let clash = false;
  for (const c of chosen) {
    const other = decodeSignature(gallery.items[c]);
    if (matchSignature({ ...idx, ids: [c] }, sig, { minScore: 0.9, minMargin: 0 })?.itemId === id) {
      clash = true;
      break;
    }
  }
  if (clash) {
    used.add(id);
    continue;
  }
  chosen.push(id);
}

info(`icones de teste: ${chosen.length}`);

/* -------------------------------------------- monta o inventario */

const CELL = 64;
const GAP = 6;
const PAD = 8;
const ROWS = Math.ceil(chosen.length / COLS);
const W = PAD * 2 + COLS * CELL + (COLS - 1) * GAP;
const H = PAD * 2 + ROWS * CELL + (ROWS - 1) * GAP;

const img = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const n = (Math.random() * 6) | 0;
  img[i * 4] = 16 + n;
  img[i * 4 + 1] = 15 + n;
  img[i * 4 + 2] = 13 + n;
  img[i * 4 + 3] = 255;
}
const set = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  img[i] = b;
  img[i + 1] = g;
  img[i + 2] = r;
  img[i + 3] = 255;
};

// desenha cada icone real, reescalado, dentro da celula, com borda
const truth = [];
for (let i = 0; i < chosen.length; i++) {
  const png = await loadPng(chosen[i]);
  if (!png) continue;

  const c = i % COLS;
  const r = Math.floor(i / COLS);
  const cx = PAD + c * (CELL + GAP);
  const cy = PAD + r * (CELL + GAP);
  truth.push({ id: chosen[i], x: cx, y: cy, index: i });

  // borda da celula
  for (let d = 0; d < CELL; d++) {
    set(cx + d, cy, 190, 180, 160);
    set(cx + d, cy + CELL - 1, 190, 180, 160);
    set(cx, cy + d, 190, 180, 160);
    set(cx + CELL - 1, cy + d, 190, 180, 160);
  }

  // conteudo: reducao por bloco do PNG para 56x56 (deixa a borda de 4px)
  const inner = CELL - 8;
  const s = Math.min(png.width, png.height);
  const ox = (png.width - s) / 2;
  const oy = (png.height - s) / 2;
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const sx = ox + Math.floor((x * s) / inner);
      const sy = oy + Math.floor((y * s) / inner);
      const si = (sy * png.width + sx) * 4;
      const a = png.data[si + 3] / 255;
      // fundo transparente -> a cor de fundo da celula
      const br = 22;
      const rr = png.data[si] * a + br * (1 - a);
      const gg = png.data[si + 1] * a + 20 * (1 - a);
      const bb = png.data[si + 2] * a + 17 * (1 - a);
      set(cx + 4 + x, cy + 4 + y, rr, gg, bb);
    }
  }
}

info(`inventario: ${W}x${H}, ${truth.length} celulas com icones reais`);

/* ---------------------------------------------------------- deteccao */

const t0 = performance.now();
const batch = vision.prepareClassifierBatch(img, W, H, { x: 0, y: 0, width: W, height: H }, 96);
const tDetect = performance.now() - t0;

info(`cell-vision: ${batch.cells.length} celulas, grid ${batch.cols}x${batch.rows}, ${batch.ms.toFixed(1)} ms`);

if (batch.cells.length !== truth.length) {
  bad(`detectou ${batch.cells.length}, esperado ${truth.length}`);
} else {
  ok(`deteccao: ${batch.cells.length}/${truth.length}`);
}

/* ------------------------------------------------------ classificacao */

const t1 = performance.now();
const detections = [];
for (let i = 0; i < batch.cells.length; i++) {
  const sig = signatureFromBatch(batch.data, batch.cellSize, i, GALLERY_GRID);
  const m = matchSignature(idx, sig, { minScore: 0.9, minMargin: 0.005 });
  detections.push({ i, id: m?.itemId ?? null, score: m?.score ?? 0, runnerUp: m?.runnerUp ?? null });
}
const tClass = performance.now() - t1;

let correct = 0;
let unknown = 0;
let wrong = 0;
const wrongList = [];
const unknownList = [];

for (const d of detections) {
  const expected = truth[d.i]?.id;
  if (!d.id) {
    unknown++;
    unknownList.push(expected);
  } else if (d.id === expected) {
    correct++;
  } else {
    wrong++;
    wrongList.push(`${expected} -> ${d.id} (${d.score.toFixed(3)})`);
  }
}

info(`classificacao: ${(tClass / Math.max(1, detections.length)).toFixed(1)} ms por celula`);

console.log('');
if (correct + wrong > 0) {
  const prec = (100 * correct) / (correct + wrong);
  info(`cobertura ${(((correct + wrong) / truth.length) * 100).toFixed(0)}% | precisao ${prec.toFixed(1)}%`);
}

if (correct + wrong === 0) bad('nenhum item classificado');
else if (wrong === 0) ok(`zero classificacoes erradas (${correct} corretas)`);
else bad(`${wrong} erradas: ${wrongList.slice(0, 4).join('; ')}`);

if (unknown) {
  info(`desconhecidos: ${unknown} (${unknownList.slice(0, 4).join(', ')})`);
  ok('desconhecidos nao viram palpite — vai para a fila de correcao');
}

console.log('');
info(`total: deteccao ${tDetect.toFixed(1)} ms + classificacao ${tClass.toFixed(1)} ms = ${(tDetect + tClass).toFixed(1)} ms`);
info(`orcamento do scan: 4 Hz = 250 ms por ciclo`);

console.log(process.exitCode ? '\n== FALHOU ==\n' : '\n== TUDO OK ==\n');
process.exit(process.exitCode ?? 0);