/**
 * Troca os glifos decorativos quebrados por entidades HTML.
 *
 * ## O estado
 *
 * O portugues esta integro: as vogais acentuadas sobreviveram. O que se
 * perdeu foram os caracteres na faixa U+2000+, que viraram U+FFFD depois do
 * round-trip: travessao, setas de navegacao, lapis e as aspas tipograficas.
 *
 * ## Por que entidade e nao o caractere
 *
 * `&mdash;` tem 7 bytes ASCII. `—` tem 3 bytes UTF-8 que ja sobreviveram a
 * dois round-trips por acidente — sao eles que quebram de novo na proxima
 * vez que alguem abrir o arquivo no PowerShell. O nome do item e o texto de
 * instrucao sao o que importa; a setinha e o lapis podem ser entidade.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const F = process.argv[2] ?? 'H:/Arcgxapp/dados/rotulo/rotular-lote.html';
let h = readFileSync(F, 'utf8');
let mudancas = 0;

/**
 * Cada regra casa pelo **contexto**, nao pelo caractere.
 *
 * Trocar todo U+FFFD por uma coisa so seria chute: o mesmo caractere quebrado
 * era travessao num lugar e seta em outro. O contexto diz qual e qual.
 */
const REGRAS = [
  { de: '<!doctype', para: '<!doctype', nota: 'BOM/FFFD inicial antes do doctype' },
  {
    de: /<\?body[\s\S]{0,80}?>/,
    para: '',
    nota: 'resquicioo inicial',
  },
  {
    de: /�<!doctype/gi,
    para: '<!doctype',
    nota: 'FFFD colado no doctype',
  },
  {
    de: /id="ant">[^<]*�/gi,
    para: 'id="ant">&#9664; anterior', // U+9664 = triangulo para esquerda
    nota: 'seta esquerda',
  },
  {
    de: /id="prox">próximo\s*�/gi,
    para: 'id="prox">próximo &#9654;', // U+9654 = triangulo para direita
    nota: 'seta direita',
  },
  {
    de: /id="faltando"[^>]*>\s*Não achei\s*[^\s<]*/gi,
    para: 'id="faltando" title="O item existe no jogo mas não está no catálogo. Registra o nome para a gente adicionar.">Não achei &#9998;', // U+9998 = lapis
    nota: 'icone de lapis',
  },
  {
    de: /<strong>\s*�Svazio\s*�<\/strong>/gi,
    para: '<strong>&ldquo;vazio&rdquo;</strong>',
    nota: 'aspas tipograficas',
  },
  {
    de: /Arc GX\s*�\s*rotular invent/gi,
    para: 'Arc GX &mdash; rotular invent',
    nota: 'travessao do titulo',
  },
  {
    de: /similaridade \$\{[^}]+\}\s*�\s*quanto maior/gi,
    para: 'similaridade ${melhor.toFixed(2)} &mdash; quanto maior',
    nota: 'travessao da nota de similaridade',
  },
  {
    de: /navegador\s*�\s*pode fechar/gi,
    para: 'navegador &mdash; pode fechar',
    nota: 'travessao da instrucao',
  },
  {
    de: /Armazenamento[^<]*�\s*come/gi,
    para: 'Armazenamento &mdash; come',
    nota: 'travessao legado',
  },
];

for (const r of REGRAS) {
  if (!r.de) continue;
  const antes = h;
  h = h.replace(r.de, r.para);
  if (h !== antes) {
    mudancas++;
    console.log(`ok      ${r.nota}`);
  }
}

// limpeza final: qualquer U+FFFD ou U+2B1D remanescente
const sobrou = (h.match(/[\uFFFD\u2B1D]/g) || []).length;
if (sobrou) {
  // remove os que sobraram em vez de deixar ils appear na tela
  const antes = h;
  h = h.replace(/[\uFFFD\u2B1D]+/g, '');
  console.log(`limpeza ${sobrou} caractere(s) orfao(s) removido(s)`);
  if (h === antes) console.log('atencao  nao foi possivel remover');
}

writeFileSync(F, h, 'utf8');
console.log(`\n${mudancas} regra(s) aplicada(s)`);
console.log(`mojibake restante: ${(h.match(/[\uFFFD\u2B1D]/g) || []).length}`);