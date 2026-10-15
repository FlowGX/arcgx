/**
 * ## ## ## Por que este script existe
 *
 * Duas coisas no pacote nunca foram versionadas, e ambas quebram o build em
 * uma máquina limpa:
 *
 *  1. `apps/main/resources/ocr/eng.traineddata.gz` — o Tesseract **baixa** o
 *     modelo em tempo de execução se ele não achar o arquivo. No app
 *     empacotado isso significa Internet no primeiro uso e, em máquina sem
 *     rede, nenhum contador. O arquivo veio de `@tesseract.js-data/eng`.
 *
 *  2. `apps/main/resources/_galeria/` — as Embeddings treinadas. Sem elas o
 *     app não quebra, o que é pior: cai no dHash e passa a errar 38% dos
 *     itens sem nenhum aviso.
 *
 * O traineddata é copiado daqui. A galeria **é** versionada: são 5 MB e é o
 * modelo em si, treinado a partir das capturas de tela do usuário.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const raiz = process.cwd();

/**
 * ## ## ## Por que procurar por pasta e nao por `require.resolve`
 *
 * `@tesseract.js-data/eng` expoe varias versoes em subpastas e **nem todas tem
 * `package.json`** — só a raiz. Resolver `.../4.0.0_best_int/package.json`
 * estoura com MODULE_NOT_FOUND, e o prebuild inteiro quebra num clone novo.
 *
 * A ordem importa: `_best_int` e o modelo de precisao alta e e o que o app
 * usa. Se faltar algum dia, cai no `4.0.0` comum em vez de nao copiar nada.
 */
const CANDIDATOS = [
  join(raiz, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'),
  join(raiz, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0', 'eng.traineddata.gz'),
];

const ORIGEM = CANDIDATOS.find((p) => existsSync(p));

const DESTINO = join(raiz, 'apps', 'main', 'resources', 'ocr', 'eng.traineddata.gz');

if (!ORIGEM) {
  console.error('[recursos] traineddata nao encontrado em nenhuma de:');
  for (const c of CANDIDATOS) console.error(`  ${c}`);
  console.error('[recursos] rode `npm install` antes.');
  process.exit(1);
}

mkdirSync(dirname(DESTINO), { recursive: true });

const origemMtime = statSync(ORIGEM).mtimeMs;
const destinoMtime = existsSync(DESTINO) ? statSync(DESTINO).mtimeMs : 0;

// Só copia quando muda. Copiar sempre ressuscita o mtime e faz o
// electron-builder reempacotar 108 MB a cada build.
if (origemMtime <= destinoMtime) {
  console.log('[recursos] traineddata ja esta atualizado.');
} else {
  copyFileSync(ORIGEM, DESTINO);
  const kb = (statSync(DESTINO).size / 1024).toFixed(0);
  console.log(`[recursos] traineddata copiado (${kb} KB).`);
}

const galeria = join(raiz, 'apps', 'main', 'resources', '_galeria', 'manifesto.json');
if (!existsSync(galeria)) {
  console.error('[recursos] AVISO: _galeria/manifesto.json ausente.');
  console.error('[recursos] O app vai cair no dHash e errar ~38% dos itens sem avisar.');
  console.error('[recursos] Gere com: python tools/exportar-galeria.py');
}