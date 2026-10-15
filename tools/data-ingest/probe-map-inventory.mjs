/**
 * Inventário do dataset de mapa do MetaForge.
 *
 * `?mapId=<slug>` responde com dezenas de milhares de pontos que trazem `lat`,
 * `lng`, `category` e `subcategory`. Antes de escrever o ingest, é preciso
 * saber quais `mapId` existem, quais categorias e subcategorias aparecem e em
 * que quantidade — para não assumir nomes e descobrir no meio da integração
 * que metade está vazia.
 */

import { fetchJson } from './lib/normalize.mjs';

const BASE = 'https://metaforge.app/api/arc-raiders/map-data';

const MAPAS = [
  'dam', 'buried-city', 'the-spaceport', 'blue-gate', 'riven-tides',
  'pendola-pass', 'stella-montis', 'stella-montis-lower', 'stella-montis-upper',
];

const tabela = [];

for (const mapId of MAPAS) {
  let arr = [];
  try {
    const res = await fetchJson(`${BASE}?mapId=${encodeURIComponent(mapId)}`, { retries: 1 });
    arr = Array.isArray(res) ? res : (res?.data ?? []);
  } catch (e) {
    console.log(`${mapId}: ERRO ${e.message}`);
    continue;
  }

  if (!arr.length) {
    console.log(`${mapId}: vazio`);
    continue;
  }

  const cats = new Map();
  const subs = new Map();
  for (const p of arr) {
    cats.set(p.category, (cats.get(p.category) ?? 0) + 1);
    const k = `${p.category}/${p.subcategory}`;
    subs.set(k, (subs.get(k) ?? 0) + 1);
  }

  const campos = [...new Set(arr.flatMap((p) => Object.keys(p)))];
  const lats = arr.map((p) => p.lat).filter(Number.isFinite);
  const lngs = arr.map((p) => p.lng).filter(Number.isFinite);

  console.log(`\n=== ${mapId}: ${arr.length} pontos ===`);
  console.log(`  campos : ${campos.join(', ')}`);
  console.log(
    `  lat    : ${Math.min(...lats).toFixed(0)} .. ${Math.max(...lats).toFixed(0)}` +
      `   lng: ${Math.min(...lngs).toFixed(0)} .. ${Math.max(...lngs).toFixed(0)}`,
  );
  console.log('  categorias:');
  for (const [k, n] of [...cats].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(k).padEnd(16)} ${n}`);
  }
  console.log('  subcategorias:');
  for (const [k, n] of [...subs].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(k).padEnd(34)} ${n}`);
  }
  tabela.push({ mapId, total: arr.length });
}

console.log('\n=== resumo ===');
tabela.forEach((t) => console.log(`  ${t.mapId.padEnd(22)} ${t.total}`));
