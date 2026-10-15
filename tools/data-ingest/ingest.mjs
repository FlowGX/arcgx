#!/usr/bin/env node
/**
 * Arc GX � ingestão de dados do jogo.
 *
 * Junta as fontes configuradas, normaliza para o schema do Arc GX e escreve a
 * árvore de fonte que o `publish.mjs` consome.
 *
 *   node tools/data-ingest/ingest.mjs --out dados
 *   node tools/data-ingest/ingest.mjs --out dados --sources raidtheory,ardb,metaforge
 *   node tools/data-ingest/ingest.mjs --out dados --no-details   # mais rápido
 *
 * Saída:
 *   <out>/game/*.json      dados normalizados
 *   <out>/ATTRIBUTION.json  créditos obrigatórios (renderizar no app)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { fill, GENERATED_AT, log, mergeById, pool, titleCase } from './lib/normalize.mjs';
import * as raidtheory from './sources/raidtheory.mjs';
import * as ardb from './sources/ardb.mjs';
import * as metaforge from './sources/metaforge.mjs';
import * as metaforgeMap from './sources/metaforge-map.mjs';
import * as arctracker from './sources/arctracker.mjs';

const SOURCES = { raidtheory, ardb, metaforge, metaforgeMap, arctracker };

/**
 * O id do arctracker e underscore; o nosso e hifen.
 *
 * `acoustic-guitar` (nosso) e `acoustic_guitar` (deles) sao o mesmo item. Sem
 * canonizar, o casamento dava 58 de 1.113 e parecia que as fontes nao tinham
 * nada em comum. Canonizando, casam 769.
 */
function canonico(s) {
  return String(s ?? '').replace(/-/g, '_').toLowerCase();
}

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const out = { out: null, sources: 'raidtheory,ardb,metaforge,arctracker', details: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--sources') out.sources = argv[++i];
    else if (a === '--no-details') out.details = false;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help || !args.out) {
  console.log(`
uso: node tools/data-ingest/ingest.mjs --out <dir> [--sources raidtheory,ardb,metaforge] [--no-details]

  --out        diretorio de destino (ex.: dados)
  --sources    quais fontes usar, separadas por virgula
  --no-details pula o fetch de detalhe por item (5-10x mais rapido)
`);
  process.exit(args.help ? 0 : 1);
}

const enabled = args.sources.split(',').map((s) => s.trim()).filter(Boolean);
for (const s of enabled) {
  if (!SOURCES[s]) {
    console.error(`fonte desconhecida: ${s} (disponiveis: ${Object.keys(SOURCES).join(', ')})`);
    process.exit(1);
  }
}

const gameDir = path.join(args.out, 'game');
await mkdir(gameDir, { recursive: true });

const t0 = Date.now();
console.log(`\n  ingestao -> ${args.out}`);
console.log(`  fontes: ${enabled.join(', ')}\n`);

/* ----------------------------------------------------------------- itens */

let items = {};

for (const s of enabled) {
  const src = SOURCES[s];
  // Nem toda fonte tem todos os conjuntos.
  if (typeof src.items !== 'function') continue;
  const own = await src.items();
  items = mergeById(items, own);
}

// O ardb entra por último de propósito: preenche buraco, não sobrescreve.
const gaps = {};
for (const s of enabled) {
  if (SOURCES[s].id !== 'ardb') continue;
  const summaries = await SOURCES[s].itemSummaries();
  for (const [id, v] of Object.entries(summaries)) {
    if (items[id] && items[id]._source !== 'ardb') {
      // já temos esse item traduzido: só anotamos como conhecido
      continue;
    }
    gaps[id] = v;
  }
}
items = mergeById(items, gaps);

/* ------------------------------------------------- MetaForge: 2.0 e ícones */

/**
 * O MetaForge entra por último e faz duas coisas que mais ninguém faz:
 * traz o conteúdo do update 2.0 (Frozen Trail) e o `imageFilename` de tudo.
 *
 * O casamento é pela chave sem separador (`anvil_ii` �0� `anvil-ii`) e nunca
 * sobrescreve texto: só cria item novo ou preenche `imageFilename` vazio.
 */
