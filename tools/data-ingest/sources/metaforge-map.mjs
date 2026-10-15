/**
 * Marcadores de mapa do MetaForge — coordenadas que faltavam.
 *
 * ## De onde veio a descoberta
 *
 * O endpoint `/game-map-data` que a referência usa respondia 404, e a página
 * HTML do mapa responde 403 (proteção de bot), então não dava para ler dela as
 * rotas. Sondando nomes contra a API, `/map-data` respondeu 200 — mas com
 * `{"data":[]}`, o que parece "não existe". Não era: responde vazio porque não
 * sabe de qual mapa se trata. Com `?mapId=dam`, vieram **7984 pontos** com
 * `lat`, `lng`, `category` e `subcategory`.
 *
 * Isso muda o que a aba Mapas pode ser. Antes, as camadas eram filtros sobre
 * zero pontos, e nenhuma fonte aberta publicava posição. Agora há 38 mil
 * marcadores de contêiner, natureza, ARC, extrações, locais e pontos de quest,
 * com `zlayers` (elevação) e `behind_locked_door`.
 *
 * ## Atribuição
 *
 * Mesma fonte dos itens: os termos do MetaForge pedem atribuição e link de
 * volta, então esta fonte herda o bloco de `metaforge.mjs`.
 */

import { fetchJson, log, sleep } from '../lib/normalize.mjs';

import { attribution as metaAttribution } from './metaforge.mjs';

const BASE = 'https://metaforge.app/api/arc-raiders/map-data';

export const id = 'metaforge-mapa';
export const name = 'MetaForge — marcadores de mapa';
export const homepage = 'https://metaforge.app/arc-raiders/map';
export const license = 'API pública com termos de uso';

export const attribution = {
  ...metaAttribution,
  id,
  name,
  homepage,
  notice:
    'Map markers and coordinates from the public MetaForge ARC Raiders API, contributed by the community.',
};

/**
 * `mapId` aceito pela API. Saiu de sondar os slugs um a um: `the-spaceport`
 * devolve vazio e `stella-montis-lower` também — os dois andares de Stella
 * Montis chegam pelo mesmo `stella-montis`.
 */
export const MAPAS = [
  'dam',
  'buried-city',
  'the-spaceport',
  'blue-gate',
  'riven-tides',
  'pendola-pass',
  'stella-montis',
];

/** `mapId` da API -> id do nosso catálogo (`maps.json` usa snake_case). */
const PARA_ID = {
  dam: 'dam_battlegrounds',
  'buried-city': 'buried_city',
  'the-spaceport': 'the_spaceport',
  'blue-gate': 'the_blue_gate',
  'riven-tides': 'riven_tides',
  'pendola-pass': 'pendola_pass',
  'stella-montis': 'stella_montis_upper',
};

function slug(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Categorias da API -> grupos que a UI sabe filtrar.
 *
 * A API traz seis categorias (`containers`, `nature`, `arc`, `events`,
 * `locations`, `quests`) e dezenas de subcategorias. A UI precisa de grupos
 * estáveis, e o nome da categoria é o contrato.
 */
function grupo(categoria) {
  switch (categoria) {
    case 'containers':
      return 'containers';
    case 'arc':
      return 'arc';
    case 'nature':
      return 'nature';
    case 'events':
      return 'events';
    case 'quests':
      return 'quests';
    case 'locations':
      // as localizações misturam ponto de interesse e ponto de interesse de
      // spawn/extração; o subcategory separa melhor que o category
      return 'locations';
    default:
      return 'other';
  }
}

/**
 * ## Por que a saída é colunar
 *
 * Como objeto comum, o arquivo tinha **10,8 MB** — 35 mil objetos com seis
 * chaves cada, repetindo `containers`, `base_container` e o caminho do ícone
 * milhares de vezes. O renderer teria de parsear tudo isso para desenhar
 * camadas que ele nem vai mostrar.
 *
 * Em colunar, as strings viram índices numa tabela única e cada ponto vira uma
 * linha de números. `lat`/`lng` são arredondados para inteiro: a coordenada é
 * em unidades de mundo do jogo, e a resolução de tela não chega a distinguir
 * uma fração de pixel. O mesmo dado cabe em uma fração do tamanho, e a
 * descompactação é um laço simples.
 */

const GRUPOS = ['containers', 'nature', 'arc', 'events', 'locations', 'quests', 'other'];

/** flags em bit: 1 = atrás de porta trancada, 2 = tem área de loot */
const F_TRANCADO = 1;
const F_LOOT = 2;

function compacto(linhas) {
  const subs = [];
  const idxSub = new Map();
  const idx = (s) => {
    const k = s ?? '';
    if (!idxSub.has(k)) {
      idxSub.set(k, subs.length);
      subs.push(k);
    }
    return idxSub.get(k);
  };

  const rows = linhas.map((p) => [
    Math.round(p.lat),
    Math.round(p.lng),
    GRUPOS.indexOf(p.group),
    idx(p.subcategory),
    (p.behindLockedDoor ? F_TRANCADO : 0) | (p.hasLoot ? F_LOOT : 0),
  ]);

  return {
    total: rows.length,
    cols: ['lat', 'lng', 'group', 'sub', 'flags'],
    groups: GRUPOS,
    subs,
    rows,
  };
}

export async function mapMarkers() {
  const out = {};

  for (const mapId of MAPAS) {
    let rows = [];
    try {
      const res = await fetchJson(`${BASE}?mapId=${encodeURIComponent(mapId)}`, { retries: 2 });
      rows = Array.isArray(res) ? res : (res?.data ?? []);
    } catch (err) {
      log(id, `${mapId}: falhou (${String(err.message).slice(0, 60)})`);
      continue;
    }

    const nossoId = PARA_ID[mapId] ?? mapId;
    const pontos = rows
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
      .map((r) => ({
        // `lat` da API é o eixo vertical do jogo; o nome é do do banco, não da
        // tela. Mantido como veio para casar com o CRS.Simple do Leaflet.
        lat: r.lat,
        lng: r.lng,
        group: grupo(String(r.category ?? '')),
        subcategory: r.subcategory ?? null,
        behindLockedDoor: Boolean(r.behind_locked_door),
        hasLoot: Boolean(r.loot_areas),
      }));

    out[nossoId] = { mapId, ...compacto(pontos) };
    log(id, `${nossoId}: ${pontos.length} marcadores`);
    await sleep(250);
  }

  const total = Object.values(out).reduce((n, m) => n + (m.total ?? 0), 0);
  log(id, `${total} marcadores no total`);
  return out;
}
