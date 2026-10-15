/**
 * Mostra a forma real do que `pollFrame` devolve.
 *
 * `calibrate(f.data, ...)` estourou com `undefined`, e a suposição natural —
 * que o frame traz os pixels em `.data` —suposição está errada. Adivinhar a
 * assinatura de um addon é como o resto do projeto tem falhado: vale olhar.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cap = require('@arcgx/wgc-capture');

const norm = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

const jogo = cap.listWindows().find((w) => norm(w.title).includes('arcraiders'));
if (!jogo) {
  console.error('jogo nao encontrado');
  process.exit(1);
}

cap.startCapture(jogo.hwnd);
console.log('isRunning:', cap.isRunning());

let tentativas = 0;
const timer = setInterval(() => {
  const f = cap.pollFrame();
  tentativas++;
  if (!f) {
    if (tentativas > 10) {
      console.log('pollFrame devolveu undefined em', tentativas, 'tentativas');
      clearInterval(timer);
      cap.stopCapture();
    }
    return;
  }

  console.log('tipo:', Object.prototype.toString.call(f));
  console.log('chaves:', Object.keys(f).join(', '));
  for (const [k, v] of Object.entries(f)) {
    const tipo = ArrayBuffer.isView(v)
      ? `${v.constructor.name}[${v.length}]`
      : v === null
        ? 'null'
        : typeof v === 'object'
          ? `object{${Object.keys(v).join(',')}}`
          : `${typeof v} ${v}`;
    console.log(`   ${k} = ${tipo}`);
  }
  console.log('stats:', JSON.stringify(cap.stats ? cap.stats() : null));
  clearInterval(timer);
  cap.stopCapture();
}, 700);


