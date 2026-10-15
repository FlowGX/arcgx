/**
 * Teste real do addon wgc-capture.
 *
 * Abre uma janela (notepad), captura via Windows Graphics Capture e verifica
 * que os frames chegam com tamanho e conteudo coerentes. Nao e mock: e o WGC de
 * verdade rodando nesta maquina.
 *
 *   node tools/capture-smoke.mjs [--window titulo] [--frames 30]
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const addon = require('../packages/native/wgc-capture/index.js');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const WANT = Number(opt('--frames', 30));
const TIMEOUT_MS = Number(opt('--timeout', 20000));

const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => {
  console.log(`  FALHA ${m}`);
  process.exitCode = 1;
};
const info = (m) => console.log(`  ..    ${m}`);

console.log('\n== wgc-capture smoke test ==\n');

/* ------------------------------------------------------------- suporte */

const support = addon.captureSupport();
// O nome real do export e `lastD3DError` (camelCase). Checar `last_d3dError`
// devolvia `undefined` e a linha de diagnostico nunca aparecia — que era
// exatamente a linha que dizia por que a captura falhou.
const diag = addon.lastD3DError();
if (diag) console.log(`  diag  ${diag}`);
info(`WGC=${support.windowsGraphicsCapture} D3D11=${support.d3d11}${support.reason ? ' (' + support.reason + ')' : ''}`);
if (!support.windowsGraphicsCapture) {
  fail('WGC indisponivel neste sistema');
  process.exit(1);
}
ok('suporte confirmado');

/* ------------------------------------------------------- janela de teste */

console.log('\n-- abrindo janela de teste --');
const notepad = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
notepad.unref();
await sleep(2500);

const windows = addon.listWindows();
info(`${windows.length} janelas visiveis`);

// Janela minimizada e reportada em x=-32000 e NAO produz frame: o WGC
// entrega, mas o compositor nao tem nada para desenhar. Filtrar antes evita
// escolher o alvo errado e culpar a captura.
const isMinimized = (w) => w.rect && (w.rect.x <= -32000 || w.rect.y <= -32000);

// Janelas auxiliares do sistema passam por IsWindowVisible e ocupam a tela
// inteira, mas nunca produzem frame (e o startCapture recusa). Preferimos o
// notepad que acabamos de abrir, casando pelo PID.
const notepadPid = windows.find((w) => /notepad/i.test(w.title) && !/notepad\+\+/i.test(w.title))?.pid;

const visible = windows.filter(
  (w) =>
    !isMinimized(w) &&
    w.rect &&
    w.rect.width >= 300 &&
    w.rect.height >= 200 &&
    !/text input|input experience|program manager|windows input|setup/i.test(w.title),
);
info(`${visible.length} janelas candidatas`);

const target =
  visible.find((w) => w.pid && w.pid === notepadPid) ??
  visible.find((w) => /notepad/i.test(w.title)) ??
  visible.sort((a, b) => (b.rect?.width ?? 0) * (b.rect?.height ?? 0) - (a.rect?.width ?? 0) * (a.rect?.height ?? 0))[0];

if (!target) {
  fail('nenhuma janela visivel e nao-minimizada para capturar');
  notepad.kill();
  process.exit(1);
}

console.log(`  janela alvo: "${target.title}"`);
console.log(`  hwnd: 0x${target.hwnd.toString(16)}  rect: ${JSON.stringify(target.rect)}`);

if (!addon.isWindow(target.hwnd)) {
  fail('IsWindow() falso para a janela encontrada');
  notepad.kill();
  process.exit(1);
}
ok('IsWindow() confirma');

// A janela precisa estar em primeiro plano e visivel: o pool so entrega frame
// quando o alvo esta sendo composto.
addon.focusGameWindow(target.hwnd);
await sleep(700);
info(`em primeiro plano: ${addon.isTargetForeground(target.hwnd)}`);

/* ------------------------------------------------------------- captura */

