/**
 * Fonte 3 — `metaforge.app` (API REST pública).
 *
 * É a fonte que acompanha o jogo de verdade: RaidTheory parou em 19/08/2026
 * (1.42.0) e o ardb em 29/04/2026, então nenhuma das duas tem o update 2.0
 * "Frozen Trail" (08/10/2026). O MetaForge entregou Stiletto, Bantam, Tether
 * Launcher, Yank Grenade, os Stencils e as chaves de Pendola Pass — e, o que
 * mais importa aqui, **ícone para 100% dos 1109 itens**.
 *
 * Entra por último e só **preenche buraco**, pelas mesmas razões do ardb: os
 * textos localizados e a proveniência do RaidTheory têm precedência. O que
 * entra daqui é o que ninguém mais tem — item novo e `imageFilename`.
 *
 * Termos da API (metaforge.app/arc-raiders/api): atribuição com link para
 * metaforge.app, e cachear do lado do app em vez de chamar direto. O
 * data-release já é exatamente esse cache.
 */

import { fetchJson, log, sleep, text } from '../lib/normalize.mjs';

const BASE = 'https://metaforge.app/api/arc-raiders';
const PAGE_SIZE = 100;

export const id = 'metaforge';
export const name = 'MetaForge (metaforge.app)';
export const homepage = 'https://metaforge.app/arc-raiders/api';
export const license = 'API pública com termos de uso';

export const attribution = {
  id,
  name,
  homepage,
  license,
  // obrigatório: os termos pedem atribuição e link de volta
  required: true,
  notice:
    'Item data and item art supplemented from the public MetaForge ARC Raiders API, maintained by MetaForge and community contributors.',
  link: 'https://metaforge.app/arc-raiders',
  dataCopyright: 'Game content © Embark Studios AB. Not affiliated with Embark Studios.',
};

/**
 * Chave de casamento entre ids.
 *
 * Nossas ids são `snake_case` e as do MetaForge são `kebab-case`
 * (`anvil_ii` vs `anvil-ii`). Comparar cru não casa nada; comparar só
 * alfanumérico casa a família inteira.
 */
export function matchKey(raw) {
  return String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Todos os itens, paginado.
 *
 * A API devolve 50 por página e um envelope `{ data, pagination }`. O
 * `hasNextPage` é respeitado em vez de adivinhar o total, para o ingest não
 * cortar a lista no meio se o catálogo crescer.
 */
export async function items() {
  const out = {};
  let page = 1;

  for (;;) {
    const res = await fetchJson(`${BASE}/items?page=${page}&limit=${PAGE_SIZE}`);
    const rows = Array.isArray(res) ? res : (res?.data ?? []);
    if (!rows.length) break;

    for (const r of rows) {
      // Indexado pelo `id` de verdade, não pelo matchKey.
      //
      // Indexar pela chave normalizada parecia prático, mas quebra a dedup:
      // ela remove por `id` (`delete items[p.id]`), e uma linha guardada sob
      // `acousticguitar` com `id: acoustic-guitar` sobrevive ao delete. Foi o
      // que deixou 524 duplicatas no catálogo com a arte já resolvida.
      if (!r?.id) continue;
      out[r.id] = {
        id: r.id,
        name: text(r.name),
        description: text(r.description),
        type: r.item_type ?? r.subcategory ?? '',
        rarity: r.rarity ?? '',
        value: Number(r.value ?? 0),
        imageFilename: r.icon ?? undefined,
        // Marca a origem da arte: a dedup usa este campo para escolher quem
        // sobrevive quando duas linhas do mesmo item têm arte. Sem ele, uma
        // linha da MetaForge é indistinguível de uma da arctracker e a de
        // 256px acaba vencendo pelo id mais curto.
        imageSource: r.icon ? id : undefined,
        stackSize: r.stack_size ?? undefined,
        _source: id,
      };
    }

    if (res?.pagination && res.pagination.hasNextPage === false) break;
    if (!res?.pagination && rows.length < PAGE_SIZE) break;
    page++;
    // a API avisa que requisições grandes podem ser limitadas
    await sleep(150);
  }

  log(id, `${Object.keys(out).length} itens (inclui 2.0 Frozen Trail)`);
  return out;
}

/**
 * Só o que interessa para fechar buraco de imagem.
 *
 * O ingest chama isso depois de montar o item principal e usa como remendo de
 * `imageFilename`; qualquer outro campo daqui seria sobrescrever dado melhor.
 */
export async function imageIndex() {
  const all = await items();
  const out = {};
  for (const [key, it] of Object.entries(all)) {
    if (it.imageFilename) out[key] = it.imageFilename;
  }
  return out;
}

/**
 * Agenda de eventos ao vivo.
 *
 * O dump do RaidTheory traz só o **catálogo** de tipos de evento; isto é o
 * que diz quando cada um acontece. Sem isto a aba de Eventos fica vazia, já
 * que nada mais publica horário.
 */
export async function events() {
  const res = await fetchJson(`${BASE}/events-schedule`);
  const rows = Array.isArray(res) ? res : (res?.data ?? []);
  const out = {};
  for (const r of rows) {
    const key = `${slug(r.name)}@${r.startTime ?? 0}`;
    out[key] = {
      id: key,
      name: r.name ?? key,
      map: r.map ?? null,
      icon: r.icon ?? undefined,
      // epoch ms -> ISO; o app compara string, e ms numérico casa em
      // todo lugar que não é o main
      startTime: r.startTime ? new Date(r.startTime).toISOString() : null,
      endTime: r.endTime ? new Date(r.endTime).toISOString() : null,
      _source: id,
    };
  }
  log(id, `${Object.keys(out).length} eventos mapeados`);
  return out;
}

function slug(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function arcEnemies() {
  const res = await fetchJson(`${BASE}/arcs`);
  const rows = Array.isArray(res) ? res : (res?.data ?? []);
  const out = {};
  for (const r of rows) {
    if (!r?.id) continue;
    out[r.id] = { id: r.id, name: r.name ?? r.id, icon: r.icon ?? undefined, _source: id };
  }
  log(id, `${Object.keys(out).length} inimigos`);
  return out;
}
