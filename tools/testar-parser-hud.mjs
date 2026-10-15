/**
 * O parser de HUD contra o que o Tesseract ja devolveu de verdade.
 *
 * ## ## ## Por que este arquivo existe
 *
 * A confianca do motor nao separa nada aqui — um acerto com `0/10` veio com
 * `conf=5`, e o recorte estreito demais devolveu `000` com `conf=96`. A unica
 * coisa que separa e a **forma** do texto, entao a forma e o que precisa de
 * teste.
 *
 * Todos os casos `bruto` abaixo sao saidas reais, medidas em
 * `tools/ocr-probe-tesseract.mjs` sobre as capturas de `dados/rotulo/raid/`.
 * Nenhum foi inventado para o teste passar.
 */

import { lerContador, lerTotalBr } from '../packages/shared/dist/hud.js';

/** @type {[string, boolean][]} texto bruto -> deve produzir contador */
const CONTADORES = [
  ['4/20', true],
  ['10/22', true],
  ['6/22', true],
  ['0/10', true],
  ['0/4', true],
  ['0/3', true],
  ['5/5', true],
  ['4/4', true],
  ['2/2', true],
  ['1/1', true],
  ['1/2', true],
  ['4/5', true],

  // Formas que ja apareceram e **nao** sao contador. Mostrar 0/0 aqui seria
  // pior do que nao mostrar: o jogador veria um numero que o jogo nao escreveu.
  // '00/3' vem de um recorte com um caractere antes do numero. Ainda e
  // 0/3, e parsear e o certo: o que nao pode e transformar em 0/3 sem
  // nenhuma checagem, e por isso que a forma continua sendo exigida.
  ['00/3', true],
  ['0111', false], // ROI errada pegando borda
  ['11', false],
  ['000', false],
  ['', false],
  ['ARMAMENTO', false],
  ['9/20X', false],
  ['99/9', false], // ocupado > capacidade: o recorte pegou outra coisa
  ['100/200', true], // tres digitos de cada lado, cabe no recorte
];

let falhasContador = 0;
for (const [texto, esperado] of CONTADORES) {
  const got = lerContador(texto);
  const ok = (got !== null) === esperado;
  if (!ok) falhasContador++;
  const detalhe = got ? `${got.ocupado}/${got.capacidade}` : 'null';
  console.log(`${ok ? 'OK  ' : 'ERR '} contador ${JSON.stringify(texto).padEnd(14)} -> ${detalhe}`);
}

/** @type {[string, number|null][]} texto bruto -> total esperado */
const TOTAIS = [
  ['43.679', 43679],
  ['34.102', 34102],
  ['2.000', 2000],
  ['29.484', 29484],
  // O Tesseract troca pontuacao; nesta regiao nao ha decimal, entao virgula
  // como separador de milhar e o comportamento correto.
  ['29,484', 29484],
  ['118.969', 118969],
  ['139.866', 139866],
  ['2,000', 2000],

  // Nao sao total de raid: ficam fora em vez de virar numero na tela.
  ['0,0/40,0', null], // o peso, que nao entra
  ['00/4002', null],
  ['4/20', null], // contador, nao total
  ['11', null], // pequeno demais para ser total de raid
  ['11', null],
  ['', null],
  ['ARMAMENTO', null],
  ['0', null],
];

let falhasTotal = 0;
for (const [texto, esperado] of TOTAIS) {
  const got = lerTotalBr(texto);
  const ok = got === esperado;
  if (!ok) falhasTotal++;
  console.log(`${ok ? 'OK  ' : 'ERR '} total    ${JSON.stringify(texto).padEnd(14)} -> ${got}`);
}

const falhas = falhasContador + falhasTotal;
console.log(`\n${CONTADORES.length + TOTAIS.length - falhas}/${CONTADORES.length + TOTAIS.length} casos`);
if (falhas) {
  console.error(`\nFALHA: ${falhas} caso(s) de parser`);
  process.exit(1);
}
console.log('ok: parser bate com as saidas reais do Tesseract');