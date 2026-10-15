/**
 * Fonte 1 — `RaidTheory/arcraiders-data` (GitHub, MIT).
 *
 * É a única fonte com nomes de item traduzidos em 20 idiomas, que é o que
 * sustenta o painel multi-idioma do Arc GX.
 *
 * A licença MIT pede atribuição. Isso é gerado em `ATTRIBUTION.json` e
 * renderizado na tela de créditos — sem isso não é uso legítimo.
 *
 * Conteúdo de conteúdo (`name`, `description`, `value`) é © Embark Studios.
 */

import { fetchJson, log, pool, text, toTier } from '../lib/normalize.mjs';

const REPO = 'RaidTheory/arcraiders-data';
const BRANCH = 'main';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;

export const id = 'raidtheory';
export const name = 'RaidTheory/arcraiders-data';
export const homepage = `https://github.com/${REPO}`;
export const license = 'MIT';

export const attribution = {
  id,
  name,
  homepage,
  license,
  required: true,
  notice:
    'Item, quest and map data sourced from RaidTheory/arcraiders-data (MIT), ' +
    'a community repository maintained by RaidTheory LLC.',
  link: `https://github.com/${REPO}`,
  projectLink: 'https://arctracker.io',
  dataCopyright: 'Game content © Embark Studios AB. This project is not affiliated with or endorsed by Embark Studios.',
};

export async function items() {
  const files = await listFiles('items/');
  if (!files.length) return {};

  const raw = await pool(files, 12, async (path) => {
    try {
      return await fetchJson(RAW + path, { retries: 2 });
    } catch {
      return null;
    }
  });

  const out = {};
  for (const r of raw) {
    if (!r?.id) continue;
    out[r.id] = {
      id: r.id,
      name: r.name ?? {},
      description: r.description ?? {},
      type: r.type ?? '',
      rarity: r.rarity ?? '',
      value: Number(r.value ?? 0),
      weightKg: r.weightKg ?? r.weight ?? undefined,
      stackSize: r.stackSize ?? undefined,
      imageFilename: r.imageFilename ?? r.image ?? undefined,
      addedIn: r.addedIn ?? undefined,
      updatedAt: r.updatedAt ?? undefined,
      recyclesInto: r.recyclesInto ?? undefined,
      salvagesInto: r.salvagesInto ?? undefined,
      mechanics: r.mechanics ?? undefined,
      _source: id,
    };
  }
  log(id, `${Object.keys(out).length} itens`);
  return out;
}

export async function quests() {
  const files = await listFiles('quests/');
  if (!files.length) return {};

  const raw = await pool(files, 12, async (path) => {
    try {
      return await fetchJson(RAW + path, { retries: 2 });
    } catch {
      return null;
    }
  });

  const out = {};
  for (const r of raw) {
    if (!r?.id) continue;
    out[r.id] = {
      id: r.id,
      name: r.name ?? text(r.title ?? r.id),
      description: r.description ?? {},
      kind: r.kind ?? r.type ?? undefined,
      objectives: r.objectives ?? r.steps ?? undefined,
      rewards: r.rewards ?? undefined,
      maps: (r.maps ?? []).map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean),
      unlockedBy: r.unlockedBy ?? undefined,
      _source: id,
    };
  }
  log(id, `${Object.keys(out).length} quests`);
  return out;
}

/** Arquivo único na raiz (bots.json, maps.json, ...). */
export async function single(file, map) {
  const raw = await fetchJson(RAW + file);
  if (!raw) return null;
  const mapped = map ? map(raw) : raw;
  if (mapped) log(id, `${file}`);
  return mapped;
}

export async function hideout() {
  const files = await listFiles('hideout/');
  if (!files.length) return null;

  const raw = await pool(files, 12, async (path) => {
    try {
      return await fetchJson(RAW + path, { retries: 2 });
    } catch {
      return null;
    }
  });

  const modules = {};
  for (const r of raw) {
    if (!r?.id) continue;
    modules[r.id] = { ...r, _source: id };
  }
  log(id, `${Object.keys(modules).length} módulos de hideout`);
  return { schema: 1, hideoutModules: modules, totalModules: Object.keys(modules).length };
}

async function listFiles(prefix) {
  const tree = await fetchJson(
    `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`,
  );
  if (!tree?.tree) return [];
  return tree.tree
    .filter((n) => n.type === 'blob' && n.path.startsWith(prefix) && n.path.endsWith('.json'))
    .map((n) => n.path);
}