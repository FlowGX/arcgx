import { useMemo, useState } from 'preact/hooks';

import { useColecao, useGameFile, useItens, valor } from '../lib/data';
import { Tile } from '../components/tile';
import { Vazio } from './quests';

interface RawReward {
  itemId?: string;
  item_id?: string;
  qty?: number;
  needed?: number;
}

interface RawPhase {
  id?: string;
  name?: unknown;
  title?: unknown;
  description?: unknown;
  rewards?: RawReward[];
  items?: RawReward[];
  cost?: RawReward[];
}

interface RawProject {
  id: string;
  name?: unknown;
  title?: unknown;
  description?: unknown;
  status?: string;
  phases?: RawPhase[];
  parts?: RawPhase[];
  ended?: boolean;
}

const texto = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, string>;
    return o['pt-BR'] ?? o.pt ?? o.en ?? Object.values(o).find((x) => !!x) ?? '';
  }
  return '';
};

export function Projects() {
  const { rows: brutos, erro } = useColecao<RawProject>('projects.json', 'projects');
  const [aberto, setAberto] = useState<string | null>(null);

  const lista = useMemo(
    () =>
      [...(brutos ?? [])].sort((a, b) =>
        texto(a.name ?? a.title).localeCompare(texto(b.name ?? b.title), 'pt-BR'),
      ),
    [brutos],
  );

  if (erro) return <Vazio titulo="Projetos indisponíveis" dica="A release não trouxe projects.json." />;
  if (!lista) return <div class="muted">carregando projetos…</div>;

  return (
    <>
      <div class="page-head">
        <div>
          <div class="h2">Projetos</div>
          <div class="muted">{lista.length} projetos no outpost</div>
        </div>
      </div>

      {!lista.length ? (
        <Vazio titulo="Nenhum projeto" dica="A base ainda não tem projects.json." />
      ) : (
        <div class="grid" style={{ gap: 10 }}>
          {lista.map((p) => {
            const fases = p.phases ?? p.parts ?? [];
            const abertoAqui = aberto === p.id;
            const collect = fases.flatMap((f) => f.rewards ?? f.items ?? []);

            return (
              <div key={p.id} class="card proj">
                <button type="button" class="proj-head" onClick={() => setAberto(abertoAqui ? null : p.id)}>
                  <span class="proj-caret" data-open={abertoAqui ? '' : undefined}>
                    ›
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span class="quest-name">{texto(p.name ?? p.title) || p.id}</span>
                    {p.status ? <span class="badge" style={{ marginLeft: 8 }}>{p.status}</span> : null}
                  </span>
                  <span class="muted" style={{ fontSize: 11 }}>
                    {fases.length} fase{fases.length === 1 ? '' : 's'}
                  </span>
                </button>

                {abertoAqui ? (
                  <div class="proj-body">
                    {p.description ? (
                      <p class="muted" style={{ lineHeight: 1.6, marginBottom: 12 }}>
                        {texto(p.description)}
                      </p>
                    ) : null}

                    {fases.map((f, i) => (
                      <div key={f.id ?? i} class="phase">
                        <div class="phase-title">
                          {i + 1}. {texto(f.name ?? f.title) || `Fase ${i + 1}`}
                        </div>
                        {(f.rewards ?? f.items ?? []).length ? (
                          <div class="tiles-inline">
                            {(f.rewards ?? f.items ?? []).map((r, j) => (
                              <RewardTile key={j} reward={r} />
                            ))}
                          </div>
                        ) : (
                          <div class="muted" style={{ fontSize: 11 }}>
                            sem itens registrados
                          </div>
                        )}
                      </div>
                    ))}

                    {collect.length ? (
                      <div class="muted" style={{ marginTop: 12, fontSize: 11 }}>
                        {collect.length} recompensa{collect.length === 1 ? '' : 's'} no total
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function RewardTile({ reward }: { reward: RawReward }) {
  const { items } = useItens();
  const id = reward.itemId ?? reward.item_id ?? '';
  const item = items?.find((i) => i.id === id);
  const q = reward.qty ?? reward.needed ?? 1;

  return (
    <div class="inline-tile" title={item?.name ?? id}>
      <Tile item={item ?? { id, name: id, tier: 'common' }} qty={q} bare={!item?.imageUrl} />
      <span class="inline-name">{item?.name ?? id}</span>
    </div>
  );
}

/* --------------------------------------------------------------- pesquisa */

interface RawNode {
  id: string;
  name?: unknown;
  title?: unknown;
  description?: unknown;
  kind?: string;
  type?: string;
  level?: number;
  maxLevel?: number;
  cost?: { itemId?: string; qty?: number }[];
  requires?: string[];
  reward?: { itemId?: string; qty?: number };
  points?: number;
}

interface RawSkillTree {
  nodes?: Record<string, RawNode>;
  items?: Record<string, RawNode>;
}

export function Research() {
  const { rows: brutos, erro } = useColecao<RawNode>('skill-nodes.json', 'skillNodes', 'nodes');
  const [kind, setKind] = useState('__all__');
  const [q, setQ] = useState('');

  const nos = brutos ?? [];

  const kinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nos) {
      const k = n.kind ?? n.type ?? '—';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [nos]);

  if (erro) return <Vazio titulo="Pesquisa indisponível" dica="A release não trouxe skill-nodes.json." />;
  if (!brutos) return <div class="muted">carregando árvore…</div>;

  const shown = nos.filter((n) => {
    if (kind !== '__all__' && (n.kind ?? n.type) !== kind) return false;
    if (q && !texto(n.name ?? n.title).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <div class="page-head">
        <div>
          <div class="h2">Pesquisa</div>
          <div class="muted">{shown.length} de {nos.length} nós da estação</div>
        </div>
      </div>

      <div class="toolbar">
        <input
          class="input"
          placeholder="Buscar pesquisa…"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        <select class="input" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)}>
          <option value="__all__">Todos os tipos</option>
          {kinds.map(([k, n]) => (
            <option key={k} value={k}>
              {k} ({n})
            </option>
          ))}
        </select>
      </div>

      {!shown.length ? (
        <Vazio titulo="Nada encontrado" dica="Ajuste os filtros." />
      ) : (
        <div class="grid grid-3">
          {shown.map((n) => (
            <div key={n.id} class="card node">
              <div class="quest-name">{texto(n.name ?? n.title) || n.id}</div>
              <div class="muted mono" style={{ fontSize: 10, marginTop: 2 }}>
                {n.kind ?? n.type ?? '—'}
                {n.maxLevel ? ` · nível ${n.level ?? 0}/${n.maxLevel}` : ''}
              </div>
              {n.description ? (
                <p class="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.55 }}>
                  {texto(n.description)}
                </p>
              ) : null}
              {n.points ? (
                <span class="pill" style={{ marginTop: 8 }}>
                  {valor(n.points)} pontos
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
