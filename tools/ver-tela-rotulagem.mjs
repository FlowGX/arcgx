/**
 * Mostra os trechos de tela que o usuario ve, para conferir na unica fonte
 * que importa: o que vai aparecer no navegador.
 */

import { readFileSync } from 'node:fs';

const F = 'H:/Arcgxapp/dados/rotulo/rotular-lote.html';
const h = readFileSync(F, 'utf8');

const TRECHOS = [
  ['titulo', /<title>[^<]*<\/title>/],
  ['botao anterior', /id="ant"[^>]*>[^<]*/],
  ['botao proximo', /id="prox"[^>]*>[^<]*/],
  ['botao nao achei', /id="faltando"[^>]*>[^<]*/],
  ['botao vazia', /id="vazio"[^>]*>[^<]*/],
  ['botao copiar', /id="copiar"[^>]*>[^<]*/],
  ['vazio em destaque', /Use <strong>[\s\S]{0,40}?<\/strong>/],
  ['instrucao', /Clique na [\s\S]{0,120}?voltar\./],
  ['titulo paineis', /Semelhantes da c[\s\S]{0,60}?<\/span>/],
  ['nota similaridade', /similaridade[\s\S]{0,70}?parecido/],
  ['placeholder', /placeholder="[^"]*"/],
  ['comentario lista', /A lista aparece[\s\S]{0,90}?<\/div>/],
];

for (const [nome, re] of TRECHOS) {
  const m = h.match(re);
  console.log(`\n${nome}`);
  console.log('  ' + (m ? m[0].replace(/\s+/g, ' ') : '(nao encontrado)'));
}

// e o pior: sobrou algum caractere de substituicao?
const ruins = (h.match(/[\uFFFD\u2B1D\uFFFC\uFFFD]/g) || []).length;
console.log(`\ncaracteres de substituicao: ${ruins}`);