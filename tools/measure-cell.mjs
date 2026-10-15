import fs from 'node:fs';
import { decodePng } from '../tools/lib/png.mjs';

const file = process.argv[2] || 'H:/Arcgxapp-ref/captures/inventario-01.png';
const img = decodePng(fs.readFileSync(file));
const { width: W, data } = img;

const px = (x, y) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};

// origem medida: coluna 152, primeira linha completa 367
const X0 = 152;
const Y0 = 367;

console.log('\n=== corte horizontal na linha y=' + (Y0 + 47) + ' (meio da celula) ===');
console.log('x: cor');
let run = null;
for (let x = X0 - 6; x < X0 + 112; x++) {
  const [r, g, b] = px(x, Y0 + 47);
  const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const bright = lum > 45;
  if (run === null || run.bright !== bright) {
    if (run) console.log('  x ' + String(run.from).padStart(4) + '-' + String(x - 1).padStart(4) + ' (' + String(x - run.from).padStart(3) + 'px) ' + (run.bright ? 'CLARO rgb(' + run.c + ')' : 'escuro'));
    run = { from: x, bright, c: r + ',' + g + ',' + b };
  }
}
if (run) console.log('  x ' + String(run.from).padStart(4) + '-' + (X0 + 105) + ' (' + String(X0 + 106 - run.from).padStart(3) + 'px) ' + (run.bright ? 'CLARO' : 'escuro'));

console.log('\n=== corte vertical na coluna x=' + (X0 + 47) + ' (meio da celula) ===');
run = null;
for (let y = Y0 - 6; y < Y0 + 112; y++) {
  const [r, g, b] = px(X0 + 47, y);
  const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const bright = lum > 45;
  if (run === null || run.bright !== bright) {
    if (run) console.log('  y ' + String(run.from).padStart(4) + '-' + String(y - 1).padStart(4) + ' (' + String(y - run.from).padStart(3) + 'px) ' + (run.bright ? 'CLARO' : 'escuro'));
    run = { from: y, bright };
  }
}

console.log('\n=== amostragem vertical fina (onde comeca a barra inferior?) ===');
for (let dy = 0; dy < 96; dy += 4) {
  const [r, g, b] = px(X0 + 47, Y0 + dy);
  const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const bar = '                    '.slice(0, Math.round(lum / 4));
  console.log('  dy ' + String(dy).padStart(2) + '  rgb(' + String(r).padStart(3) + ',' + String(g).padStart(3) + ',' + String(b).padStart(3) + ')  lum ' + String(lum).padStart(3) + ' |' + bar + '|');
}
console.log('');