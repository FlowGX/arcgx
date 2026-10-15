import fs from 'node:fs';
import { decodePng } from '../tools/lib/png.mjs';

const img = decodePng(fs.readFileSync(process.argv[2] || 'H:/Arcgxapp-ref/captures/inventario-01.png'));
const { width: W, data } = img;

const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
const sat = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function runs(label, axis, fixed, from, to) {
  console.log('=== ' + label + ' ===');
  let run = null;
  const get = axis === 'col' ? (t) => px(fixed, t) : (t) => px(t, fixed);
  for (let t = from; t < to; t++) {
    const [r, g, b] = get(t);
    const s = sat(r, g, b), l = lum(r, g, b);
    const tag = (s > 0.30 && l > 50) ? 'BORDA' : (l < 30 ? 'fundo' : 'conteudo');
    if (!run) run = { s: t, tag, c: [r, g, b] };
    else if (run.tag !== tag) {
      if (t - run.s >= 2) {
        console.log('  ' + axis + ' ' + String(run.s).padStart(4) + '..' + String(t - 1).padStart(4) +
          ' (' + String(t - run.s).padStart(3) + 'px) ' + run.tag.padEnd(9) +
          ' rgb(' + run.c.map((v) => String(v).padStart(3)).join(',') + ')');
      }
      run = { s: t, tag, c: [r, g, b] };
    } else run.c = [r, g, b];
  }
  if (to - run.s >= 2) {
    console.log('  ' + axis + ' ' + String(run.s).padStart(4) + '..' + String(to - 1).padStart(4) +
      ' (' + String(to - run.s).padStart(3) + 'px) ' + run.tag.padEnd(9) +
      ' rgb(' + run.c.map((v) => String(v).padStart(3)).join(',') + ')');
  }
  console.log('');
}

runs('COLUNA x=152 (borda esquerda das celulas) — altura real', 'col', 152, 355, 1000);
runs('LINHA y=367 (borda superior das celulas) — largura real', 'row', 367, 140, 600);

console.log('=== celula (152,367): perfil vertical do CONTEUDO em x=199 ===');
for (let dy = 0; dy < 104; dy += 2) {
  const [r, g, b] = px(199, 367 + dy);
  const bar = ' '.repeat(Math.round(lum(r, g, b) / 3));
  console.log('  dy=' + String(dy).padStart(3) + '  rgb(' + String(r).padStart(3) + ',' + String(g).padStart(3) + ',' + String(b).padStart(3) + ')  lum ' + String(Math.round(lum(r, g, b))).padStart(3) + ' |' + bar + '|');
}
console.log('');

console.log('=== celula (152,367): perfil HORIZONTAL do conteudo em y=410 ===');
for (let dx = 0; dx < 95; dx += 2) {
  const [r, g, b] = px(152 + dx, 410);
  const bar = ' '.repeat(Math.round(lum(r, g, b) / 3));
  console.log('  dx=' + String(dx).padStart(3) + '  rgb(' + String(r).padStart(3) + ',' + String(g).padStart(3) + ',' + String(b).padStart(3) + ')  lum ' + String(Math.round(lum(r, g, b))).padStart(3) + ' |' + bar + '|');
}