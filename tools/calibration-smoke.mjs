#!/usr/bin/env node
/**
 * Valida a calibracao com cache contra o jogo real.
 *
 * Exercita o caminho que o app vai usar: pega um frame do WGC, mede a grade
 * uma vez, deriva todas as células por aritmética e confere contra a grade
 * medida da captura de referência (4 colunas x 5 linhas, passo 104).
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const requireCjs = createRequire(import.meta.url);
const { CaptureManager } = await import(
  pathToFileURL(path.resolve('H:/Arcgxapp/apps/main/dist/capture/manager.js')).href
);
const addon = requireCjs('../packages/native/wgc-capture/index.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROI = { x: 152, y: 367, width: 416, height: 624 };
const REF = { cols: 4, rows: 5, pitch: 104 };

console.log('\n== calibracao com cache (jogo real) ==\n');

const cap = new CaptureManager();
if (!cap.init()) {
  console.log('  addon nao carregou');
  process.exit(1);
}

const game = cap.findGameWindow();
if (!game) {
  console.log('  janela do jogo nao encontrada');
  process.exit(1);
}
console.log(`  alvo: "${game.cleanTitle}" pid ${game.pid}`);

addon.focusGameWindow(game.hwnd);
await sleep(900);
if (!cap.startWindow(game.hwnd)) {
  console.log(`  startWindow falhou: ${cap.error}`);
  process.exit(1);
}
await sleep(1200);

let frame = null;
for (let i = 0; i < 20; i++) {
  const f = cap.takeFrame();
  if (f) frame = f;
  await sleep(25);
}
cap.stop();
if (!frame) {
  console.log('  nenhum frame');
  process.exit(1);
}
console.log(`  frame: ${frame.width}x${frame.height}`);

const t0 = performance.now();
const spec = cap.gridSpec(frame, ROI);
const t1 = performance.now();
if (!spec) {
  console.log('  calibrate() devolveu null');
  process.exit(1);
}
console.log(
  `\n  passo ${spec.pitch.toFixed(1)} px (ref ${REF.pitch}, erro ${Math.abs(spec.pitch - REF.pitch).toFixed(1)} px)\n` +
  `  celula ${spec.cellWidth.toFixed(0)}x${spec.cellHeight.toFixed(0)}\n` +
  `  origem ${spec.originX.toFixed(0)},${spec.originY.toFixed(0)}\n` +
  `  confianca ${spec.confidence.toFixed(2)}  |  tempo ${(t1 - t0).toFixed(1)} ms`,
);

const cells = cap.cellsFromSpec(spec, ROI);
const cols = cells.length ? Math.round(cells.length / Math.max(1, new Set(cells.map((c) => c.y)).size)) : 0;
const rows = cells.length ? new Set(cells.map((c) => c.y)).size : 0;
console.log(`\n  celulas derivadas: ${cells.length}  -> ${cols} col x ${rows} lin`);
console.log(`  primeira: ${JSON.stringify(cells[0])}`);
console.log(`  ultima:   ${JSON.stringify(cells[cells.length - 1])}`);

// o cache tem que responder na segunda chamada, sem remedir
const t2 = performance.now();
const again = cap.gridSpec(frame, ROI);
const t3 = performance.now();
console.log(`\n  2a chamada (cache): ${((t3 - t2) * 1000).toFixed(0)} microssegundos`);
console.log(`  mesma geometria: ${JSON.stringify(again) === JSON.stringify(spec)}\n`);

console.log(`== grade ${cols}x${rows}, esperado ${REF.cols}x${REF.rows} ==\n`);