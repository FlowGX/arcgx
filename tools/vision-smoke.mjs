/**
 * Teste do addon cell-vision com um inventario sintetico.
 *
 * Desenha uma grade de celulas com bordas (como o inventario real), roda a
 * deteccao e confere se as celulas caem onde deveria.
 *
 *   node tools/vision-smoke.mjs [--cols 5] [--rows 4] [--cell 64] [--gap 6]
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vision = require('../packages/native/cell-vision/index.js');

const args = process.argv.slice(2);
const num = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};

const COLS = num('--cols', 5);
const ROWS = num('--rows', 4);
const CELL = num('--cell', 64);
const GAP = num('--gap', 6);
const PAD = num('--pad', 10);

const MARGIN = 4;
const W = PAD * 2 + COLS * CELL + (COLS - 1) * GAP + MARGIN * 2;
const H = PAD * 2 + ROWS * CELL + (ROWS - 1) * GAP + MARGIN * 2;

const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  console.log(`  FALHA ${m}`);
  process.exitCode = 1;
};
const info = (m) => console.log(`  ..    ${m}`);

console.log('\n== cell-vision smoke test ==\n');

/* -------------------------------------------------- imagem sintetica */

const img = new Uint8Array(W * H * 4);
// fundo escuro com ruido leve
for (let i = 0; i < W * H; i++) {
  const n = (Math.random() * 8) | 0;
  img[i * 4] = 18 + n;
  img[i * 4 + 1] = 16 + n;
  img[i * 4 + 2] = 14 + n;
  img[i * 4 + 3] = 255;
}

const setPx = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  img[i] = b;
  img[i + 1] = g;
  img[i + 2] = r;
  img[i + 3] = 255;
};

// grade de celulas: fundo claro + borda escura de 2px
const truth = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const x = PAD + MARGIN + c * (CELL + GAP);
    const y = PAD + MARGIN + r * (CELL + GAP);
    truth.push({ x, y, w: CELL, h: CELL });

    for (let dy = 0; dy < CELL; dy++) {
      for (let dx = 0; dx < CELL; dx++) {
        const edge = dx < 2 || dy < 2 || dx >= CELL - 2 || dy >= CELL - 2;
        if (edge) setPx(x + dx, y + dy, 200, 190, 170);
        else {
          // conteudo interno suave: blob radial, parecido com um icone real.
          // O teste anterior usava um padrao de alta frequencia, que gerava
          // borda em toda linha e mascarava as bordas da grade — imagem
          // sintetica irreal que escondia o problema.
          const cx = (CELL - 1) / 2;
          const cy = (CELL - 1) / 2;
          const d = Math.sqrt((dx - cx) ** 2 + (dy - cy) ** 2) / (CELL / 2);
          const v = Math.round(50 + 150 * Math.max(0, 1 - d * d));
          setPx(x + dx, y + dy, v, (v * 0.75) | 0, (v * 0.5) | 0);
        }
      }
    }
  }
}

console.log(`  imagem    : ${W}x${H}`);
console.log(`  grade     : ${COLS}x${ROWS} celulas de ${CELL}px, gap ${GAP}px`);
console.log(`  verdade   : ${truth.length} celulas\n`);

/* ------------------------------------------------------------ deteccao */

const t0 = performance.now();
const batch = vision.prepareClassifierBatch(img, W, H, { x: 0, y: 0, width: W, height: H }, 32);
const elapsed = performance.now() - t0;

console.log(`-- deteccao --`);
info(`grid detectada: ${batch.cols} col x ${batch.rows} lin`);
info(`celulas: ${batch.cells.length} | ${batch.ms.toFixed(2)} ms no addon | ${elapsed.toFixed(2)} ms total`);
info(`tensor: ${batch.data.length} floats (esperado ${truth.length} * 3 * ${batch.cellSize} * ${batch.cellSize} = ${truth.length * 3 * batch.cellSize * batch.cellSize})`);

