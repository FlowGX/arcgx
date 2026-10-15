/**
 * ## ## ## O que este script existe para impedir
 *
 * `build/release/` tem 36,8 MB, mas só 2,7 MB são o app precisar: o resto é
 * **histórico** — cada republicação do `data-release` deixa um diretório
 * `releases/<manifestId>/` para trás, porque o endereço é conteúdo e o cliente
 * precisa poder conferir o que já tinha.
 *
 * ## ## ## O bug que motivou isto
 *
 * No app empacotado, `localReleaseBase()` procura `build/release` em dois
 * lugares, nenhum dos quais existe dentro do pacote. A base voltava vazia, o
 * `joinUrl` montava `./current.json` e o `fetch` devolvia
 * `Failed to parse URL from /current.json` — o "base de dados com erro" do
 * painel.
 *
 * O pior: **parecia funcionar**. Com o cache já populado em `%APPDATA%`, o
 * `DataRelease.load` usava os arquivos locais e nunca tocava a rede. O bug só
 * aparece na primeira execução de uma instalação nova — exatamente quando o
 * usuário ainda não sabe se aquilo presta.
 *
 * ## ## ## Por que empacotar em vez de só configurar uma URL
 *
 * A alternativa seria apontar `ARC_DATA_RELEASE_URL` para um CDN. Não há CDN
 * no ar (a R2 devolvia 403), e depender de rede para o app ter catálogo na
 * primeira execução significa que quem está offline abre um app quebrado.
 *
 * Empacotando, o app funciona sozinho na primeira abertura. O `Sincronizar
 * base` continua podendo atualizar depois, quando houver URL.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const raiz = process.cwd();
const ORIGEM = join(raiz, 'build', 'release');
const DESTINO = join(raiz, 'build', 'data-release');

function copiarDe(arquivo) {
  const destino = join(DESTINO, arquivo);
  mkdirSync(dirname(destino), { recursive: true });
  copyFileSync(join(ORIGEM, arquivo), destino);
}

const current = join(ORIGEM, 'current.json');
if (!existsSync(current)) {
  console.error('[dados] build/release/current.json ausente.');
  console.error('[dados] Gere antes com:  npm run data:publish -- --src dados --out build/release');
  process.exit(1);
}

const indice = JSON.parse(readFileSync(current, 'utf8'));
const id = indice.manifestId;
if (!id) {
  console.error('[dados] current.json sem manifestId.');
  process.exit(1);
}

// Só o release ativa. Copiar `releases/` inteiro levaria as 4 republished de
// volta para dentro do instalador.
const releaseAtivo = join(ORIGEM, 'releases', id);
if (!existsSync(releaseAtivo)) {
  console.error(`[dados] release ${id} não existe em build/release/releases.`);
  process.exit(1);
}

// O índice aponta cada arquivo para `data/<sha256>.json` — o conteúdo
// endereçado. Sem copiar esses, o app tem o manifesto e nenhum dado.
const chaves = new Set(Object.values(indice.files ?? {}).map((f) => f.key));

rmSync(DESTINO, { recursive: true, force: true });
mkdirSync(DESTINO, { recursive: true });

copiarDe('current.json');

const copia = (dir, base = '') => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) copia(join(dir, e.name), rel);
    // Passa por `copiarDe`, que cria o diretório de destino. Chamar
    // `copyFileSync` direto aqui falhava com ENOENT no primeiro subdiretório.
    else copiarDe(rel);
  }
};
copia(releaseAtivo, `releases/${id}`);

let faltando = 0;
for (const k of chaves) {
  const src = join(ORIGEM, k.replace(/\//g, '\\'));
  if (!existsSync(src)) {
    console.error(`  [dados] FALTA ${k}`);
    faltando++;
    continue;
  }
  copiarDe(k);
}

if (faltando) {
  console.error(`\n[dados] ${faltando} arquivo(s) de dados ausentes. Rode \`npm run data:publish\` de novo.`);
  process.exit(1);
}

const bytes = (d) => {
  let t = 0;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    t += e.isDirectory() ? bytes(p) : statSync(p).size;
  }
  return t;
};

const mb = bytes(DESTINO) / 1024 / 1024;
const origem = bytes(ORIGEM) / 1024 / 1024;
console.log(
  `[dados] ${id}\n` +
  `        ${chaves.size} arquivo(s) de dados + release ativo\n` +
  `        ${mb.toFixed(1)} MBlevado  (era ${origem.toFixed(1)} MB com histórico)`,
);