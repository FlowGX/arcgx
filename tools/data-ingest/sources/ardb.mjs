/**
 * Fonte 2 — `ardb.app` (API REST pública).
 *
 * Complementa o RaidTheory: traz detalhe de item (`weight`, `stackSize`,
 * `breaksInto`), quests narrativos e inimigos. Não traz tradução, e sua lista
 * de itens é menor — por isso é usada para **preencher buracos**, nunca para
 * sobrescrever.
 *
 * A API pede explicitamente: guardar a resposta no armazenamento do app e
 * atualizar periodicamente. É exatamente o que o data-release faz.
 */

import { fetchJson, log, text } from '../lib/normalize.mjs';

const BASE = 'https://ardb.app/api';

export const id = 'ardb';
export const name = 'ARC Raiders Database (ardb.app)';
export const homepage = 'https://ardb.app/api';
export const license = 'ver termos no site';

export const attribution = {
  id,
  name,
  homepage,
  license,
  required: false,
  notice: 'Item details, quests and enemy data supplemented from the public ardb.app API.',
  link: 'https://ardb.app/api',
  dataCopyright: 'Game content © Embark Studios AB. Not affiliated with Embark Studios.',
};

/** Sumário de todos os itens (id, nome, raridade, tipo, valor). */
export async function itemSummaries() {
  const list = await fetchJson(`${BASE}/items`);
  if (!Array.isArray(list)) return {};
  const out = {};
  for (const r of list) {
    if (!r?.id) continue;
    out[r.id] = {
      id: r.id,
      name: text(r.name),
      description: text(r.description),
      type: r.type ?? '',
      rarity: r.rarity ?? '',
      value: Number(r.value ?? 0),
      _source: id,
    };
  }
  log(id, `${Object.keys(out).length} itens (resumo)`);
  return out;
}

/**
 * Detalhe de um item. Chamado só para os ids que ainda não temos completos,
 * para não gastar request com o que já veio traduzido.
 */
export async function itemDetail(itemId) {
  return fetchJson(`${BASE}/items/${encodeURIComponent(itemId)}`, { retries: 2 });
}

export async function quests() {
  const list = await fetchJson(`${BASE}/quests`);
  if (!Array.isArray(list)) return {};
  const out = {};
  for (const r of list) {
    if (!r?.id) continue;
    out[r.id] = {
      id: r.id,
      name: text(r.title ?? r.name ?? r.id),
      description: text(r.description),
      maps: (r.maps ?? []).map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean),
      objectives: r.steps ?? undefined,
      _source: id,
    };
  }
  log(id, `${Object.keys(out).length} quests`);
  return out;
}

export async function arcEnemies() {
  const list = await fetchJson(`${BASE}/arc-enemies`);
  if (!Array.isArray(list)) return {};
  const out = {};
  for (const r of list) {
    if (!r?.id) continue;
    out[r.id] = { id: r.id, name: r.name ?? r.id, icon: r.icon ?? undefined, _source: id };
  }
  log(id, `${Object.keys(out).length} inimigos`);
  return out;
}