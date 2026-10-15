import { useEffect, useMemo, useState } from 'preact/hooks';

import type { GameItem } from '@arcgx/shared';

import { ItemDetail } from '../components/item-detail';
import { TileCell } from '../components/tile';

const api = window.arcgx.desktop;

const ALL = '__all__';
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
const RARITY_LABEL: Record<string, string> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Raro',
  epic: 'Épico',
  legendary: 'Lendário',
};

/** Busca sem acento e sem pontuação, como a referência indexa. */
function normalizeForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\-?.,()]/g, '')
    .toLowerCase()
    .trim();
}

type Sort = 'name' | 'rarity' | 'value';

interface Indexed extends GameItem {
  nameSearch: string;
  rarity: string;
}

function index(items: GameItem[]): Indexed[] {
  return items.map((it) => ({
    ...it,
    rarity: it.tier,
    nameSearch: normalizeForSearch(it.name),
  }));
}

function value(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString('pt-BR');
}

export function Items() {
  const [all, setAll] = useState<Indexed[] | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string>(ALL);
  const [rarity, setRarity] = useState<string>(ALL);
  const [sort, setSort] = useState<Sort>('name');
  const [selected, setSelected] = useState<GameItem | null>(null);

  // Carrega a base inteira uma vez e filtra no cliente. A referência faz o
  // mesmo (`buildItemIndex`): com 712 itens a consulta por tecla é o que
  // deixa a busca parecer lenta, não a falta de índice.
  useEffect(() => {
    let alive = true;
    void api
      .listItems('', 1000)
      .then((items) => {
        if (alive) setAll(index(items ?? []));
      })
      .catch(() => {
        if (alive) setAll([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of all ?? []) counts.set(it.category ?? '—', (counts.get(it.category ?? '—') ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [all]);

  const rarities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of all ?? []) counts.set(it.rarity, (counts.get(it.rarity) ?? 0) + 1);
    return RARITY_ORDER.filter((r) => counts.has(r)).map((r) => [r, counts.get(r)!] as const);
  }, [all]);

  const shown = useMemo(() => {
    const s = normalizeForSearch(query);
    let list = (all ?? []).filter((it) => {
      if (s && !it.nameSearch.includes(s)) return false;
      if (type !== ALL && (it.category ?? '—') !== type) return false;
      if (rarity !== ALL && it.rarity !== rarity) return false;
      return true;
    });

    if (sort === 'value') {
      list = [...list].sort(
        (a, b) => (b.baseValue ?? 0) - (a.baseValue ?? 0) || a.name.localeCompare(b.name, 'pt-BR'),
      );
    } else if (sort === 'rarity') {
      list = [...list].sort(
        (a, b) =>
          RARITY_ORDER.indexOf(b.rarity as never) - RARITY_ORDER.indexOf(a.rarity as never) ||
          a.name.localeCompare(b.name, 'pt-BR'),
      );
    }
    return list;
  }, [all, query, type, rarity, sort]);

  const filtered = query !== '' || type !== ALL || rarity !== ALL;
  const total = all?.length ?? 0;

  function clearFilters() {
    setQuery('');
    setType(ALL);
    setRarity(ALL);
  }

  return (
    <>
      <div class="page-head">
        <div>
          <div class="h2">Itens</div>
          <div class="muted">
            {all === null
              ? 'carregando…'
              : `${shown.length} de ${total} itens`}
          </div>
        </div>
      </div>

      <div class="toolbar">
        <input
          class="input"
          placeholder="Buscar item…"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <select class="input" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>
          <option value={ALL}>Todos os tipos ({total})</option>
          {types.map(([t, n]) => (
            <option key={t} value={t}>
              {t} ({n})
            </option>
          ))}
        </select>
        <select class="input" value={rarity} onChange={(e) => setRarity((e.target as HTMLSelectElement).value)}>
          <option value={ALL}>Todas as raridades ({total})</option>
          {rarities.map(([r, n]) => (
            <option key={r} value={r}>
              {RARITY_LABEL[r] ?? r} ({n})
            </option>
          ))}
        </select>
        <select class="input" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)}>
          <option value="name">Ordenar por nome</option>
          <option value="rarity">Ordenar por raridade</option>
          <option value="value">Ordenar por valor</option>
        </select>
        {filtered ? (
          <button type="button" class="btn ghost" onClick={clearFilters}>
            limpar
          </button>
        ) : null}
      </div>

      <div class="grid" style={{ gridTemplateColumns: selected ? '1fr 320px' : '1fr' }}>
        <div class="card" style={{ padding: 0, overflow: 'hidden' }}>
          {all === null ? (
            <div class="empty">
              <div class="empty-title">Carregando</div>
            </div>
          ) : shown.length === 0 ? (
            <div class="empty">
              <div class="empty-title">
                {filtered ? 'Nenhum item casa com esses filtros' : 'Nenhum item indexado'}
              </div>
              {filtered ? (
                <>
                  <div class="empty-hint">Tente parte do nome, sem acento.</div>
                  <button type="button" class="btn" onClick={clearFilters}>
                    limpar filtros
                  </button>
                </>
              ) : (
                <div class="empty-hint">
                  A base só carrega depois de um restart bem-sucedido com a release disponível.
                </div>
              )}
            </div>
          ) : (
            <div class="gx-grid">
              {shown.map((it) => (
                <TileCell
                  key={it.id}
                  item={it}
                  selected={selected?.id === it.id}
                  onSelect={setSelected}
                />
              ))}
            </div>
          )}
        </div>

        {selected ? <ItemDetail item={selected} onClose={() => setSelected(null)} /> : null}
      </div>
    </>
  );
}
