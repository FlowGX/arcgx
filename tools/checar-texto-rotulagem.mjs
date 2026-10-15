/**
 * Confere o texto da pagina de rotulagem apos a reversao de encoding.
 *
 * Procurar por palavra acentuada e fragil: o rotulo pode ter sido escrito
 * sem acento de proposito. O que importa e o arquivo **nao** conter marca de
 * codificacao dupla, e os trechos fixos de instrucao continuarem intactos.
 */

import { readFileSync } from 'node:fs';

const F = 'H:/Arcgxapp/dados/rotulo/rotular-lote.html';
const h = readFileSync(F, 'utf8');

const MARCAS_MOJIBAKE = ['â€', 'Ã¡', 'Ã­', 'âœ', 'â€¦', 'Ãµ', 'Ã©', 'Ã³', 'Ã§', 'Ã£'];
let erros = 0;

const ruins = MARCAS_MOJIBAKE.reduce((n, m) => n + h.split(m).length - 1, 0);
console.log((ruins ? 'FALHA  ' : 'ok     ') + `marcadores de codificacao dupla: ${ruins}`);
if (ruins) erros++;

// trechos que precisam estar inteiros
const TRECHOS = [
  'Rotular invent',
  'Semelhantes da c',
  'Clique na c',
  'Marcar vazia',
  'Copiar da anterior',
  'Baixar gabarito.json',
  'Salvar progresso',
];
console.log();
for (const t of TRECHOS) {
  const ok = h.includes(t);
  if (!ok) erros++;
  console.log((ok ? 'ok     ' : 'FALHA  ') + t);
}

// placeholders:utchau que会出现 mojibake
const ph = [...h.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]);
console.log();
ph.forEach((p) => console.log('  placeholder: ' + p));

// e a lista de sugestoes, que era a funcionalidade nova
const tem = h.includes('pintarSugestoes') && h.includes('id="sugestoes"');
console.log();
console.log((tem ? 'ok     ' : 'FALHA  ') + 'lista de sugestoes presente');

console.log();
console.log(erros ? `${erros} problema(s).` : 'texto integro.');
process.exit(erros ? 1 : 0);