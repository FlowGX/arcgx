#!/usr/bin/env node
/**
 * Pipeline completo em captura ao vivo: WGC -> celulas -> assinatura -> galeria.
 *
 *   node tools/capture-live.mjs [--window "ARC"] [--roi x,y,w,h] [--frames 20]
 *
 * O frame do WGC ja e BGRA, que e exatamente o que o cell-vision consome: aqui
 * nao ha conversao nenhuma entre captura e deteccao. Qualquer erro de ordem de
 * canal aparece como grade vazia ou deteccao errada, nao como ruido sutil.
 *
 * Para testar de verdade, abra o inventario do ARMAZENAMENTO no jogo antes de
 * rodar e deixe a janela do jogo em primeiro plano.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

import { cosine } from '../packages/shared/src/gallery.ts';
import { encodePng } from './lib/png-encode.mjs';

const require = createRequire(import.meta.url);
const cap = require('../packages/native/wgc-capture/index.js');
const vision = require('../packages/native/cell-vision/index.js');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};

const WANT = Number(opt('--frames', 20));
const MATCH = opt('--window', 'ARC');
const ROI_ARG = opt('--roi', null);
const GALLERY = 'H:/Arcgxapp-ref/dados/models/gallery.json';

const gallery = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));
const ids = Object.keys(gallery.items);
const vecs = ids.map((id) => {
  const bin = Buffer.from(gallery.items[id], 'base64');
  const v = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) v[i] = (bin[i] > 127 ? bin[i] - 256 : bin[i]) / 127;
  return v;
});

const MIN_SCORE = 0.72;
const MIN_MARGIN = 0.06;

/* ------------------------------------------------- normaliza zero-width */

// O titulo do jogo vem embaralhado com caracteres de largura zero:
// "A\u200bR\u200bC\u200b Ra\u200bi\u200bd\u200be\u200br\u200bs".
// Qualquer filtro por /ARC Raiders/ direto nunca casa.
const flat = (s) => s.replace(/[\u200B-\u200F\uFEFF\u2060]/g, '').replace(/\s+/g, ' ').trim();

console.log('\n== pipeline ao vivo: WGC -> visao -> classificador ==\n');

const windows = cap.listWindows();
const target = windows.find((w) => flat(w.title).toLowerCase().includes(MATCH.toLowerCase()));
if (!target) {
  console.log(`  janela "${MATCH}" nao encontrada. visiveis:\n`);
  for (const w of windows.slice(0, 25)) console.log(`    ${w.pid}  "${flat(w.title)}"`);
  process.exit(1);
}

console.log(`  alvo     : "${flat(target.title)}"  pid ${target.pid}`);
console.log(`  titulo cru: ${JSON.stringify(target.title.slice(0, 40))}  (tem largura zero: ${target.title !== flat(target.title)})`);
console.log(`  rect     : ${JSON.stringify(target.rect)}`);

if (!cap.isTargetForeground(target.hwnd)) {
  cap.focusGameWindow(target.hwnd);
  await sleep(700);
  console.log(`  primeiro plano: ${cap.isTargetForeground(target.hwnd)}`);
}

cap.startCapture(target.hwnd);
if (!cap.isRunning()) {
  console.log(`  FALHA startCapture: ${cap.lastD3DError()}`);
  process.exit(1);
}
console.log('\n-- aguardando o compositor --');
await sleep(1200);

let frame = null;
for (let i = 0; i < WANT; i++) {
  const f = cap.pollFrame();
  if (f) frame = f;
  await sleep(20);
}
cap.stopCapture();

if (!frame) {
  console.log('  FALHA nenhum frame');
  process.exit(1);
}
console.log(`  frame    : ${frame.width}x${frame.height}  ${frame.data.length} bytes BGRA`);

// Gravar o frame permite rodar as ferramentas de medida sobre a captura real
// (medir a grade, ver a anatomia da celula) em vez de so receber "0/30".
const SAVE = opt('--save', null);
if (SAVE) {
  const rgba = Buffer.allocUnsafe(frame.data.length);
  for (let i = 0; i < frame.data.length; i += 4) {
    rgba[i] = frame.data[i + 2];
    rgba[i + 1] = frame.data[i + 1];
    rgba[i + 2] = frame.data[i];
    rgba[i + 3] = 255;
  }
  fs.writeFileSync(SAVE, encodePng(rgba, frame.width, frame.height));
  console.log(`  salvo    : ${SAVE}`);
}

/* ------------------------------------------------------------- deteccao */

// Sem --roi, varre a tela inteira: a deteccao acha a grade onde ela estiver.
const roi = ROI_ARG
  ? (([x, y, w, h]) => ({ x, y, width: w, height: h }))(ROI_ARG.split(',').map(Number))
  : { x: 0, y: 0, width: frame.width, height: frame.height };

const b = vision.prepareClassifierBatch(frame.data, frame.width, frame.height, roi, 12);
console.log(`  ROI      : ${roi.x},${roi.y} ${roi.width}x${roi.height}`);
console.log(`  grade    : ${b.cols}x${b.rows} = ${b.cells.length} celulas  (${b.ms.toFixed(1)} ms)`);

if (!b.cells.length) {
  console.log('\n  nenhuma celula — inventario fechado ou ROI errada\n');
  process.exit(0);
}

/* -------------------------------------------------------- classificacao */

function cellSignature(cell, insetTop) {
  const size = 12;
  const sx0 = Math.round(cell.x);
  const sy0 = Math.round(cell.y + insetTop);
  const cw = Math.round(cell.width);
  const ch = Math.round(cell.height - insetTop);
  const out = new Float32Array(size * size * 3);
  for (let py = 0; py < size; py++) {
    const sy = Math.min(frame.height - 1, Math.max(0, sy0 + Math.round(((py + 0.5) * ch) / size - 0.5)));
    for (let px = 0; px < size; px++) {
      const sx = Math.min(frame.width - 1, Math.max(0, sx0 + Math.round(((px + 0.5) * cw) / size - 0.5)));
      for (let c = 0; c < 3; c++) out[(py * size + px) * 3 + c] = frame.data[(sy * frame.width + sx) * 4 + c];
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

console.log('');
let ok = 0;
for (const cell of b.cells) {
  const sig = cellSignature(cell, 14);
  let bs = -Infinity, ss = -Infinity, bi = 0;
  for (let i = 0; i < vecs.length; i++) {
    const s = cosine(sig, vecs[i]);
    if (s > bs) { ss = bs; bs = s; bi = i; }
    else if (s > ss) ss = s;
  }
  if (!Number.isFinite(ss)) ss = 0;
  const good = bs >= MIN_SCORE && bs - ss >= MIN_MARGIN;
  if (good) ok++;
  console.log(
    `  cel ${String(cell.index).padStart(2)} ${good ? 'OK ' : '?? '} ${bs.toFixed(3)} (2o ${ss.toFixed(3)})  ${ids[bi]}`,
  );
}
console.log(`\n  classificados: ${ok}/${b.cells.length}\n`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}