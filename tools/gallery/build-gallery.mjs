/**
 * Gera a galeria de ícones a partir da arte real do catálogo.
 *
 *   node tools/gallery/build-gallery.mjs [--items <items.json>] [--out <gallery.json>]
 *                                         [--x N] [--y N] [--size N]
 *
 * Os parâmetros da posição do ícone (`--x/--y/--size`) têm que ser **medidos**,
 * não chutados: `tools/gallery/calibrate.mjs` procura os que melhor casam
 * contra uma captura real. Chutar aqui e conferir depois era o jeito de a
 * primeira tentativa dar 0 de 20.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { S, decodePng, montarCelula, celulaParaBatch, reamostrarBilinear } from './build.mjs';

// o barrel (`dist/index.js`) traria `logger.js`, que usa `mkdirSync` — e isso
// quebra o bundle do browser. Por isso o import é por módulo.
const G = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery.js');
const MULTI = await import('file:///H:/Arcgxapp/packages/shared/dist/gallery-multi.js');

/* ------------------------------------------------------------- argumentos */

const argv = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = argv.indexOf('--' + nome);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : padrao;
};

/** Medido por `calibrate.mjs`; ver tools/gallery/CALIBRACAO.md. */
const GEOM = {
  x: Number(arg('x', 31)),
  y: Number(arg('y', 25)),
  size: Number(arg('size', 34)),
};

const ITEMS = arg('items', 'H:/Arcgxapp/dados/game/items.json');
const OUT = arg('out', 'H:/Arcgxapp/models/gallery.json');
const LIMITE = Number(arg('limit', '0')); // 0 = todos
const CONC = Number(arg('conc', '8'));

/**
 * Lado da amostra do batch.
 *
 * `worker-runtime.ts` chama `prepareClassifierBatch(..., 12)`: a célula vira
 * 12×12 e o classificador assina em cima disso. A galeria tem que usar o
 * mesmo número.
 */
const CELL_SIZE = Number(arg('cell', '12'));

/* ------------------------------------------------------------------ run */

const itens = JSON.parse(readFileSync(ITEMS, 'utf8')).items;
const alvos = Object.values(itens).filter((i) => i.imageFilename);
if (LIMITE > 0) alvos.length = Math.min(alvos.length, LIMITE);

console.log(`galeria: ${alvos.length} itens | ícone em x=${GEOM.x} y=${GEOM.y} size=${GEOM.size}`);

const galeria = {};
let ok = 0;
let falhas = 0;
let i = 0;

async function worker() {
  for (;;) {
    const idx = i++;
    if (idx >= alvos.length) return;
    const it = alvos[idx];

    try {
      const r = await fetch(it.imageFilename);
      if (!r.ok) throw new Error('http ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const img = decodePng(buf);
      // Monte a célula 96×96 e reamostra para o MESMO tamanho que o
      // `cell-vision` produz em produção. Sem isso a galeria é assinada numa
      // escala e a consulta em outra, e as duas não descrevem a mesma região.
      const celula = montarCelula(img, GEOM);
      const batch = reamostrarBilinear(celula, CELL_SIZE);
      const sig = MULTI.signatureFromBatchMulti(batch, CELL_SIZE, 0);
      galeria[it.id] = G.encodeSignature(sig);
      ok++;
    } catch (err) {
      falhas++;
      if (falhas <= 5) console.log(`  falha em ${it.id}: ${err.message}`);
    }

    if ((ok + falhas) % 100 === 0) {
      console.log(`  ${ok + falhas}/${alvos.length} (ok ${ok}, falhas ${falhas})`);
    }
  }
}

await Promise.all(Array.from({ length: CONC }, worker));

const saida = {
  version: 2,
  builtAt: new Date().toISOString(),
  cell: S,
  /** qual assinador gerou estas assinaturas — o classificador precisa saber */
  assinatura: 'multiescala',
  escalas: [8, 16],
  corGrade: 4,
  cellSize: CELL_SIZE,
  geom: GEOM,
  count: ok,
  items: galeria,
};

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(saida), 'utf8');

console.log(`\n${ok} assinaturas -> ${OUT}`);
console.log(`falhas: ${falhas}`);
console.log(
  `tamanho: ${(Buffer.byteLength(JSON.stringify(saida)) / 1024).toFixed(0)} KB`,
);
