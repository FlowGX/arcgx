import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ocr = require('@arcgx/ocr');

console.log('exportadas:', Object.keys(ocr).join(', '));
console.log('ocrSupport:', JSON.stringify(ocr.ocrSupport(), null, 2));

/** `diag_buffer` monta um IBuffer na mao e relata o HRESULT de cada etapa. */
const diag = ocr.diag_buffer ?? ocr.diagBuffer;
if (typeof diag === 'function') {
  console.log('\n--- diag_buffer ---');
  console.log(diag(64, 32));
} else {
  console.log('\ndiag_buffer nao exportada');
}

// Texto sintetico grande o bastante: se nem isso volta, nao e problema de
// recorte nem de contraste — e o caminho do motor que nao esta funcionando.
const W = 800;
const H = 200;
const buf = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    // fundo branco
    buf[p] = 255;
    buf[p + 1] = 255;
    buf[p + 2] = 255;
    buf[p + 3] = 255;
  }
}
// barras pretas formando "9/20" de forma grosseira, 5 blocos por digito
const digitos = [
  [1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1],
  [0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0],
];
const x0 = 40;
for (const glifo of digitos) {
  for (let r = 0; r < glifo.length; r++) {
    for (let c = 0; c < glifo[r].length; c++) {
      if (!glifo[r][c]) continue;
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          const p = ((40 + r * 14 + y) * W + (x0 + c * 14 + x)) * 4;
          buf[p] = 0;
          buf[p + 1] = 0;
          buf[p + 2] = 0;
        }
      }
    }
  }
  break;
}

console.log('\n--- recognize em imagem sintetica 800x200 ---');
try {
  const r = ocr.recognize(buf, W, H);
  console.log('retorno:', r === null ? 'null' : 'obj');
  if (r) {
    console.log('  ms:', r.ms);
    console.log('  texto:', JSON.stringify(r.text ?? ''));
    console.log('  palavras:', (r.words ?? []).length);
  }
} catch (e) {
  console.log('  LANCOU:', e.message);
}