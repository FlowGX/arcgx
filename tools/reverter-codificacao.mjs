/**
 * Reverte codificacao dupla de UTF-8.
 *
 * ## O que aconteceu
 *
 * `Get-Content -Raw` no PowerShell 5.1 le sem `-Encoding` e assume a
 * ANSI do sistema (cp1252). O arquivo estava em UTF-8 correto. Lido como
 * cp1252, cada byte vira um caractere; reescrito com
 * `Set-Content -Encoding UTF8`, cada caractere vira UTF-8 de novo. O
 * arquivo continua sendo UTF-8 valido, so que com todo caractere trocado.
 *
 * Por isso este arquivo e escrito **sem acento nenhum**: um utilitario que
 * sofre exatamente do defeito que corrige nao pode depender de encoding
 * perfeito para rodar.
 *
 * ## Por que reverte em vez de regravar
 *
 * Cada passo e a inversa exata do anterior: ler os bytes atuais como UTF-8
 * devolve a string corrompida, e gravar essa string em Latin-1 devolve os
 * bytes originais. Um round-trip, sem dicionario e sem lista de erros.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('uso: node tools/reverter-codificacao.mjs <arquivo>');
  process.exit(1);
}

const antes = readFileSync(arquivo);
const antesTexto = antes.toString('utf8');

// marcas de codificacao dupla, em unicode escape para nao depender de encoding
const MARCAS = ['â€', 'Ã¡', 'Ã­', 'âœ', 'â€¦', 'Ãµ', 'Ã©', 'Ã³'];
const contar = (s) => MARCAS.reduce((n, m) => n + s.split(m).length - 1, 0);

const suspeitosAntes = contar(antesTexto);

// a inversa exata: string corrompida -> bytes Latin-1 -> bytes originais
const corrigido = Buffer.from(antesTexto, 'latin1');
writeFileSync(arquivo, corrigido);

const depois = readFileSync(arquivo).toString('utf8');
const suspeitosDepois = contar(depois);

console.log('arquivo   :', arquivo);
console.log('suspeitos :', suspeitosAntes, 'antes,', suspeitosDepois, 'depois');
console.log('bytes     :', antes.length, '->', corrigido.length);

for (const chave of ['Semelhantes', 'anterior', 'Célula', 'procurar']) {
  const achou = depois.includes(chave);
  console.log((achou ? 'ok      ' : 'AUSENTE ') + chave);
}