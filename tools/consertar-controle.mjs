/**
 * Troca os caracteres de controle remanescentes pelas entidades HTML certas.
 *
 * ## O que sao
 *
 * Resíduo da truncagem do round-trip cp1252. `0x94` (truncado de U+201D),
 * `0x95` e `0x8C` foram cortados para `0x1D`, `0x14` e `0x13`. Cada um
 * correspondia a um glifo tipografico:
 *
 *   0x1D -> U+2014 EM DASH        (travessao)
 *   0x14 -> U+2022 BULLET         (ponto de confianca)
 *   0x13 -> U+2192 RIGHT ARROW    (seta)
 *
 * ## Por que cada um pelo contexto
 *
 * Os tres controles sao reutilizados em varios lugares com glifos diferentes.
 * Trocar todo `0x1D` pela mesma coisa seria chute. A regra abaixo casa pelo
 * que esta **em volta**, que e unico.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const F = process.argv[2] ?? 'H:/Arcgxapp/dados/rotulo/rotular-lote.html';
let h = readFileSync(F, 'utf8');
const GS = '\u001d'; // 0x1D, era travessao
const DC4 = '\u0014'; // 0x14, era bullet
const DC3 = '\u0013'; // 0x13, era seta
const antes = { gs: (h.match(new RegExp(GS, 'g')) || []).length, dc4: (h.match(new RegExp(DC4, 'g')) || []).length, dc3: (h.match(new RegExp(DC3, 'g')) || []).length };

// 1. bullets de confianca: 0x14 dentro de um <span style="color:..."> e
//    o outro esta colado num numero ("o9")
h = h.replace(new RegExp(`<span style="color:var\\(--ok\\)">${DC4}</span>`, 'g'), '<span style="color:var(--ok)">&#9679;</span>');
h = h.replace(new RegExp(`<span style="color:var\\(--warn\\)">${DC4}</span>`, 'g'), '<span style="color:var(--warn)">&#9679;</span>');
h = h.replace(new RegExp(`<span style="color:#8a6a5a">${DC4}9</span>`, 'g'), '<span style="color:#8a6a5a">&#9675;9</span>');
//    sem numero: quando o corte comeu o resto do numero junto
h = h.replace(new RegExp(`(<span style="color:#8a6a5a">)${DC4}(</span>)`, 'g'), '$1&#9675;$2');

// 2. seta depois de "proximo"
h = h.replace(new RegExp(`próximo\\s*${DC3}`, 'g'), 'próximo &#9654;');

// 3. travessoes: tudo que sobrou de 0x1D vira &mdash;, com espacamento limpo
h = h.replace(new RegExp(`\\s*${GS}\\s*`, 'g'), ' &mdash; ');
h = h.replace(/&mdash;(?=\s*(?:<|[a-zà-ú]))/gi, '&mdash;');
h = h.replace(/ {2,}&mdash;/g, ' &mdash;');
h = h.replace(/&mdash;\s{2,}/g, '&mdash; ');

// 4. e o "Svazio" que o limpador deixou: aspas viraram "S"
h = h.replace(/<strong>Svazio<\/strong>/g, '<strong>&ldquo;vazio&rdquo;</strong>');

// 5. e o placeholder do progresso, que era um travessao solto
h = h.replace(new RegExp(`id="progresso">${GS}<`, 'g'), 'id="progresso">&mdash;<');

writeFileSync(F, h, 'utf8');

const depois = {
  gs: (h.match(new RegExp(GS, 'g')) || []).length,
  dc4: (h.match(new RegExp(DC4, 'g')) || []).length,
  dc3: (h.match(new RegExp(DC3, 'g')) || []).length,
};

console.log('controle   antes -> depois');
console.log(`0x1D travessao  ${antes.gs} -> ${depois.gs}`);
console.log(`0x14 bullet     ${antes.dc4} -> ${depois.dc4}`);
console.log(`0x13 seta       ${antes.dc3} -> ${depois.dc3}`);

const restantes = Object.values(depois).reduce((a, b) => a + b, 0);
console.log(restantes ? `\n${restantes} restante(s)` : '\nlimpo');