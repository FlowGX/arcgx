import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vision = require('../packages/native/cell-vision/index.js');
const { decodePng } = await import('./lib/png.mjs');
const { signatureFromBatch, normalizeSignature, GALLERY_GRID } = await import(
  '../packages/shared/dist/gallery.js'
);

const ROI = { x: 152, y: 367, width: 416, height: 624 };
const GALLERY = 'H:/Arcgxapp-ref/dados/models/gallery.json';
const FILES = [
  'H:/Arcgxapp-ref/captures/inventario-01.png',
  'H:/Arcgxapp-ref/captures/ao-vivo-01.png',
];

const gallery = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));
const ids = Object.keys(gallery.items);
const vecs = ids.map((id) => {
  const bin = Buffer.from(gallery.items[id], 'base64');
  const v = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) v[i] = (bin[i] > 127 ? bin[i] - 256 : bin[i]) / 127;
  return v;
});
function cos(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; d += x * y; na += x * x; nb += y * y; }
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

/**
 * Mesma geometria do DEFAULT_INSET, mas com o fundo da celula levado para
 * branco — igual ao que downscale() faz com o icone de referencia.
 */
function sigOverWhite(batch, size, index, top = 0.135, side = 0.06, invert = true) {
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
      if (n) {
        const R = r / n, G = g / n, B = b / n;
        // batch e 0..1 sobre fundo PRETO; a referencia e 0..255 sobre BRANCO.
        out[o] = (invert ? (1 - R) : R) * 255;
        out[o + 1] = (invert ? (1 - G) : G) * 255;
        out[o + 2] = (invert ? (1 - B) : B) * 255;
      }
    }
  }
  return normalizeSignature(out);
}

const MODES = [
  { nome: 'lib DEFAULT (como esta)', fn: (b, s, i) => signatureFromBatch(b, s, i) },
  { nome: 'local, fundo como esta', fn: (b, s, i) => sigOverWhite(b, s, i, 0.135, 0.06, false) },
  { nome: 'local, INVERTIDO p/ branco', fn: (b, s, i) => sigOverWhite(b, s, i, 0.135, 0.06, true) },
  { nome: 'lib + invertido, sem inset', fn: (b, s, i) => sigOverWhite(b, s, i, 0, 0, true) },
];

const BATCH = 96;
const totals = new Map(MODES.map((m) => [m.nome, { ok: 0, total: 0, score: 0, margin: 0 }]));

for (const file of FILES) {
  const img = decodePng(fs.readFileSync(file));
  const { width: W, height: H, data } = img;
  const bgra = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i += 4) {
    bgra[i] = data[i + 2]; bgra[i + 1] = data[i + 1]; bgra[i + 2] = data[i]; bgra[i + 3] = 255;
  }
  const batch = vision.prepareClassifierBatch(bgra, W, H, ROI, BATCH);

  // confronto direto: lib explicita vs reimplementacao local, mesma geometria
  const libSig = signatureFromBatch(batch.data, BATCH, 0, GALLERY_GRID, { top: 0.135, side: 0.06 });
  const locSig = sigOverWhite(batch.data, BATCH, 0, 0.135, 0.06, false);
  console.log(`  ${file.split('/').pop()}: cos(lib explicita, local) cel 0 = ${cos(libSig, locSig).toFixed(6)}`);
  console.log(`    lib  [0..5]: ${Array.from(libSig.slice(0, 6)).map((x) => x.toFixed(3)).join(', ')}`);
  console.log(`    local[0..5]: ${Array.from(locSig.slice(0, 6)).map((x) => x.toFixed(3)).join(', ')}`);
  console.log(`    comprimentos: lib=${libSig.length} local=${locSig.length}`);
  console.log(`    cos(lib,lib) = ${cos(libSig, libSig).toFixed(6)}   <-- sanidade`);

  // medias por bloco do canal R, antes de centralizar
  const blockRow = (padTop, padSide, innerW, innerH, grid, size, batch, idx) => {
    const base = idx * 3 * size * size;
    const out = [];
    for (let gx = 0; gx < grid; gx++) {
      const x0 = padSide + Math.floor((gx * innerW) / grid);
      const x1 = Math.min(size, padSide + Math.ceil(((gx + 1) * innerW) / grid));
      let r = 0, n = 0;
      for (let y = padTop; y < padTop + innerH; y++) {
        for (let x = x0; x < x1; x++) { r += batch[base + y * size + x] ?? 0; n++; }
      }
      out.push(n ? (r / n) : -1);
    }
    return out;
  };
  const G = GALLERY_GRID, S = BATCH;
  const padTop = Math.floor(S * 0.135), padSide = Math.floor(S * 0.06);
  console.log('    lib/mesma-geometria linha 0 R: ' + blockRow(padTop, padSide, S - 2 * padSide, S - padTop - padSide, G, S, batch.data, 0).map((v) => v.toFixed(2)).join(' '));
  console.log('    (padTop=' + padTop + ' padSide=' + padSide + ' innerW=' + (S - 2 * padSide) + ' innerH=' + (S - padTop - padSide) + ')');
  for (const mode of MODES) {
    for (let i = 0; i < batch.cells.length; i++) {
      const sig = mode.fn(batch.data, BATCH, i);
      const t = totals.get(mode.nome);
      t.total++;
      const { best, second } = bestTwo(sig);
      if (best >= 0.72 && best - second >= 0.06) t.ok++;
      t.score += best;
      t.margin += best - second;
    }
  }
  console.log(`${file.split('/').pop()}: ${batch.cells.length} celulas`);
}

console.log('\n  variante                        casados   nota med   margem med');
for (const [nome, t] of totals) {
  console.log(
    `  ${nome.padEnd(31)}  ${String(t.ok + '/' + t.total).padStart(6)}    ` +
    `${(t.score / t.total).toFixed(3)}      ${(t.margin / t.total).toFixed(4)}`,
  );
}