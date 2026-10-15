/**
 * Top-3 por célula, para montar o gabarito à mão.
 *
 * Todo o ajuste de limiar até aqui foi medido contra um conjunto **sem
 * rótulo** — "quantas células passaram" não diz se as que passaram estão
 * certas. Antes de gastar mais esforço em limiar, é preciso saber a resposta
 * certa. Este script imprime os candidatos para cada célula da captura; o
 * gabarito sai de olhar a captura ao lado da lista.
 */

import { readFileSync } from 'node:fs';

import { S, decodePng, montarCelula, reamostrarBilinear } from './build.mjs';

const G = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery.js');
const M = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery-multi.js');

const CELL = Number(process.env.CELL ?? 12);
const MIN_SCORE = Number(process.env.MIN ?? 0.7);
const MIN_MARGIN = Number(process.env.MARGIN ?? 0.01);

const CELULAS = [];
for (let r = 0; r < 5; r++)
  for (let c = 0; c < 4; c++)
    CELULAS.push({ x: [154, 257, 361, 465][c], y: [378, 482, 586, 690, 794][r], w: 91, h: 91 });

const galeria = JSON.parse(readFileSync('H:/Arcgxapp/models/gallery.json', 'utf8'));
console.log(
  `galeria: ${galeria.count} assinaturas | assinatura=${galeria.assinatura} cell=${galeria.cellSize}\n`,
);

const img = decodePng(readFileSync('H:/Arcgxapp-ref/captures/inventario-01.png'));
const px = img.canais === 4 ? 4 : 3;

const sigs = CELULAS.map((c) => {
  const rgb = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) {
    const sy = c.y + y;
    if (sy < 0 || sy >= img.h) continue;
    for (let x = 0; x < S; x++) {
      const sx = c.x + x;
      if (sx < 0 || sx >= img.w) continue;
      const p = (sy * img.w + sx) * px;
      const d = (y * S + x) * 3;
      rgb[d] = img.data[p];
      rgb[d + 1] = img.data[p + 1];
      rgb[d + 2] = img.data[p + 2];
    }
  }
  return M.signatureFromBatchMulti(reamostrarBilinear(rgb, CELL), CELL, 0);
});

console.log('GABARITO  ->  preencha o itemId correto (ou "?" se a celula nao tem item de catalogo)\n');
let certas = 0;
let cells = 0;
const linhas = [];

CELULAS.forEach((c, i) => {
  const todos = Object.entries(galeria.items)
    .map(([id, signature]) => ({ id, s: G.cosine(sigs[i], G.decodeSignature(signature)) }))
    .sort((a, b) => b.s - a.s);
  const top = todos.slice(0, 3);
  const margem = top[0].s - (top[1]?.s ?? 0);
  const ok = top[0].s >= MIN_SCORE && margem >= MIN_MARGIN;
  if (ok) {
    certas++;
    cells++;
  }
  linhas.push(
    `cel ${String(i).padStart(2)}  ${ok ? 'ATIVA' : '  --  '}  ` +
      top
        .map((t) => `${t.id.replace(/_/g, ' ').padEnd(30)} ${t.s.toFixed(3)}`)
        .join(' | ') +
      `   margem=${margem.toFixed(4)}`,
  );
});

for (const l of linhas) console.log(l);
console.log(`\nativas: ${certas}/${CELULAS.length} (com nota>=${MIN_SCORE} e margem>=${MIN_MARGIN})`);
