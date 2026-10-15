/**
 * Confere se a pagina de rotulagem esta coerente depois das trocas de UI.
 *
 * Trocar `<select>` por lista propria costuma deixar referencia morta: um
 * `onclick` apontando para `#escolha` que nao existe mais nao da erro visivel,
 * simplesmente nao faz nada. O sintoma e "o botao nao responde" sem pista.
 */

import { readFileSync } from 'node:fs';

const F = 'H:/Arcgxapp/dados/rotulo/rotular-lote.html';
const h = readFileSync(F, 'utf8');

let erros = 0;

const precisa = (p, msg) => {
  const ok = h.includes(p);
  if (!ok) erros++;
  console.log(`${ok ? 'ok      ' : 'FALTA   '} ${p}${msg ? '  — ' + msg : ''}`);
};

const naoPode = (p, msg) => {
  const existe = h.includes(p);
  if (existe) erros++;
  console.log(`${existe ? 'ORFAO   ' : 'ok      '} ${p}${msg ? '  — ' + msg : ''}`);
};

console.log('elementos que precisam existir:');
precisa('id="vizinhos"');
precisa('id="viz-nota"');
precisa('id="sugestoes"');
precisa('id="busca"');
precisa('id="copiar"');

console.log('\nfuncoes que precisam existir:');
for (const f of ['pintarVizinhos', 'pintarSugestoes', 'copiarAnterior', 'aplicar', 'desenhar', 'filtrar', 'ordenar', 'marcar', 'escapeHtml']) {
  precisa(`function ${f}`);
}

console.log('\nreferencias que precisam ter sumido (UI trocada):');
naoPode('id="escolha"', 'select removido');
naoPode("$('#escolha')", 'handler apontando para select morto');
naoPode("$('#aplicar')", 'botao removido');
naoPode('opcoes();', 'preenchimento do select');

console.log('\nids usados por handlers:');
const handlers = [...h.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]);
const unicos = [...new Set(handlers)];
for (const id of unicos) {
  const tem = h.includes(`id="${id}"`);
  if (!tem) erros++;
  console.log(`${tem ? 'ok      ' : 'ORFAO   '} #${id}`);
}

console.log(erros ? `\n${erros} problema(s).` : '\nnenhum problema.');
process.exit(erros ? 1 : 0);