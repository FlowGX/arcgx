/**
 * Caça os residuos da truncagem: caracteres de controle dentro do texto.
 *
 * ## Como surgiram
 *
 * cp1252 mapeia `0x94` para U+201D (") e nao para U+0094. Ao gravar a
 * string corrompida de volta em Latin-1, Node trunca o que passa de `0xFF`:
 * U+201D virou `0x1D`. Cada byte acima de `0x7F` queHadesse passado por
 * essa etapa virou um caractere de controle ou um U+FFFD.
 *
 * ## Por que invisivel
 *
 * `0x1D` nao e acentento, nao e caixa alta, nao quebra o HTML. Passa
 * batido num diff e aparece na tela como um espaco em branco. Por isso a
 * busca por "mojibake" nao achou: o mojibake sumiu, e sobrou lixo invisivel.
 */

import { readFileSync } from 'node:fs';

const F = process.argv[2] ?? 'H:/Arcgxapp/dados/rotulo/rotular-lote.html';
const h = readFileSync(F, 'utf8');

const ctrl = new Map();
const substit = new Map();

let i = 0;
while (i < h.length) {
  const cp = h.codePointAt(i);
  const n = String.fromCodePoint(cp).length;
  const dentro = (cp >= 0 && cp <= 0x1f && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d);
  const sub = cp === 0xfffd || cp === 0x2b1d || cp === 0xfffc;
  if (dentro || sub) {
    const chave = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    const alvo = dentro ? ctrl : substit;
    if (!alvo.has(chave)) {
      alvo.set(chave, {
        cp,
        contextos: [],
      });
    }
    const reg = alvo.get(chave);
    if (reg.contextos.length < 6) {
      reg.contextos.push(
        h.slice(Math.max(0, i - 40), Math.min(h.length, i + n + 40)).replace(/\n/g, '\\n'),
      );
    }
  }
  i += n;
}

const mostrar = (titulo, mapa) => {
  if (!mapa.size) return;
  console.log(`\n=== ${titulo} ===`);
  for (const [chave, r] of mapa) {
    console.log(`${chave}  (${r.contextos.length} ocorrencia(s))`);
    for (const c of r.contextos) console.log(`    ...${c}...`);
  }
};

mostrar('controle', ctrl);
mostrar('substituicao', substit);

console.log(`\ncontrole: ${ctrl.size} tipo(s)  |  substituicao: ${substit.size} tipo(s)`);