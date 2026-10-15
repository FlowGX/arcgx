/**
 * Mede a geometria real da grade de inventario numa captura do jogo.
 * Nada aqui e chute: tudo sai do pixel.
 */
import fs from 'node:fs';
import { decodePng } from '../tools/lib/png.mjs';

const file = process.argv[2] || 'H:/Arcgxapp-ref/captures/inventario-01.png';
const img = decodePng(fs.readFileSync(file));
const { width: W, height: H, data } = img;

console.log('\nimagem: ' + W + 'x' + H + '\n');

const px = (x, y) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};
const lum = (x, y) => {
  const [r, g, b] = px(x, y);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const sat = (x, y) => {
  const [r, g, b] = px(x, y);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

/* ------------------------------------------------- onde estao os paineis */

// bordas coloridas = alta saturacao e brilho medio
function coloredScore(x, y) {
  const s = sat(x, y);
  const l = lum(x, y);
  return s > 0.35 && l > 60 ? 1 : 0;
}

// perfil de饱和 na metade esquerda (ARMAZENAMENTO)
const rowCol = new Float32Array(H);
const colRow = new Float32Array(W);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < 620; x++) if (coloredScore(x, y)) rowCol[y]++;
}
for (let x = 0; x < 620; x++) {
  for (let y = 0; y < H; y++) if (coloredScore(x, y)) colRow[x]++;
}

function peaks(prof, from, to, minVal) {
  const out = [];
  for (let i = from + 1; i < to - 1; i++) {
    if (prof[i] >= minVal && prof[i] >= prof[i - 1] && prof[i] > prof[i + 1]) out.push(i);
  }
  return out;
}

const rowMax = Math.max(...rowCol);
const colMax = Math.max(...colRow);
console.log('perfil de bordas coloridas (metade esquerda)');
console.log('  max linha: ' + rowMax + '  max coluna: ' + colMax + '\n');

const rp = peaks(rowCol, 100, H - 40, rowMax * 0.35);
const cp = peaks(colRow, 100, 620, colMax * 0.35);
console.log('picos de LINHA  (' + rp.length + '): ' + rp.slice(0, 24).join(', '));
console.log('picos de COLUNA (' + cp.length + '): ' + cp.slice(0, 24).join(', '));

if (rp.length > 2) {
  const d = [];
  for (let i = 1; i < rp.length; i++) d.push(rp[i] - rp[i - 1]);
  console.log('\ndistancias entre linhas: ' + [...new Set(d)].slice(0, 10).join(', '));
}
if (cp.length > 2) {
  const d = [];
  for (let i = 1; i < cp.length; i++) d.push(cp[i] - cp[i - 1]);
  console.log('distancias entre colunas: ' + [...new Set(d)].slice(0, 10).join(', '));
}

/* --------------------------------------------- cor da borda por tier */

console.log('\namostra de cores de borda (as mais saturadas):');
const tones = new Map();
for (let y = 150; y < H - 60; y++) {
  for (let x = 130; x < 620; x++) {
    const s = sat(x, y);
    if (s < 0.45) continue;
    const [r, g, b] = px(x, y);
    if (lum(x, y) < 70) continue;
    const key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
    tones.set(key, (tones.get(key) || 0) + 1);
  }
}
const top = [...tones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [k, n] of top) {
  const [r, g, b] = k.split(',').map((v) => Number(v) * 16 + 8);
  const hue = (Math.max(r, g, b) === r ? (g - b) / (Math.max(r, g, b) - Math.min(r, g, b) || 1) * 60 : 0);
  const name = r > g && r > b ? 'vermelho/magenta' : g > r && g > b ? 'verde' : b > r ? 'azul' : 'amarelo';
  console.log('  rgb(' + String(r).padStart(3) + ',' + String(g).padStart(3) + ',' + String(b).padStart(3) + ')  x' + n + '  ~' + name);
}
console.log('');