#!/usr/bin/env node
/**
 * Arc GX — publisher do data-release.
 *
 * Lê um diretório-fonte com `game/*.json`, `models/*` e `ocr/*`, gera o
 * manifesto endereçado por conteudo e monta a arvore de release local.
 * Depois e so subir `<out>` para o CDN (qualquer CDN estatico serve).
 *
 *   node tools/data-publisher/publish.mjs --src <dir> --out <dir> [opcoes]
 *
 * Opcoes:
 *   --src <dir>        fonte com game/, models/, ocr/   (obrigatorio)
 *   --out <dir>        destino do release                (obrigatorio)
 *   --ocr              inclui o grupo opcional "paddle-ocr"
 *   --clean            remove releases antigos antes de publicar
 *   --dry-run          so mostra o que seria publicado
 *
 * O manifestId e um hash deterministico da lista de arquivos: publicar o mesmo
 * conteudo duas vezes gera o mesmo id e nao baixa nada de novo no cliente.
 */

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import {
  copyFile,
  link,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const out = { src: null, out: null, ocr: false, clean: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') out.src = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--ocr') out.ocr = true;
    else if (a === '--clean') out.clean = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else fail(`argumento desconhecido: ${a}`);
  }
  return out;
}

function fail(msg) {
  console.error(`\n  erro: ${msg}\n`);
  process.exit(1);
}

const fmt = (n) => `${(n / 1e6).toFixed(2)} MB`;
const args = parseArgs(process.argv);

if (args.help || !args.src || !args.out) {
  console.log(`
uso: node tools/data-publisher/publish.mjs --src <dir> --out <dir> [--ocr] [--clean] [--dry-run]

  --src     diretorio-fonte com game/, models/ e opcionalmente ocr/
  --out     destino onde sera montado o release
  --ocr     publica tambem o grupo opcional "paddle-ocr"
  --clean   apaga releases anteriores antes de publicar
  --dry-run mostra o plano sem escrever nada
`);
  process.exit(args.help ? 0 : 1);
}

/* ------------------------------------------------------------- coleta */

async function collect(dir, prefix = '') {
  if (!exists(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) files.push(...(await collect(full, rel)));
    else if (e.isFile()) files.push({ abs: full, rel });
  }
  return files;
}

function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

/* ------------------------------------------------------------- main */

// O prefixo do grupo faz parte do caminho publicado: o cliente busca
// "game/items.json" e "models/x.onnx". Sem isso os nomes ficam soltos na raiz.
const game = (await collect(path.join(args.src, 'game'), 'game')).map((f) => ({ ...f, group: null }));
const models = (await collect(path.join(args.src, 'models'), 'models')).map((f) => ({ ...f, group: null }));
const ocr = (await collect(path.join(args.src, 'ocr'), 'models')).map((f) => ({ ...f, group: 'paddle-ocr' }));

// Os créditos viajam junto dos dados: o app baixa os dados de terceiros, então
// a atribuição tem de estar no mesmo release — sem ela o uso não é licenciado.
const attribution = path.join(args.src, 'ATTRIBUTION.json');
const credits = exists(attribution)
  ? [{ abs: attribution, rel: 'ATTRIBUTION.json', group: null }]
  : [];

const sources = [...game, ...models, ...ocr, ...credits].filter((f) =>
  /\.(json|onnx|f32|bin|txt)$/i.test(f.rel),
);

if (sources.length === 0) fail(`nenhum arquivo em ${args.src}/game, ${args.src}/models ou ${args.src}/ocr`);

if (!exists(attribution)) {
  console.warn('\n  AVISO: ATTRIBUTION.json ausente — dados de terceiros sem crédito.');
  console.warn('          Rode antes:  node tools/data-ingest/ingest.mjs --out <fonte>\n');
}

// manifestId deterministico: hash da lista (caminho + sha256) dos arquivos obrigatorios
const entries = [];
for (const f of sources) {
  const hash = await sha256(f.abs);
  const { size } = await stat(f.abs);
  entries.push({ rel: f.rel, group: f.group, abs: f.abs, sha256: hash, bytes: size });
}

const required = entries.filter((e) => e.group === null);
const manifestId = createHash('sha256')
  .update(required.map((e) => `${e.rel}:${e.sha256}`).sort().join('\n'))
  .digest('hex')
  .slice(0, 16);

/* ---------------------------------------------------------------- plano */

const files = {};
const optional = {};

for (const e of required) {
  files[e.rel] = { sha256: e.sha256, bytes: e.bytes, key: `data/${e.sha256}${path.extname(e.rel)}` };
}
for (const e of entries.filter((x) => x.group !== null)) {
  optional[e.group] ??= {};
  optional[e.group][e.rel] = { sha256: e.sha256, bytes: e.bytes, key: `data/${e.sha256}${path.extname(e.rel)}` };
}

const manifest = {
  schema: 1,
  manifestId,
  publishedAt: new Date().toISOString(),
  files,
  ...(Object.keys(optional).length ? { optional } : {}),
};

const totalBytes = required.reduce((n, e) => n + e.bytes, 0);
console.log(`\n  manifest ${manifestId}`);
console.log(`  ${required.length} arquivos obrigatorios (${fmt(totalBytes)})`);
for (const e of required.sort((a, b) => b.bytes - a.bytes).slice(0, 12)) {
  console.log(`    ${fmt(e.bytes).padStart(10)}  ${e.rel}`);
}
if (required.length > 12) console.log(`    ... +${required.length - 12}`);
for (const [g, list] of Object.entries(optional)) {
  const bytes = Object.values(list).reduce((n, x) => n + x.bytes, 0);
  console.log(`  [opcional] ${g}: ${Object.keys(list).length} arquivos (${fmt(bytes)})`);
}

if (args.dryRun) {
  console.log(`\n  --dry-run: nada foi escrito.\n`);
  process.exit(0);
}

/* --------------------------------------------------------------- escrita */

// Layout espelhado no CDN: <out>/data/<sha256><ext>  <- é o que o cliente busca
// via manifest.files[].key. `releases/<id>/` é só o espelho legível.
const dataDir = path.join(args.out, 'data');
const releaseDir = path.join(args.out, 'releases', manifestId);
await mkdir(dataDir, { recursive: true });
await mkdir(releaseDir, { recursive: true });

let linked = 0;
let copied = 0;

for (const e of entries) {
  const ext = path.extname(e.rel);
  const dest = path.join(dataDir, e.sha256 + ext);
  if (!exists(dest)) await copyFile(e.abs, dest);

  const target = path.join(releaseDir, e.rel);
  await mkdir(path.dirname(target), { recursive: true });
  if (exists(target)) continue;
  try {
    await link(dest, target);
    linked++;
  } catch {
    await copyFile(dest, target);
    copied++;
  }
}

await writeFile(path.join(releaseDir, '.complete'), manifestId, 'utf8');
await writeFile(path.join(args.out, 'current.json'), JSON.stringify(manifest, null, 2), 'utf8');

if (args.clean) {
  const releasesDir = path.join(args.out, 'releases');
  for (const dir of await readdir(releasesDir)) {
    if (dir === manifestId) continue;
    await rm(path.join(releasesDir, dir), { recursive: true, force: true });
    console.log(`  removido release antigo ${dir}`);
  }
}

console.log(`\n  ok: ${linked} hardlinks, ${copied} copias`);
console.log(`  ${releaseDir}`);
console.log(`  ${path.join(args.out, 'current.json')}`);
console.log(`\n  proximo passo: subir <out> para o CDN e apontar ARC_DATA_RELEASE_URL.\n`);