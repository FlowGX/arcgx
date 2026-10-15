import fs from 'node:fs';
import { decodePng } from '../tools/lib/png.mjs';

const file = process.argv[2] || 'H:/Arcgxapp-ref/captures/inventario-01.png';
const ci = Number(process.argv[3] || 0);
const ri = Number(process.argv[4] || 0);
const PITCH = 104, CELL = 104, X0 = 152, Y0 = 367;

const img = decodePng(fs.readFileSync(file));
const { width: W, data } = img;
const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
const sat = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const ramp = ' .:-=+*#%@';
const cx = X0 + ci * PITCH, cy = Y0 + ri * PITCH;

console.log('celula (' + ci + ',' + ri + ') origem absoluta ' + cx + ',' + cy + '  — ' + file.split('/').pop());
console.log('');
let head = '      ';
for (let dx = 0; dx < CELL; dx += 1) head += String(Math.floor(dx / 10) % 10);
console.log(head);
head = '      ';
for (let dx = 0; dx < CELL; dx += 1) head += String(dx % 10);
console.log(head);

for (let dy = 0; dy < CELL; dy++) {
  let line = String(dy).padStart(4) + ' |';
  for (let dx = 0; dx < CELL; dx++) {
    const [r, g, b] = px(cx + dx, cy + dy);
    const s = sat(r, g, b), l = lum(r, g, b);
    if (s > 0.35 && l > 55) line += 'B';
    else {
      const k = Math.max(0, Math.min(9, Math.round((l / 255) * 9)));
      line += ramp[k];
    }
  }
  console.log(line);
}
console.log('');
console.log('B = borda colorida (raridade).  gradiente de brilho = conteudo');