if (batch.cells.length !== truth.length) {
  bad(`detectou ${batch.cells.length} celulas, esperado ${truth.length}`);
} else {
  ok(`${batch.cells.length}/${truth.length} celulas detectadas`);
}

if (batch.cols !== COLS || batch.rows !== ROWS) {
  bad(`grid ${batch.cols}x${batch.rows}, esperado ${COLS}x${ROWS}`);
} else {
  ok(`grid correta: ${COLS}x${ROWS}`);
}

const expectedFloats = truth.length * 3 * batch.cellSize * batch.cellSize;
if (batch.data.length !== expectedFloats) {
  bad(`tensor com ${batch.data.length} floats, esperado ${expectedFloats}`);
} else {
  ok('tensor com o tamanho certo');
}

let nonZero = 0;
for (let i = 0; i < batch.data.length; i += 97) if (batch.data[i] > 0.01) nonZero++;
if (nonZero === 0) {
  bad('tensor todo zero — o recorte nao pegou nada');
} else {
  ok(`tensor tem conteudo (${nonZero} amostras > 0)`);
}

/* --------------------------------------------- precisao posicional */

if (batch.cells.length === truth.length) {
  let sum = 0;
  let worst = 0;
  for (let i = 0; i < truth.length; i++) {
    const t = truth[i];
    const c = batch.cells[i];
    const dx = Math.abs(c.x - t.x);
    const dy = Math.abs(c.y - t.y);
    const dw = Math.abs(c.width - t.w);
    const dh = Math.abs(c.height - t.h);
    const err = Math.max(dx, dy, dw, dh);
    sum += err;
    if (err > worst) worst = err;
  }
  const mean = sum / truth.length;
  info(`erro posicional: media ${mean.toFixed(1)}px, pior ${worst}px`);
  if (mean <= 4) ok('posicionamento dentro de 4px da verdade');
  else bad(`posicionamento fora do toleravel (media ${mean.toFixed(1)}px)`);
}

/* ------------------------------------------------ ordem de leitura */

if (batch.cells.length >= 4) {
  let ordered = true;
  for (let i = 1; i < batch.cells.length; i++) {
    const p = batch.cells[i - 1];
    const c = batch.cells[i];
    if (c.y < p.y - 1) { ordered = false; break; }
    if (Math.abs(c.y - p.y) < 2 && c.x <= p.x) { ordered = false; break; }
  }
  if (ordered) ok('ordem de leitura correta (esquerda->direita, cima->baixo)');
  else bad('ordem de leitura errada');
}

/* -------------------------------------------------- inventario vazio */

const empty = vision.prepareClassifierBatch(
  img, W, H, { x: 0, y: 0, width: 40, height: 40 }, 32,
);
if (empty.cells.length === 0) {
  ok('roi sem celulas devolve lista vazia (inventario fechado)');
} else {
  bad(`roi vazia devolveu ${empty.cells.length} celulas`);
}

console.log('\n-- performance --');
const iters = 50;
const p0 = performance.now();
for (let i = 0; i < iters; i++) vision.prepareClassifierBatch(img, W, H, { x: 0, y: 0, width: W, height: H }, 96);
const per = (performance.now() - p0) / iters;
info(`${per.toFixed(2)} ms por frame em ${W}x${H}, tensor 96x96`);
if (per < 16.6) ok(`cabe no orcamento de 60 Hz (${per.toFixed(2)} ms < 16.6)`);
else info(`acima de 60 Hz, mas o alvo do scan e 4 Hz (250 ms) — folgado`);

const st = vision.stats();
info(`stats: ${st.calls} chamadas, ultima ${st.lastMs.toFixed(2)} ms, ${st.lastCells} celulas`);

console.log(process.exitCode ? '\n== FALHOU ==\n' : '\n== TUDO OK ==\n');
process.exit(process.exitCode ?? 0);