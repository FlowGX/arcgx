/**
 * Sonda nomes de endpoint de mapa no MetaForge.
 *
 * A página HTML responde 403 (proteção de bot), então não dá para ler dela
 * quais rotas a tela usa. A API, porém, aceita o mesmo `fetch` simples que o
 * ingest já usa — e 404 sai rápido. A lista abaixo é o que a tela de mapa
 * poderia chamar; o que responder 200 com JSON é o que existe.
 */

import { fetchJson } from './lib/normalize.mjs';

const BASE = 'https://metaforge.app/api/arc-raiders';

const CANDIDATOS = [
  'maps', 'map', 'map-data', 'mapdata', 'game-map', 'game-map-data', 'gamemapdata',
  'map-markers', 'markers', 'map-pins', 'pins', 'map-nodes', 'map-poi', 'poi',
  'map-locations', 'locations', 'map-extractions', 'extractions', 'extraction-points',
  'map-landmarks', 'landmarks', 'map-loot', 'loot', 'containers', 'map-regions',
  'regions', 'areas', 'zones', 'spawns', 'map-spawns', 'stations', 'map-stations',
  'game-markers', 'item-icons', 'mapicons', 'map-icons', 'icons',
];

const achados = [];
for (const nome of CANDIDATOS) {
  const url = `${BASE}/${nome}`;
  try {
    const res = await fetchJson(url, { retries: 0 });
    if (res === null) continue; // 404
    const tipo = Array.isArray(res) ? `array(${res.length})` : typeof res;
    const amostra = JSON.stringify(res).slice(0, 220);
    achados.push({ nome, tipo, amostra });
    console.log(`200  /${nome}  ${tipo}`);
    console.log(`     ${amostra}\n`);
  } catch (err) {
    console.log(`--  /${nome}  ${String(err.message).slice(0, 60)}`);
  }
}

console.log(`\n=== ${achados.length} endpoint(s) existem ===`);