console.log('\n-- iniciando captura --');
try {
  addon.startCapture(target.hwnd);
} catch (err) {
  fail(`startCapture: ${err.message}`);
  notepad.kill();
  process.exit(1);
}

if (!addon.isRunning()) {
  fail('isRunning() falso logo apos startCapture');
  notepad.kill();
  process.exit(1);
}
ok('isRunning() verdadeiro');

/* ------------------------------------------------------------- frames */

console.log(`\n-- coletando ${WANT} frames (timeout ${TIMEOUT_MS}ms) --`);

// O WGC entrega frames vazios ate o compositor produzir o primeiro quadro
// real da janela. Ler de imediato pega essa janela vazia e reporta "frame
// inteiramente preto" mesmo com a captura funcionando — 30 frames em 0,5 s
// sao exatamente essa janela.
info('aguardando o compositor produzir o primeiro quadro...');
await sleep(1200);

const t0 = Date.now();
let got = 0;
let first = null;
let sizes = new Set();
let nonZeroPixels = 0;
let checksum = 0;

while (got < WANT && Date.now() - t0 < TIMEOUT_MS) {
  const frame = addon.pollFrame();

  if (frame) {
    got++;
    sizes.add(`${frame.width}x${frame.height}`);

    if (!first) {
      first = frame;
      // um frame de tela cheia nunca e todo preto
      let nonZero = 0;
      for (let i = 0; i < frame.data.length; i += 4000) {
        if (frame.data[i] !== 0 || frame.data[i + 1] !== 0 || frame.data[i + 2] !== 0) nonZero++;
      }
      nonZeroPixels = nonZero;
      checksum = frame.data.reduce((a, b, i) => (i % 999 === 0 ? (a + b) % 1e9 : a), 0);
    }
  }

  await sleep(8);
}

const stats = addon.stats();
const elapsed = (Date.now() - t0) / 1000;

console.log(`  frames lidos : ${got}/${WANT} em ${elapsed.toFixed(1)}s`);
console.log(`  fps do addon : ${stats.fps}`);
console.log(`  tamanhos     : ${[...sizes].join(', ')}`);
console.log(`  erros        : ${stats.last_error ?? 'nenhum'}`);
console.log(`  VRAM aprox.  : ${stats.vram_mb} MB`);

if (got === 0) {
  fail('nenhum frame recebido — WGC nao entregou nada');
} else if (got < WANT) {
  fail(`so ${got}/${WANT} frames (esperado ${WANT})`);
} else {
  ok(`${got} frames recebidos`);
}

if (first) {
  const expected = first.width * first.height * 4;
  if (first.data.length !== expected) {
    fail(`buffer com ${first.data.length} bytes, esperado ${expected} (${first.width}x${first.height}x4)`);
  } else {
    ok(`buffer correto: ${first.data.length} bytes para ${first.width}x${first.height}`);
  }

  if (first.stride !== 4) {
    fail(`stride ${first.stride}, esperado 4 (BGRA)`);
  } else {
    ok('stride 4 (BGRA)');
  }

  if (nonZeroPixels === 0) {
    fail('frame inteiramente preto — a captura nao esta vendo a janela');
  } else {
    ok(`frame tem conteudo (amostra com ${nonZeroPixels} pixels nao-zero)`);
  }

  if (checksum === 0) {
    fail('checksum zero — dados corrompidos');
  } else {
    ok(`checksum nao-zero (${checksum})`);
  }
}

/* ------------------------------------------------------------- limpeza */

console.log('\n-- encerrando --');
addon.stopCapture();

if (addon.isRunning()) {
  fail('isRunning() ainda verdadeiro apos stopCapture');
} else {
  ok('captura encerrada');
}

const after = addon.stats();
if (after.last_error) {
  fail(`erro residual apos stop: ${after.last_error}`);
} else {
  ok('sem erro residual');
}

notepad.kill();

console.log(
  process.exitCode ? '\n== FALHOU ==\n' : '\n== TUDO OK ==\n',
);
process.exit(process.exitCode ?? 0);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}