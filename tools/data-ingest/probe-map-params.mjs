/**
 * `/map-data` responde 200 com `{"data":[]}` sem parâmetro — o endpoint
 * existe, só não sabe de qual mapa o MasksData pergunta. Este script varre
 * combinações de parâmetro até uma delas devolver ponto com coordenada.
 */

import { fetchJson } from './lib/normalize.mjs';

const BASE = 'https://metaforge.app/api/arc-raiders/map-data';

const CHAVES = ['mapId', 'map', 'mapSlug', 'slug', 'tableID', 'tableId', 'gameMap', 'game_map', 'id'];
const VALORES = ['dam', 'dam-battleground', 'dam_battlegrounds', 'buried-city', 'the-spaceport', 'Dam'];

const temCoord = (s) => /"(lat|lng|lon|longitude|latitude|x|y)"\s*:\s*-?\d/i.test(s);

for (const chave of CHAVES) {
  const linhas = [];
  for (const v of VALORES) {
    const url = `${BASE}?${chave}=${encodeURIComponent(v)}`;
    try {
      const res = await fetchJson(url, { retries: 0 });
      const arr = Array.isArray(res) ? res : (res?.data ?? []);
      if (arr.length) {
        const s = JSON.stringify(arr).slice(0, 200);
        linhas.push(`   ${v.padEnd(16)} -> ${arr.length} linha(s)  ${s}`);
      }
    } catch {
      /* ignora */
    }
  }
  if (linhas.length) {
    console.log(`?${chave}= respondeu:`);
    linhas.forEach((l) => console.log(l));
    console.log();
  }
}

// o endpoint nu, para ver o formato que ele espera
try {
  const res = await fetchJson(BASE, { retries: 0 });
  console.log('sem parâmetro ->', JSON.stringify(res).slice(0, 300));
  console.log('chaves do topo ->', Object.keys(res ?? {}).join(', '));
} catch (e) {
  console.log('erro:', e.message);
}