if (enabled.includes('metaforge')) {
  const mf = await metaforge.items();

  // Nossas ids são snake_case, as do MetaForge kebab-case, e o MetaForge ainda
  // tem typo (`acoustic-guitar`). Comparar id erra; o **nome em inglês** é o
  // que as três fontes concordam, então é ele que indexa os dois lados.
  const byName = new Map();
  const byMatchKey = new Map();
  for (const it of Object.values(items)) {
    byMatchKey.set(metaforge.matchKey(it.id), it);
    const en = typeof it.name === 'object' && it.name ? it.name.en : it.name;
    if (typeof en === 'string' && en.trim()) {
      byName.set(`n:${en.toLowerCase().trim().replace(/\s+/g, ' ')}`, it);
    }
  }

  let novos = 0;
  let atualizadas = 0;

  for (const m of Object.values(mf)) {
    const en = typeof m.name === 'object' && m.name ? m.name.en : null;
    const existing =
      items[m.id] ??
      (typeof en === 'string' ? byName.get(`n:${en.toLowerCase().trim().replace(/\s+/g, ' ')}`) : null) ??
      byMatchKey.get(metaforge.matchKey(m.id));

    if (!existing) {
      // Frozen Trail e afins: item que nenhuma outra fonte conhece
      items[m.id] = m;
      novos++;
      continue;
    }

    // A arte do MetaForge é 512×512 contra 256×256 da arctracker, e a
    // comparação pixel a pixel deu diferença de 1-3/255 — é a mesma arte,
    // só maior. Então aqui a MetaForge não só preenche buraco: ela
    // **substitui**, e todo item passa a ter arte na maior resolução.
    if (m.imageFilename && m.imageFilename !== existing.imageFilename) {
      if (existing.imageFilename) atualizadas++;
      existing.imageFilename = m.imageFilename;
      existing.imageSource = metaforge.id;
    }
  }

  log('itens', `metaforge: +${novos} itens novos, ${atualizadas} artes atualizadas para 512px`);
}

/* ------------------------------------------------------- ids duplicadas */

/**
 * Chave de agrupamento de variante de tier.
 *
 * Precisa ser **insensível ao separador**: as fontes não concordam sobre
 * grafia. A mesma arma entra como `anvil_ii` (RaidTheory), `anvil-ii`
 * (MetaForge) e `anvil_t2` (ardb). Comparar cru produz três linhas do mesmo
 * item — foi o que deixou a base com 1644 itens em vez de ~1190.
 *
 * A chave reduz a base a só alfanumérico e o tier a número, então as três
 * formas caem no mesmo grupo e sobra uma linha só.
 */
function tierKey(id) {
  const s = String(id ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_/-]/g, '');
  let m = /^(.*?)[_-](?:t)?(iii|ii|iv|i|[1-4])(?:_|-)?(blueprint)?$/.exec(s);
  if (m) {
    const n = { i: 1, ii: 2, iii: 3, iv: 4 }[m[2]] ?? Number(m[2]);
    return `${m[1].replace(/[^a-z0-9]/g, '')}|${n}${m[3] ? '|bp' : ''}`;
  }
  return `${s.replace(/[^a-z0-9]/g, '')}|`;
}

/**
 * Chave de identidade do item entre fontes.
 *
 * Id NÃO serve: as três fontes discordam sobre separador (`acoustic_guitar`,
 * `acoustic-guitar`) e o MetaForge ainda tem typo (`guitar` por `guitar`).
 * Parser qualquer de id só acerta por acaso — foi o que deixou 524 linhas
 * duplicadas depois de todo o resto.
 *
 * O que as fontes concordam é o **nome em inglês**. Ele é estável, é o mesmo
 * nos três dumps e separa tier ("Anvil I" de "Anvil II"). Quando não há nome,
 * cai na chave de id para não descartar item nenhum.
 */
function dedupKey(it) {
  const en = typeof it.name === 'object' && it.name ? it.name.en : null;
  const nome = typeof en === 'string' ? en.toLowerCase().trim() : '';
  if (nome) return `n:${nome.replace(/\s+/g, ' ')}`;
  const soTexto = typeof it.name === 'string' ? it.name.toLowerCase().trim() : '';
  if (soTexto) return `n:${soTexto.replace(/\s+/g, ' ')}`;
  return `i:${tierKey(it.id)}`;
}

