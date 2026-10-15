import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cap = require('@arcgx/wgc-capture');

const janelas = await cap.listWindows();
const alvo = Number(process.argv[2] ?? 0);

console.log(`alvo (hwnd do jogo): 0x${alvo.toString(16)}\n`);

let emFoco = 0;
for (const j of janelas) {
  const h = Number(j.hwnd);
  let fg = false;
  try {
    fg = cap.isTargetForeground(h);
  } catch (e) {
    fg = false;
  }
  if (fg) {
    emFoco++;
    console.log(`EM PRIMEIRO PLANO: 0x${h.toString(16)}  "${j.title}"`);
  }
}

if (!emFoco) console.log('nenhuma janela da lista responde "em primeiro plano"');

console.log('\n-- todas as janelas --');
for (const j of janelas) {
  const h = Number(j.hwnd);
  console.log(`  0x${h.toString(16)}  "${j.title}"  alvo=${h === alvo}`);
}