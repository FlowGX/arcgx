/**
 * ## ## ## O que este script existe para impedir
 *
 * Um build pode passar em `npm run build`, no typecheck e no electron-builder,
 * gerar um instalador de 108 MB e ainda assim estar **inutilizável** — porque
 * faltou uma dependência de runtime dentro do asar.
 *
 * Foi exatamente o que aconteceu com o primeiro 0.1.0: `npm run build` verde,
 * instalador gerado, e o app abria com
 * `ERR_MODULE_NOT_FOUND: Cannot find package '@arcgx/shared'`.
 *
 * A causa: o electron-builder embute o `node_modules` **somente a partir das
 * `dependencies` do package.json raiz**. Os apps `apps/main` e `apps/workers`
 * declaram as suas, mas o empacotador não lê package.json de workspace.
 *
 * ## ## ## Por que rodar isso no CI/build e não no primeiro relato
 *
 * O custo de descobrir é um ciclo inteiro de instalar, abrir, ver a caixa de
 * erro, corrigir, republicar. O custo de verificar é abrir um asar. Não tem
 * negociação.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const asar = require_('@electron/asar');

const raiz = process.cwd();
const asarPath = process.argv[2] ?? join(raiz, 'release', 'win-unpacked', 'resources', 'app.asar');

if (!existsSync(asarPath)) {
  console.error(`[pacote] asar nao encontrado: ${asarPath}`);
  console.error('[pacote] rode `npm run dist` antes.');
  process.exit(1);
}

/**
 * ## ## ## O que precisa estar dentro do pacote, e por que
 *
 * `mod` e o especificador que o Node vai resolver em tempo de execução.
 * `porQue` e o sintoma quando falta — porque "faltou um pacote" sozinho não
 * ajuda ninguém a decidir o que fazer.
 */
const ESPERADOS = [
  { mod: '@arcgx/shared', porQue: 'todo o main importa dele (tipos, config, logger, i18n)' },
  { mod: 'onnxruntime-node', porQue: 'sem ele o classificador de item nao roda' },
  { mod: 'tesseract.js', porQue: 'sem ele nao ha leitura de contador nem de total' },
  { mod: 'electron-updater', porQue: 'sem ele nao ha autoupdate' },
  { mod: '@arcgx/wgc-capture', porQue: 'sem ele nao ha captura de tela do jogo' },
  { mod: '@arcgx/cell-vision', porQue: 'sem ele nao ha grade de celulas' },
];

/** Recursos que precisam existir, e nao apenas estar resolviveis. */
const ARQUIVOS = [
  { caminho: 'package.json', porQue: 'electron le daqui' },
  { caminho: join('apps', 'main', 'dist', 'index.js'), porQue: 'ponto de entrada' },
  { caminho: join('apps', 'main', 'preload.cjs'), porQue: 'ponte do renderer' },
  {
    caminho: join('apps', 'main', 'resources', '_galeria', 'manifesto.json'),
    porQue: 'sem a galeria o classificador erra ~38% dos itens SEM AVISAR',
  },
  {
    caminho: join('apps', 'main', 'resources', '_galeria', 'encoder.onnx'),
    porQue: 'o modelo em si',
  },
  {
    caminho: join('apps', 'main', 'resources', 'ocr', 'eng.traineddata.gz'),
    porQue: 'sem ele o Tesseract tenta baixar em tempo de execucao',
  },
];

const entradas = asar.listPackage(asarPath).map((p) => p.replace(/^[\\/]/, '').split(sep).join('/'));
const tem = (p) => {
  // `join()` devolve `\` no Windows, e a lista do asar foi normalizada para `/`.
  // Sem esta normalizacao o verificador acusa "FALTA" em arquivo que existe,
  // e o primeiro sinal de erro passa a ser ele proprio.
  const alvo = p.split(sep).join('/');
  return entradas.includes(alvo) || entradas.some((e) => e.startsWith(`${alvo}/`));
};

const problemas = [];

console.log(`[pacote] ${entradas.length} entradas em ${relative(raiz, asarPath)}\n`);

console.log('modulos de runtime:');
for (const { mod, porQue } of ESPERADOS) {
  const ok = tem(`node_modules/${mod}`);
  console.log(`  ${ok ? 'ok  ' : 'FALTA'} ${mod}`);
  if (!ok) problemas.push(`modulo ausente: ${mod} — ${porQue}`);
}

console.log('\nrecursos:');
for (const { caminho, porQue } of ARQUIVOS) {
  const ok = tem(caminho);
  console.log(`  ${ok ? 'ok  ' : 'FALTA'} ${caminho}`);
  if (!ok) problemas.push(`recurso ausente: ${caminho} — ${porQue}`);
}

// O `.node` e o `.wasm` precisam estar **fora** do asar: sao abertos por
// caminho de arquivo, e o Electron nao os enxerga dentro do arquivo virtual.
// ## ## ## O caminho certo
//
// O nome real e `app.asar.unpacked`: o asar **ganha** o sufixo. A primeira
// versao usava `.replace(/\.asar$/, '.unpacked')`, que trocava `.asar` por
// `.unpacked` e produzia `app.unpacked` — um caminho que nunca existe, e o
// verificador acusava "nenhum addon descompactado" num pacote que tinha todos.
const unpacked = `${asarPath}.unpacked`;
console.log('\nfora do asar (asarUnpack):');
if (!existsSync(unpacked)) {
  problemas.push('app.asar.unpacked nao existe — nenhum addon nativo foi descompactado');
  console.log('  FALTA app.asar.unpacked');
} else {
  const precisa = ['.node', '.wasm'];
  for (const ext of precisa) {
    const achados = [];
    const anda = (dir) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) anda(p);
        else if (e.endsWith(ext)) achados.push(p);
      }
    };
    anda(unpacked);
    const ok = achados.length > 0;
    console.log(`  ${ok ? 'ok  ' : 'FALTA'} ${achados.length} arquivo(s) .${ext}`);
    if (!ok) problemas.push(`nenhum .${ext} descompactado — addon ou wasm nao vai carregar`);
  }
}

if (problemas.length) {
  console.error(`\n${problemas.length} problema(s) no pacote:\n`);
  for (const p of problemas) console.error(`  - ${p}`);
  console.error('\nO instalador sairia, mas o app nao abre (ou abre sem funcao).');
  console.error('Nao publique assim.');
  process.exit(1);
}

console.log('\n[pacote] tudo presente.');