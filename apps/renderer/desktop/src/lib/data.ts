import { useEffect, useState } from 'preact/hooks';

import type { GameItem, RaidRecord, StashEntry } from '@arcgx/shared';
import { IDIOMA_PADRAO, type Idioma } from '@arcgx/shared/i18n';

const api = window.arcgx.desktop;

/**
 * Carrega um `game/*.json` da release uma vez e compartilha entre páginas.
 *
 * `quests.json` tem 889 KB e `projects.json` 288 KB: pedir por página numa
 * troca de aba refazia quase um megabyte de parse. O cache é por arquivo e
 * vale a sessão inteira.
 */
const cache = new Map<string, Promise<unknown>>();

export function loadGameFile<T>(name: string): Promise<T> {
  let p = cache.get(name);
  if (!p) {
    p = api.listGameFile(name).catch(() => null);
    cache.set(name, p);
  }
  return p as Promise<T>;
}

export function useGameFile<T>(name: string): { data: T | null; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadGameFile<T>(name)
      .then((d) => {
        if (!alive) return;
        if (d == null) setError(true);
        else setData(d);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [name]);

  return { data, error };
}

/* ------------------------------------------------------------- coleções */

/**
 * Achata um arquivo de jogo numa lista de registros, sem saber o formato.
 *
 * A release é inconsistente de propósito histórico: `items.json` e
 * `arc-enemies.json` embrulham em `{ items }` / `{ arcEnemies }`, enquanto
 * `projects.json`, `skill-nodes.json`, `maps.json` e `trades.json` são
 * **array na raiz**. Cada view adivinhando a forma é exatamente como uma tela
 * fica vazia sem erro nenhum no console.
 *
 * Ordem da busca: as chaves conhecidas, depois a primeira chave cujo valor é
 * coleção, depois os próprios valores.
 */
export function colecao<T = Record<string, unknown>>(data: unknown, ...chaves: string[]): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as T[];

  const obj = data as Record<string, unknown>;
  for (const k of chaves) {
    const v = obj[k];
    if (Array.isArray(v)) return v as T[];
    if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>) as T[];
  }

  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) return v as T[];
    if (v && typeof v === 'object' && Object.keys(v as object).length) {
      return Object.values(v as Record<string, unknown>) as T[];
    }
  }
  return [];
}

export function useColecao<T = Record<string, unknown>>(
  name: string,
  ...chaves: string[]
): { rows: T[] | null; erro: boolean } {
  const { data, error } = useGameFile<unknown>(name);
  return { rows: error ? null : data === null ? null : colecao<T>(data, ...chaves), erro: error };
}

/* ------------------------------------------------------------------ itens */

let itensCache: Promise<GameItem[]> | null = null;

/** Catálogo inteiro, uma vez. Filtrar e ordenar no cliente é instantâneo. */
export function loadItens(): Promise<GameItem[]> {
  if (!itensCache) {
    itensCache = api.listItems('', 4000).catch(() => []);
  }
  return itensCache;
}

/**
 * Índice do catálogo que ignora a convenção de id.
 *
 * As fontes não concordam: o dump final tem `wasp-driver` (kebab, vindo do
 * MetaForge) enquanto `projects.json` referencia `wasp_driver` (snake, do
 * RaidTheory). A dedup mantém a linha que tem arte — quase sempre a kebab — e
 * o cruzamento por id exato passa a errar 89 itens que existem no catálogo.
 *
 * Normalizar para só alfanumérico (`waspdriver`) resolve os dois formatos, e é
 * o mesmo critério que o ingest usa para casar as linhas.
 */
export interface IndiceItens {
  items: GameItem[];
  /** id exato primeiro, depois o normalizado */
  get(id: string): GameItem | undefined;
}

export function indexarItens(items: GameItem[]): IndiceItens {
  const exato = new Map<string, GameItem>();
  const frouxo = new Map<string, GameItem>();
  for (const it of items) {
    exato.set(it.id, it);
    const k = norm(it.id);
    if (!frouxo.has(k)) frouxo.set(k, it);
  }
  return {
    items,
    get: (id: string) => {
      const direto = exato.get(id);
      if (direto) return direto;
      const frouxoHit = frouxo.get(norm(id));
      if (frouxoHit) return frouxoHit;
      const apelido = ALIAS[id];
      return apelido ? exato.get(apelido) : undefined;
    },
  };
}

/**
 * Renomeações conhecidas entre o vocabulário de `projects.json` e o de
 * `items.json`.
 *
 * As duas saem do mesmo repositório e mesmo assim discordam: o projeto pede
 * `portable_tv` e o catálogo tem `portable-television`. Sem este mapa, esses
 * itens aparecem como "sem item correspondente" na aba de Necessidades.
 *
 * Não é para enfeite — cada linha aqui é uma referência que existe no projeto
 * e não casava por normalização.
 */
const ALIAS: Record<string, string> = {
  portable_tv: 'portable-television',
  bastion_cell: 'bastion-part',
  rocketeer_driver: 'rocketeer-part',
};

export function useItens(): { items: GameItem[] | null; get: (id: string) => GameItem | undefined } {
  const [idx, setIdx] = useState<IndiceItens | null>(null);
  useEffect(() => {
    let alive = true;
    void loadItens().then((i) => alive && setIdx(indexarItens(i)));
    return () => {
      alive = false;
    };
  }, []);
  return { items: idx?.items ?? null, get: idx?.get ?? (() => undefined) };
}

/* ------------------------------------------------------- stash e incursões */

export function useStash(): { entries: StashEntry[] | null } {
  const [entries, setEntries] = useState<StashEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    void api.listStash().then((s) => alive && setEntries(s ?? [])).catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, []);
  return { entries };
}

export function useRaids(): { raids: RaidRecord[] | null } {
  const [raids, setRaids] = useState<RaidRecord[] | null>(null);
  useEffect(() => {
    let alive = true;
    void api.listRaids().then((r) => alive && setRaids(r ?? [])).catch(() => alive && setRaids([]));
    return () => {
      alive = false;
    };
  }, []);
  return { raids };
}

/* ----------------------------------------------------------------- texto */

/** NFD, sem acento, minúsculo — como a referência indexa para busca. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['\-?.,()]/g, '')
    .toLowerCase()
    .trim();
}

export function valor(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString('pt-BR');
}

/** O dump traz texto por idioma; o app só precisa do que está configurado. */
/**
 * Idioma corrente da interface.
 *
 * ## ## ## Por que é uma variável de módulo e não contexto
 *
 * `txt()` é chamada dentro de `useMemo` e de `Array.sort` — inclusive em
 * `items.tsx`, que ordena pelo nome traduzido. Passar o idioma por prop ou
 * contexto atravessaria navegadores e `useMemo` que não podem depender de
 * contexto sem virar dependência do `useMemo` inteiro.
 *
 * `setIdioma` é chamada uma vez, quando a configuração muda, em `main.tsx`.
 */
let idiomaAtual: Idioma = IDIOMA_PADRAO;

export function setIdioma(v: string | undefined): void {
  idiomaAtual = v === 'en' ? 'en' : IDIOMA_PADRAO;
}

export function idioma(): Idioma {
  return idiomaAtual;
}

export function txt(v: unknown, locale = idiomaAtual): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, string>;
    if (o[locale]) return o[locale];
    if (o['pt-BR']) return o['pt-BR'];
    if (o['pt']) return o['pt'];
    if (o.en) return o.en;
    for (const x of Object.values(o)) if (typeof x === 'string' && x) return x;
  }
  return '';
}