{
  const byTier = new Map();
  for (const it of Object.values(items)) {
    const k = dedupKey(it);
    if (!byTier.has(k)) byTier.set(k, []);
    byTier.get(k).push(it);
  }

  const fundidosDe = [];
  for (const grupo of byTier.values()) if (grupo.length > 1) fundidosDe.push(grupo);

  let fundidos = 0;
  let herdaramArte = 0;

  // Ordena o grupo: vence a arte mais nova, depois a linha mais curta.
  //
  // A arte importa mais que o id. As duas fontes têm a MESMA arte, mas a do
  // MetaForge é 512×512 e a da arctracker 256×256; desempatar pelo id mais
  // curto fazia a linha `snake_case` (id menor, arte velha) ganhar, e a arte
  // nova ia embora com o perdedor.
  const porPrioridade = (a, b) => {
    const ra = a.imageSource === metaforge.id ? 0 : a.imageFilename ? 1 : 2;
    const rb = b.imageSource === metaforge.id ? 0 : b.imageFilename ? 1 : 2;
    if (ra !== rb) return ra - rb;
    return a.id.length - b.id.length || a.id.localeCompare(b.id);
  };

  const fundir = (vencedora, perdedoras) => {
    for (const p of perdedoras) {
      if (!vencedora.imageFilename && p.imageFilename) {
        vencedora.imageFilename = p.imageFilename;
        if (p.imageSource) vencedora.imageSource = p.imageSource;
        herdaramArte++;
      }
      if (!vencedora.aliases) vencedora.aliases = [];
      vencedora.aliases.push(p.id);
      delete items[p.id];
      fundidos++;
    }
  };

  // 1) o mesmo item escrito pelas fontes de formas diferentes
  for (const grupo of fundidosDe) {
    grupo.sort(porPrioridade);
    const [vencedora, ...perdedoras] = grupo;
    fundir(vencedora, perdedoras);
  }

  // 2) nome sem tier (`bantam`) que é o tier 1 da família (`bantam-i`)
  const porFamilia = new Map();
  for (const it of Object.values(items)) {
    const base = dedupKey(it).slice(2).replace(/\|[0-9]+(\|bp)?$/, '');
    if (!porFamilia.has(base)) porFamilia.set(base, []);
    porFamilia.get(base).push(it);
  }

  for (const grupo of porFamilia.values()) {
    if (grupo.length < 2) continue;
    const semTier = grupo.filter((it) => /(\|bp)?$/.test(dedupKey(it)) && !/\|[1-4]/.test(dedupKey(it)));
    const comTier = grupo.filter((it) => /\|[1-4]/.test(dedupKey(it)));
    if (!semTier.length || !comTier.length) continue;

    comTier.sort(porPrioridade);
    const alvo = comTier.find((it) => dedupKey(it).endsWith('|1')) ?? comTier[0];
    fundir(alvo, semTier);
  }

  // 3) mesma coisa, casada pelo id normalizado
  //
  // O passe por nome não pega tudo: quando as fontes discordam do rótulo
  // ("Rusted Bolts" de um lado, "Rusted Bolt" do outro) as duas linhas ficam
  // separadas mesmo sendo o mesmo item — e o id normalizado (`rustedbolts` nos
  // dois formatos) é igual. Sem este passe, 88 itens exigidos por projetos
  // apareciam como desconhecidos por terem duplicata em outra grafia.
  const porIdNorm = new Map();
  for (const it of Object.values(items)) {
    const k = `i:${String(it.id).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    if (!porIdNorm.has(k)) porIdNorm.set(k, []);
    porIdNorm.get(k).push(it);
  }
  for (const grupo of porIdNorm.values()) {
    if (grupo.length < 2) continue;
    grupo.sort(porPrioridade);
    const [v, ...ps] = grupo;
    fundir(v, ps);
  }

  if (fundidos) {
    log('itens', `ids duplicadas: ${fundidos} fundidas, ${herdaramArte} herdaram arte`);
  }
}

let fromArdb = Object.values(items).filter((i) => i._source === 'ardb').length;
log('itens', `${Object.keys(items).length} no total`);

// Detalhe por item só para quem veio do ardb sem peso/stack.
const needDetail = Object.values(items)
  .filter((i) => i._source === 'ardb' && (i.weightKg === undefined || i.stackSize === undefined))
  .map((i) => i.id);

if (args.details && needDetail.length && enabled.includes('ardb')) {
  console.log(`  buscando detalhe de ${needDetail.length} itens...`);
  const details = await pool(needDetail, 8, (itemId) => ardb.itemDetail(itemId));
  let filled = 0;
  for (const d of details) {
    if (!d?.id || !items[d.id]) continue;
    const before = JSON.stringify(items[d.id]);
    fill(items[d.id], {
      weightKg: d.weight,
      stackSize: d.stackSize,
      foundIn: d.foundIn,
      breaksInto: d.breaksInto,
      recyclesInto: d.recyclesInto,
      salvagesInto: d.salvagesInto,
      mechanics: d.mechanics,
    });
    if (JSON.stringify(items[d.id]) !== before) filled++;
  }
  log('detalhe', `${filled} itens enriquecidos`);
} else if (needDetail.length) {
  log('detalhe', `${needDetail.length} itens sem detalhe (use sem --no-details)`);
}

// Normalização final. As fontes usam grafias diferentes ("Common", "common",
// "Legendary", "legendary"), então tudo é canonicalizado aqui � senão o
// filtro por tier no app deixa de casar.
const TIER_BY_RARITY = {
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  epic: 'epic',
  legendary: 'legendary',
  mythic: 'mythic',
};

const canonicalRarity = (raw) => {
  const key = String(raw ?? '').trim().toLowerCase();
  return key in TIER_BY_RARITY ? titleCase(key) : (raw ? String(raw).trim() : 'Common');
};

/**
 * Nomes em portugues e arte atualizada, do arctracker.
 *
 * Fica **antes** da normalizacao porque a normalizacao e que usa `catalogoPt`
 * para injetar a traducao. Os ids sao canonizados para casar, mas o id
 * gravado continua sendo o nosso (hifen), porque e o que o resto do app ja
 * referencia.
 */
const catalogoPt = enabled.includes('arctracker') ? await arctracker.items() : {};

const normalizedItems = {};
let traduzidos = 0;
for (const it of Object.values(items)) {
  const rarity = canonicalRarity(it.rarity);
  normalizedItems[it.id] = {
    id: it.id,
    name: it.name && Object.keys(it.name).length ? it.name : { en: it.id },
    description: it.description ?? {},
    type: titleCase(it.type || 'Misc'),
    rarity,
    tier: TIER_BY_RARITY[rarity.toLowerCase()] ?? 'common',
    value: Number(it.value ?? 0),
    weightKg: it.weightKg ?? undefined,
    stackSize: it.stackSize ?? undefined,
    foundIn: it.foundIn ?? [],
    breaksInto: it.breaksInto ?? undefined,
    recyclesInto: it.recyclesInto ?? undefined,
    salvagesInto: it.salvagesInto ?? undefined,
    imageFilename: it.imageFilename ?? undefined,
    updatedAt: it.updatedAt ?? undefined,
    _source: it._source,
  };

  // Nomes em portugues, vindos do arctracker.
  //
  // A MetaForge so entrega `name.en`. Sem isto, o catalogo inteiro aparece
  // em ingles no app — e rotular as capturas em ingles e lento e sujeito a
  // erro, porque "Bantam I" nao e o que o jogador ve na tela dele.
  //
  // A traducao **nao substitui** o english: entra como `pt`, e o english
  // continua. Quem procura por "Violao" acha; quem procura por "Acoustic
  // Guitar" tambem.
  const pt = arctracker.buscar(catalogoPt, it.id);
  if (pt?.namePt) {
    const nomes = { ...normalizedItems[it.id].name };
    nomes['pt-BR'] = pt.namePt;
    if (pt.nameEn && !nomes.en) nomes.en = pt.nameEn;
    normalizedItems[it.id].name = nomes;
    if (pt.descricao?.en && !normalizedItems[it.id].description?.['pt-BR']) {
      normalizedItems[it.id].description = {
        ...normalizedItems[it.id].description,
        'pt-BR': pt.descricao.en,
      };
    }
    traduzidos++;
  }
}

/* ---------------------------------------------------------------- outros */

let quests = {};
for (const s of enabled) {
  const src = SOURCES[s];
  if (typeof src.quests !== 'function') continue;
  const own = await src.quests();
  quests = mergeById(quests, own);
}

const rt = enabled.includes('raidtheory');
const skillNodes = rt ? await raidtheory.single('skillNodes.json') : null;
const projects = rt ? await raidtheory.single('projects.json') : null;
const maps = rt ? await raidtheory.single('maps.json') : null;
const trades = rt ? await raidtheory.single('trades.json') : null;
const bots = rt ? await raidtheory.single('bots.json') : null;
const hideout = rt ? await raidtheory.hideout() : null;
const enemies = enabled.includes('ardb') ? await ardb.arcEnemies() : {};

// Marcadores de mapa. Sem eles a aba Mapas filtra camadas sobre zero pontos:
// as caixas existem, os coordenadas nao. Sai do mesmo servidor que os itens,
// entao acompanha a mesma chave de fonte.
const mapMarkers = enabled.includes('metaforge') ? await metaforgeMap.mapMarkers() : {};

// Eventos: catalogo de tipos (RaidTheory) + agenda ao vivo (MetaForge).
// Sem os dois a aba de Eventos nao tem nem o que existe nem quando acontece.
let eventTypes = rt ? await raidtheory.single('map-events/map-events.json') : null;
let liveEvents = {};
if (enabled.includes('metaforge') && typeof metaforge.events === 'function') {
  liveEvents = await metaforge.events();
}

/* --------------------------------------------------------------- escrita */

const generatedAt = GENERATED_AT();

const files = {
  'items.json': { version: 1, generatedAt, itemCount: Object.keys(normalizedItems).length, items: normalizedItems },
  'quests.json': {
    version: 1,
    generatedAt,
    totalQuests: Object.keys(quests).length,
    quests: Object.fromEntries(Object.entries(quests).map(([k, q]) => [k, fill(q, { tier: undefined })])),
  },
  'skill-nodes.json': skillNodes ?? { version: 1, generatedAt, totalSkillNodes: 0, skillNodes: {} },
  'projects.json': projects ?? { version: 1, generatedAt, totalProjects: 0, projects: {} },
  'maps.json': maps,
  /**
   * Marcadores com coordenada.
   *
   * Fica em arquivo próprio e não dentro de `maps.json` por um motivo prático:
   * são ~35 mil pontos, quase todos minúsculos. Colar isso no `maps.json`
   * transformaria a lista de mapas em um arquivo de vários megabytes que a
   * tela de mapa carrega inteira só para desenhar sete nomes.
   */
  'map-markers.json': {
    version: 1,
    generatedAt,
    totalMaps: Object.keys(mapMarkers).length,
    totalMarkers: Object.values(mapMarkers).reduce((n, m) => n + (m?.total ?? 0), 0),
    maps: mapMarkers,
  },
  'trades.json': trades,
  'bots.json': bots,
  'hideout.json': hideout ?? { version: 1, generatedAt, hideoutModules: {}, totalModules: 0 },
  'arc-enemies.json': { version: 1, generatedAt, total: Object.keys(enemies).length, arcEnemies: enemies },
  'events.json': {
    version: 1,
    generatedAt,
    total: Object.keys(liveEvents).length,
    events: liveEvents,
    eventTypes: eventTypes?.eventTypes ?? {},
  },
};

for (const [name, data] of Object.entries(files)) {
  if (!data) continue;
  await writeFile(path.join(gameDir, name), JSON.stringify(data), 'utf8');
  const size = Buffer.byteLength(JSON.stringify(data));
  log('escrito', `${name.padEnd(22)} ${(size / 1e6).toFixed(2)} MB`);
}

// Créditos: obrigatório quando alguma fonte exigir atribuição.
const attributions = enabled.map((s) => SOURCES[s].attribution);
await writeFile(
  path.join(args.out, 'ATTRIBUTION.json'),
  JSON.stringify({ generatedAt, sources: attributions }, null, 2),
  'utf8',
);

/* --------------------------------------------------------------- resumo */

const bySource = {};
for (const it of Object.values(normalizedItems)) bySource[it._source] = (bySource[it._source] || 0) + 1;

console.log(`\n  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`  itens por fonte: ${JSON.stringify(bySource)}`);
console.log(`  ${fromArdb} itens vieram so do ardb (sem traducao)`);

const required = attributions.filter((a) => a.required);
if (required.length) {
  console.log('\n  ATRIBUICAO OBRIGATORIA � renderizar em:');
  for (const a of required) console.log(`    - ${a.notice}\n      ${a.link}`);
  console.log('    gravado em ATTRIBUTION.json');
}
console.log('');