/**
 * Prova que o caminho TypeScript da aplicacao da o mesmo resultado do Python.
 *
 * ## ## ## Por que este teste existe
 *
 * O classificador novo (`encoder-classifier.ts`) reimplementa, em JS, o que
 * `ml/raid.py` faz em Python: recortar a celula, codificar, buscar. Sao duas
 * copias do mesmo passo, e a sessao ja pagou varias vezes por ter copias
 * divergentes — `avaliar.py` media a arte pura enquanto o treino usava
 * moldura, e o classificador "errado" dava 0,3%.
 *
 * Este script roda o ONNX por Node, sobre os mesmos recortes, e compara com
 * o gabarito gravado pelo Python. Se divergirem, o bug esta no JS.
 *
 * Uso:
 *   node tools/testar-classificador.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = 'H:/Arcgxapp';
const { EncoderClassifier } = await import(
  pathToFileURL(path.join(RAIZ, 'apps/workers/dist/encoder-classifier.js')).href
);

const CELULA_W = 92;
const CELULA_H = 104;

const arquivos = readdirSync(path.join(RAIZ, 'dados/rotulo/live-celulas'))
  .filter((f) => f.endsWith('.bgra'))
  .sort();
if (!arquivos.length) {
  console.error(
    'sem .bgra em dados/rotulo/live-celulas — rode:\n' +
      '  python ml/contar-live.py <frame> mochila\n' +
      'ou  node tools/rotulo/contar-raid.mjs --painel mochila',
  );
  process.exit(1);
}

const gabarito = JSON.parse(
  readFileSync(path.join(RAIZ, 'dados/rotulo/qtd-gabarito.json'), 'utf-8'),
);

const cel = await EncoderClassifier.create(path.join(RAIZ, 'apps/main/resources'));
console.log(`galeria: ${cel.size} itens  espaco ${cel.space}  lado ${cel.lado}\n`);

const imagens = arquivos.map((f) => ({
  pixels: new Uint8Array(readFileSync(path.join(RAIZ, 'dados/rotulo/live-celulas', f))),
  width: CELULA_W,
  height: CELULA_H,
}));

const t0 = performance.now();
const hits = await cel.recognize(imagens);
const ms = performance.now() - t0;

console.log(
  `${'celula'.padEnd(18)}${'item'.padEnd(24)}${'score'.padStart(7)}  ${'2o'.padEnd(12)}margem`,
);
console.log('-'.repeat(74));
let acertos = 0;
let comGabarito = 0;
for (let i = 0; i < hits.length; i++) {
  const h = hits[i];
  const gt = gabarito[arquivos[i].replace('.bgra', '')];
  const margem = h.score - h.runnerUpScore;
  let marca = '';
  if (gt) {
    comGabarito++;
    if (h.itemId === gt) {
      acertos++;
      marca = '  ok';
    } else marca = `  ERR (gabarito ${gt})`;
  }
  console.log(
    `${arquivos[i].replace('.bgra', '').padEnd(18)}${h.itemId.padEnd(24)}` +
      `${h.score.toFixed(3).padStart(7)}  ${(h.runnerUp ?? '-').padEnd(12)}` +
      `${margem.toFixed(3)}${h.ambiguous ? ' amb' : ''}${marca}`,
  );
}
console.log('-'.repeat(74));
console.log(
  `lote de ${imagens.length}: ${ms.toFixed(1)} ms  (${(ms / imagens.length).toFixed(2)} ms/celula)`,
);
if (comGabarito) console.log(`identidade: ${acertos}/${comGabarito}`);