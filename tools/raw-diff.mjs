import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vision = require('../packages/native/cell-vision/index.js');
const { decodePng } = await import('./lib/png.mjs');
const G = await import('../packages/shared/dist/gallery.js');

const img = decodePng(fs.readFileSync('H:/Arcgxapp-ref/captures/inventario-01.png'));
const { width: W, height: H, data } = img;
const bgra = Buffer.allocUnsafe(data.length);
for (let i = 0; i < data.length; i += 4) {
  bgra[i] = data[i + 2]; bgra[i + 1] = data[i + 1]; bgra[i + 2] = data[i]; bgra[i + 3] = 255;
}
const S = 96;
const b = vision.prepareClassifierBatch(bgra, W, H, { x: 152, y: 367, width: 416, height: 624 }, S);

/** Mesma agregação da lib, mas devolve o CRU (0..255) sem normalizar. */
function raw(batch, size, index, top, side, grid) {
  const plane = size * size;
  const base = index * 3 * plane;
  const padTop = Math.floor(size * top);
  const padSide = Math.floor(size * side);
  const innerW = Math.max(2, size - 2 * padSide);
  const innerH = Math.max(2, size - padTop - padSide);
  const out = new Float32Array(grid * grid * 3);
  const blocks = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      let r = 0, g = 0, bl = 0, n = 0;
      const x0 = padSide + Math.floor((gx * innerW) / grid);
      const y0 = padTop + Math.floor((gy * innerH) / grid);
      const x1 = Math.min(size, padSide + Math.ceil(((gx + 1) * innerW) / grid));
      const y1 = Math.min(size, padTop + Math.ceil(((gy + 1) * innerH) / grid));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * size + x;
          r += batch[base + p] ?? 0;
          g += batch[base + plane + p] ?? 0;
          bl += batch[base + 2 * plane + p] ?? 0;
          n++;
        }
      }
      blocks.push({ gx, gy, x0, x1, y0, y1, n });
      const o = (gy * grid + gx) * 3;
      out[o] = n ? (r / n) * 255 : 255;
      out[o + 1] = n ? (g / n) * 255 : 255;
      out[o + 2] = n ? (bl / n) * 255 : 255;
    }
  }
  return { out, blocks, padTop, padSide, innerW, innerH };
}

const r = raw(b.data, S, 0, 0.135, 0.06, 12);
console.log('\n== geometria que MINHA funcao usa ==');
console.log(`  padTop=${r.padTop} padSide=${r.padSide} innerW=${r.innerW} innerH=${r.innerH}`);
console.log(`  bloco (0,0): x ${r.blocks[0].x0}..${r.blocks[0].x1}  y ${r.blocks[0].y0}..${r.blocks[0].y1}  n=${r.blocks[0].n}`);
console.log(`  out cru [R,G,B] do bloco (0,0) = ${r.out[0].toFixed(3)}, ${r.out[1].toFixed(3)}, ${r.out[2].toFixed(3)}`);

const libSig = G.signatureFromBatch(b.data, S, 0, 12, { top: 0.135, side: 0.06 });
const mineSig = G.normalizeSignature(r.out);
console.log(`  signatureFromBatch [0,1,2]     = ${libSig[0].toFixed(6)}, ${libSig[1].toFixed(6)}, ${libSig[2].toFixed(6)}`);
console.log(`  normalizeSignature(cru) [0,1,2]= ${mineSig[0].toFixed(6)}, ${mineSig[1].toFixed(6)}, ${mineSig[2].toFixed(6)}`);

// Se o cru for o mesmo, a assinatura tem de ser a mesma. Diferenca aqui
// significa que a agregacao da lib produz out diferente do meu loop.
let first = -1;
for (let i = 0; i < 432; i++) {
  if (Math.abs(libSig[i] - mineSig[i]) > 1e-6) { first = i; break; }
}
console.log(`\n  primeira divergencia: ${first === -1 ? 'NENHUMA — identicas' : 'indice ' + first}`);

if (first >= 0) {
  // Back-computa o cru da lib a partir da assinatura normalizada: e o mesmo
  // deslocamento linear, entao a forma do vetor revela a razao.
  const gm = Array.from(mineSig);
  const gl = Array.from(libSig);
  let mMean = 0, lMean = 0;
  for (const v of gm) mMean += v;
  for (const v of gl) lMean += v;
  mMean /= 432; lMean /= 432;
  let mNorm = 0, lNorm = 0;
  for (const v of gm) mNorm += (v - mMean) ** 2;
  for (const v of gl) lNorm += (v - lMean) ** 2;
  console.log(`  norma do meu  : ${Math.sqrt(mNorm).toFixed(6)}`);
  console.log(`  norma da lib  : ${Math.sqrt(lNorm).toFixed(6)}`);
  console.log(`  razao de amplitudes: ${(Math.sqrt(lNorm / mNorm)).toFixed(4)}`);

  // correlaciona os dois vetores ja centrados
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 432; i++) {
    const a = gm[i] - mMean, b2 = gl[i] - lMean;
    num += a * b2; da += a * a; db += b2 * b2;
  }
  console.log(`  correlacao centered: ${(num / Math.sqrt(da * db)).toFixed(4)}`);
}
console.log('');