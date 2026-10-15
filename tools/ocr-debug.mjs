import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cap = require('@arcgx/wgc-capture');
const ocr = require('@arcgx/ocr');

const INVIS = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);
const norm = (s) => {
  let o = '';
  for (const c of String(s ?? '')) {
    const p = c.codePointAt(0);
    if (INVIS.has(p)) continue;
    o += p >= 0x2000 && p <= 0x200a ? ' ' : p === 0x202f || p === 0x205f || p === 0x3000 ? ' ' : c;
  }
  return o.replace(/\s+/g, ' ').trim();
};

const janelas = await cap.listWindows();
const jogo = janelas.find(
  (w) => norm(w.title).toLowerCase().includes('arc') && norm(w.title).toLowerCase().includes('raider'),
);
console.log('titulo:', JSON.stringify(norm(jogo?.title ?? '')));

cap.startCapture(jogo.hwnd);
await new Promise((r) => setTimeout(r, 1500));
const f = await cap.pollFrame();
cap.stopCapture();

console.log(`frame: ${f.width}x${f.height}  stride=${f.stride} canais=${f.canais}`);
writeFileSync('H:/Arcgxapp/dados/rotulo/_frame1050.raw', Buffer.from(f.data));

console.log('\n--- OCR na tela inteira ---');
const t0 = performance.now();
const r = ocr.recognize(f.data, f.width, f.height);
const ms = performance.now() - t0;

if (r === null || r === undefined) {
  console.log('recognize ->', r);
} else {
  console.log(`${ms.toFixed(0)} ms  palavras=${r.words?.length ?? 'sem words'}`);
  if (typeof r.text === 'string') console.log('texto:', JSON.stringify(r.text.slice(0, 400)));
  for (const w of (r.words ?? []).slice(0, 18)) {
    console.log(`  "${w.text}" conf=${(w.confidence ?? 0).toFixed(2)} em ${Math.round(w.x)},${Math.round(w.y)} ${Math.round(w.width)}x${Math.round(w.height)}`);
  }
}

console.log('\n--- OCR so num recorte do painel ---');
const ex = f.width / 1920;
const ey = f.height / 1080;
const X = Math.round(1043 * ex);
const Y = Math.round(271 * ey);
const Wc = Math.round(416 * ex);
const Hc = Math.round(520 * ey);
const crop = new Uint8Array(Wc * Hc * 4);
for (let yy = 0; yy < Hc; yy++) {
  const src = ((Y + yy) * f.width + X) * 4;
  crop.set(f.data.subarray(src, src + Wc * 4), yy * Wc * 4);
}
const r2 = ocr.recognize(crop, Wc, Hc);
console.log(r2 ? `palavras=${r2.words?.length ?? '?'} texto=${JSON.stringify((r2.text ?? '').slice(0, 200))}` : '-> null');