#!/usr/bin/env node
/**
 * Arc GX — construtor da galeria de icones.
 *
 * Baixa os icones de referencia, decodifica e grava uma assinatura de
 * "tiny image" (grade 12x12 RGB) por item. E o classificador da Fase 4a:
 * template matching, sem treino e sem modelo neural.
 *
 *   node tools/gallery-build.mjs --out dados/models/gallery.json
 *   node tools/gallery-build.mjs --out ... --limit 20     # so pra testar
 *
 * Fontes de icone, em ordem de preferencia:
 *   images/items_ingame/  como o icone aparece no jogo (melhor referencia)
 *   images/items/         icone "limpo", sem o frame do inventario
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { decodePng, signature } from './lib/png.mjs';
import {
  GALLERY_DIMS,
  GALLERY_GRID,
  cosine,
  decodeSignature,
  encodeSignature,
} from '../packages/shared/dist/gallery.js';

const RAW = 'https://raw.githubusercontent.com/RaidTheory/arcraiders-data/main/';
const GRID = GALLERY_GRID;
const DIMS = GALLERY_DIMS;

/* ------------------------------------------------------------------ args */

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const OUT = opt('--out', 'dados/models/gallery.json');
const LIMIT = Number(opt('--limit', 0)) || 0;
const CONCURRENCY = Number(opt('--concurrency', 12)) || 12;

const log = (m) => console.log('  ' + m);

/* --------------------------------------------------------------- items */

const itemsRes = await fetch('https://raw.githubusercontent.com/RaidTheory/arcraiders-data/main/quests/a_bad_feeling.json');
if (!itemsRes.ok) {
  console.error('\n  falha ao falar com a fonte de dados\n');
  process.exit(1);
}

// a lista de ids vem do proprio ingest (game/items.json), se existir
let itemIds = [];
try {
  const { readFile } = await import('node:fs/promises');
  const local = path.resolve(path.join(path.dirname(OUT), '..', 'game', 'items.json'));
  const raw = JSON.parse(await readFile(local, 'utf8'));
  itemIds = Object.keys(raw.items ?? {});
  log(`lista local: ${itemIds.length} itens`);
} catch {
  log('game/items.json ausente; usando ardb.app');
  const res = await fetch('https://ardb.app/api/items');
  const list = await res.json();
  itemIds = list.map((i) => i.id);
  log(`lista remota: ${itemIds.length} itens`);
}

if (LIMIT) itemIds = itemIds.slice(0, LIMIT);
if (itemIds.length === 0) {
  console.error('  nenhum item encontrado\n');
  process.exit(1);
}

/* -------------------------------------------------------------- download */

async function fetchIcon(id) {
  for (const dir of ['images/items_ingame/', 'images/items/']) {
    const res = await fetch(`${RAW}${dir}${id}.png`);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      return { img: decodePng(buf), from: dir };
    } catch {
      /* tenta o proximo */
    }
  }
  return null;
}

let done = 0;
let failed = 0;
let fromIngame = 0;
const signatures = {};

async function worker() {
  while (true) {
    const id = itemIds[done];
    if (!id) return;
    const i = done++;

    try {
      const hit = await fetchIcon(id);
      if (!hit) {
        failed++;
        continue;
      }
      if (hit.from.includes('ingame')) fromIngame++;

      const { grid } = signature(hit.img, GRID);
      signatures[id] = encodeSignature(grid);
    } catch (err) {
      failed++;
    }

    if (i % 50 === 0) process.stdout.write(`\r  ${i}/${itemIds.length}`);
  }
}

console.log('\n== construindo galeria ==\n');
log(`${itemIds.length} itens, grade ${GRID}x${GRID}x3, ${CONCURRENCY} paralelas`);

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

/* ---------------------------------------------------------------- escrita */

const payload = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  grid: GRID,
  dims: DIMS,
  count: Object.keys(signatures).length,
  items: signatures,
};

await mkdir(path.dirname(path.resolve(OUT)), { recursive: true });
const json = JSON.stringify(payload);
await writeFile(path.resolve(OUT), json, 'utf8');

console.log('\r' + ' '.repeat(30));
log(`icones: ${payload.count} | sem icone: ${failed} | de items_ingame: ${fromIngame}`);
log(`tamanho: ${(json.length / 1e6).toFixed(2)} MB -> ${OUT}`);

/* --------------------------------------------------------- autoavaliacao */

const keys = Object.keys(signatures);
function decode(k) {
  return decodeSignature(signatures[k]);
}

// sanidade do round-trip: a assinatura tem de voltar com norma 1
const probe = decode(keys[0]);
let pn = 0;
for (const v of probe) pn += v * v;
log(`round-trip: norma ${Math.sqrt(pn).toFixed(4)} (esperado 1.0000)`);

/*
 * Metrica correta: a assinatura de um item, consultada contra a galeria
 * completa, tem que devolver ELE MESMO com nota alta.
 *
 * (A versao anterior media a melhor correspondencia com um item DIFERENTE e
 * chamava isso de "separacao" — o numero ficava baixo por definicao e o
 * alerta disparava sempre.)
 */
const scored = keys.map((k) => {
  const a = decode(k);
  let top = -1;
  let topId = null;
  let second = -1;
  for (const other of keys) {
    if (other === k) continue;
    const s = cosine(a, decode(other));
    if (s > top) {
      second = top;
      top = s;
      topId = other;
    } else if (s > second) {
      second = s;
    }
  }
  return { id: k, self: cosine(a, a), bestOther: top, bestOtherId: topId, second };
});

const minSelf = Math.min(...scored.map((s) => s.self));
const maxFalsePositive = Math.max(...scored.map((s) => s.bestOther));
const wrong = scored.filter((s) => s.bestOther > s.self);

log(`acerto proprio: pior ${minSelf.toFixed(4)}`);
log(`falso positivo: pior caso ${maxFalsePositive.toFixed(4)}`);
log(`itens cujo vizinho e mais parecido que ele proprio: ${wrong.length}`);

if (wrong.length) {
  const w = wrong[0];
  log(`  exemplo: ${w.id}.self=${w.self.toFixed(3)} vs ${w.bestOtherId}=${w.bestOther.toFixed(3)} — icone ambiguo`);
}

const margin = minSelf - maxFalsePositive;
log(margin > 0.15 ? `margem ${margin.toFixed(3)} — separacao saudavel` : `margem ${margin.toFixed(3)} — ATENCAO, sobreposicao`);

console.log('');