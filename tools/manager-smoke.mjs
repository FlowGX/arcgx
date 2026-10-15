#!/usr/bin/env node
/**
 * Testa o CaptureManager compilado (apps/main/dist), nao o addon solto.
 *
 * A diferenca importa: o smoke test de captura prova que o Rust funciona, mas
 * nao prova que o Electron consegue chegar nele. Aqui o caminho inteiro e o de
 * producao — loadAddon, suporte, busca de janela, start, poll, stop.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire('file:///H:/Arcgxapp/apps/main/dist/');
const { CaptureManager } = await import(
  pathToFileURL(path.resolve('H:/Arcgxapp/apps/main/dist/capture/manager.js')).href
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n== CaptureManager (dist) ==\n');

const cap = new CaptureManager();

console.log(`  init()          : ${cap.init()}`);
console.log(`  available       : ${cap.available}`);
console.log(`  error           : ${cap.error ?? 'nenhum'}`);

const windows = cap.listWindows();
console.log(`\n  janelas         : ${windows.length}`);
for (const w of windows.slice(0, 6)) {
  const suja = w.title !== w.cleanTitle;
  console.log(`    pid ${String(w.pid).padStart(6)}  "${w.cleanTitle}"${suja ? '   <- titulo sujo no original' : ''}`);
}

const game = cap.findGameWindow();
console.log(`\n  jogo encontrado : ${game ? `"${game.cleanTitle}" pid ${game.pid}` : 'NAO'}`);

if (!game) {
  console.log('\n  sem janela do jogo: encerrando\n');
  process.exit(1);
}

console.log(`\n  forcando foco da janela do jogo...`);
{
  const addon = createRequire(import.meta.url)(
    '../packages/native/wgc-capture/index.js',
  );
  addon.focusGameWindow(game.hwnd);
}
await sleep(900);

console.log(`  startWindow()   : ${cap.startWindow(game.hwnd)}`);
if (!cap.isRunning) {
  console.log(`  erro            : ${cap.error}`);
  process.exit(1);
}
console.log(`  source          : ${cap.source}`);
console.log(`  windowTitle     : ${cap.windowTitle}`);

console.log('\n  -- poll (pull) --');
await sleep(1200);
let got = 0;
for (let i = 0; i < 20; i++) {
  const f = cap.takeFrame();
  if (f) {
    got++;
    if (got === 1) console.log(`  primeiro frame  : ${f.width}x${f.height} stride ${f.stride} ${f.data.length} bytes`);
  }
  await sleep(30);
}
console.log(`  frames lidos    : ${got}/20`);

const s = cap.stats;
console.log(`\n  stats           : ${s.width}x${s.height}  fps ${s.avgFps}  vram ${s.vramMb} MB  descartados ${s.dropped}`);
console.log(`  foco do jogo    : ${cap.isGameFocused()}`);

// o pull é consumível: o addon guarda so o ultimo frame
const a = cap.takeFrame();
const b = cap.takeFrame();
console.log(`  pull consumivel : ${a ? 'primeiro ok' : 'vazio'} / ${b ? 'SEGUNDO TAMBEM' : 'segundo vazio (correto)'}`);

cap.stop();
console.log(`\n  stop()          : rodando=${cap.isRunning}  source=${cap.source}`);
console.log(`\n== ${got > 0 ? 'TUDO OK' : 'FALHOU'} ==\n`);
process.exit(got > 0 ? 0 : 1);