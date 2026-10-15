import fs from 'node:fs';
import { decodePng } from '../tools/lib/png.mjs';

const files = process.argv.slice(2);
if (!files.length) files.push('H:/Arcgxapp-ref/captures/inventario-01.png', 'H:/Arcgxapp-ref/captures/inventario-02.png');

const PITCH = 104;
const CW = 96;
const CH = 104;
const X0 = 152;
const Y0 = 367;

for (const file of files) {
  const img = decodePng(fs.readFileSync(file));
  const { width: W, data } = img;
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const sat = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  console.log('\n########## ' + file.split('/').pop() + ' ##########');
  console.log('grade assumed: origem ' + X0 + ',' + Y0 + ' pitch ' + PITCH + ' celula ' + CW + 'x' + CH);

  const boxes = [];
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 4; c++) {
      const cx = X0 + c * PITCH;
      const cy = Y0 + r * PITCH;
      let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, n = 0;
      const IN = 6;         // descarta o anel da borda
      const YSTOP = 80;     // ignora a barra inferior (dx/dy >= 84)
      for (let dy = IN; dy < YSTOP; dy++) {
        for (let dx = IN; dx < CW - IN; dx++) {
          const [rr, gg, bb] = px(cx + dx, cy + dy);
          if (lum(rr, gg, bb) > 55 && sat(rr, gg, bb) < 0.45) {
            if (dx < minx) minx = dx; if (dx > maxx) maxx = dx;
            if (dy < miny) miny = dy; if (dy > maxy) maxy = dy;
            n++;
          }
        }
      }
      const empty = maxx < 0;
      boxes.push({ c, r, minx, miny, maxx, maxy, n, empty });
      if (empty) continue;
      console.log('  cel(' + c + ',' + r + ')  icone dx ' + String(minx).padStart(3) + '..' + String(maxx).padStart(3) +
        '  dy ' + String(miny).padStart(3) + '..' + String(maxy).padStart(3) +
        '   ' + String(maxx - minx + 1).padStart(3) + 'x' + String(maxy - miny + 1).padStart(3) +
        '  px=' + n);
    }
  }

  const full = boxes.filter((b) => !b.empty);
  console.log('  --- celulas com conteudo: ' + full.length + '/' + boxes.length + ' ---');
  if (!full.length) continue;
  const st = (sel) => {
    const v = full.map(sel).sort((a, b) => a - b);
    return { min: v[0], p25: v[Math.floor(v.length * 0.25)], med: v[Math.floor(v.length / 2)], p75: v[Math.floor(v.length * 0.75)], max: v[v.length - 1] };
  };
  for (const [nm, sel] of [['x0', (b) => b.minx], ['x1', (b) => b.maxx], ['y0', (b) => b.miny], ['y1', (b) => b.maxy]]) {
    const s = st(sel);
    console.log('  ' + nm + ': min ' + s.min + '  p25 ' + s.p25 + '  mediana ' + s.med + '  p75 ' + s.p75 + '  max ' + s.max);
  }
  const w = st((b) => b.maxx - b.minx + 1), h = st((b) => b.maxy - b.miny + 1);
  console.log('  largura : min ' + w.min + '  mediana ' + w.med + '  max ' + w.max);
  console.log('  altura  : min ' + h.min + '  mediana ' + h.med + '  max ' + h.max);
}