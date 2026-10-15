/**
 * Normalização compartilhada pelas fontes de dados.
 *
 * Cada fonte tem seu formato; a saída é sempre o schema do Arc GX
 * (`packages/shared/src/game-schema.ts`). Quem chama preenche os campos que a
 * fonte não tem — o normalizador nunca inventa dado.
 */

/** Raridade das fontes -> tier do Arc GX. Aceita as duas grafias. */
const RARITY = new Map(
  Object.entries({
    common: 'common',
    uncommon: 'uncommon',
    rare: 'rare',
    epic: 'epic',
    legendary: 'legendary',
    mythic: 'mythic',
  }),
);

export function toTier(raw) {
  if (!raw) return null;
  return RARITY.get(String(raw).trim().toLowerCase()) ?? null;
}

/** "Quick Use", "quick use", "quick-use" -> "Quick Use" */
export function titleCase(s) {
  return String(s)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export const GENERATED_AT = () => new Date().toISOString();

/** Dedup por id, preservando a primeira fonte que viu o registro. */
export function mergeById(...maps) {
  const out = new Map();
  for (const map of maps) {
    for (const [id, value] of Object.entries(map ?? {})) {
      if (!out.has(id)) out.set(id, value);
    }
  }
  return Object.fromEntries(out);
}

/** Preenche buracos de um registro sem sobrescrever o que já existe. */
export function fill(target, patch) {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (target[k] === undefined || target[k] === null || target[k] === '') {
      if (v !== undefined && v !== null && v !== '') target[k] = v;
    }
  }
  return target;
}

/** Texto no formato {en: "..."} a partir de uma string simples. */
export function text(s) {
  return typeof s === 'string' && s.trim() ? { en: s.trim() } : {};
}

/** Roda tarefas com limite de concorrência (as APIs não gostam de 600 fetch). */
export async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/** fetch com retry e backoff. */
export async function fetchJson(url, { retries = 3, headers = {} } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'ArcGX/0.1 (data-ingest)', accept: 'application/json', ...headers },
      });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      last = err;
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    }
  }
  throw new Error(`${url}: ${last?.message ?? 'falhou'}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(step, msg) {
  console.log(`  ${step.padEnd(12)} ${msg}`);
}