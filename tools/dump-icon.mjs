#!/usr/bin/env node
/** Baixa um icone items_ingame e mostra dimensoes + recorte ASCII. */
import { decodePng } from './lib/png.mjs';

const RAW = 'https://raw.githubusercontent.com/RaidTheory/arcraiders-data/main';
const ids = process.argv.slice(2);
if (!ids.length) ids.push('bandage', 'jolt_mine', 'arc_powercell');

const px = (x, y, data, W) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};
const sat = (r, g, b) => { const m = Math.max(r, g, b), n = Math.min(r, g, b); return m ? (m - n) / m : 0; };
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ramp = ' .:-=+*#%@';

for (const id of ids) {
  let img = null;
  let from = '';
  for (const dir of ['images/items_ingame/', 'images/items/']) {
    const res = await fetch(`${RAW}/${dir}${id}.png`);
    if (!res.ok) continue;
    try {
      img = decodePng(Buffer.from(await res.arrayBuffer()));
      from = dir;
      break;
    } catch { /* proximo */ }
  }
  if (!img) { console.log(`${id}: nao encontrado`); continue; }
  const { width: W, height: H, data } = img;
  console.log(`\n### ${id}  [${from}]  ${W}x${H}`);
  const step = Math.max(1, Math.round(W / 64));
  for (let y = 0; y < H; y += step) {
    let line = String(y).padStart(4) + ' |';
    for (let x = 0; x < W; x += step) {
      const [r, g, b] = px(x, y, data, W);
      line += sat(r, g, b) > 0.35 && lum(r, g, b) > 55 ? 'B'
        : ramp[Math.max(0, Math.min(9, Math.round((lum(r, g, b) / 255) * 9)))];
    }
    console.log(line);
  }
}