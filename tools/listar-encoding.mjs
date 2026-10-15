/**
 * Lista cada caractere nao-ASCII do arquivo, com onde ele aparece.
 *
 * ## Por que a reversao anterior ficou pela metade
 *
 * UTF-8 lido como cp1252 nao e reversivel byte a byte. O byte `0x94` vira
 * U+201D (") em cp1252, nao U+0094. Gravar essa string de volta em
 * Latin-1 trunca: U+201D passou de 0xFF e virou `0x1D`.
 *
 * Entao o round-trip "le como UTF-8, grava como Latin-1" conserta os casos
 * que caem abaixo de 0x80 e estraga os de cima — trocou um bug por outro.
 *
 * Este script mostra o estado real para decidir caractere a caractere, em vez
 * de tentar outra regra geral.
 */

import { readFileSync } from 'node:fs';

const F = process.argv[2] ?? 'H:/Arcgxapp/dados/rotulo/rotular-lote.html';
const h = readFileSync(F, 'utf8');

const mapa = new Map();
let i = 0;
while (i < h.length) {
  const cp = h.codePointAt(i);
  const ch = String.fromCodePoint(cp);
  const n = ch.length;
  if (cp > 127) {
    const chave = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    if (!mapa.has(chave)) mapa.set(chave, { ch, cp, n, exemplos: [] });
    const reg = mapa.get(chave);
    if (reg.exemplos.length < 2) {
      const ini = Math.max(0, i - 22);
      const fim = Math.min(h.length, i + n + 22);
      reg.exemplos.push(h.slice(ini, fim).replace(/\n/g, ' '));
    }
  }
  i += n;
}

console.log(`arquivo: ${F}`);
console.log(`${mapa.size} caractere(s) nao-ASCII\n`);

// os que fazem sentido em texto portugues
const PORTUGUES = /[\u00C0-\u00FF]/;

const ordenados = [...mapa.values()].sort((a, b) => a.cp - b.cp);
for (const r of ordenados) {
  const ok = PORTUGUES.test(r.ch);
  console.log(
    `${ok ? 'PORTUGUES ' : 'SUSPECHO '} U+${r.cp.toString(16).toUpperCase().padStart(4, '0')}  ${JSON.stringify(r.ch)}`,
  );
  for (const e of r.exemplos) console.log(`           ... ${e} ...`);
}