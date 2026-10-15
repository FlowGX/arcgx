import { useMemo, useState } from 'preact/hooks';

import { norm, useColecao, valor } from '../lib/data';

interface RawStep {
  itemId?: string;
  item_id?: string;
  type?: string;
  qty?: number;
  needed?: number;
  objective?: string;
  description?: string;
  reward?: boolean;
  optional?: boolean;
}

interface RawQuest {
  id: string;
  name?: unknown;
  title?: unknown;
  description?: unknown;
  trader?: string;
  traderName?: string;
  map?: string;
  maps?: string[];
  xp?: number;
  rewardItems?: RawStep[];
  items?: RawStep[];
  objectives?: RawStep[];
  steps?: RawStep[];
  optional?: boolean;
  status?: string;
}

const texto = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, string>;
    return o['pt-BR'] ?? o.pt ?? o.en ?? Object.values(o).find((x) => !!x) ?? '';
  }
  return '';
};

function passos(q: RawQuest): RawStep[] {
  const base = q.items ?? q.objectives ?? q.steps ?? [];
  const recompensa = q.rewardItems ?? [];
  return [
    ...base.map((s) => ({ ...s, reward: false })),
    ...recompensa.map((s) => ({ ...s, reward: true })),
  ];
}

type Aba = 'todas' | 'entregar' | 'andamento' | 'prontas';

export function Quests() {
  const { rows: lista, erro } = useColecao<RawQuest>('quests.json', 'quests');
  const [q, setQ] = useState('');
  const [trader, setTrader] = useState('__all__');
  const [aba, setAba] = useState<Aba>('todas');


  const traders = useMemo(() => {
    if (!lista) return [];
    const m = new Map<string, number>();
    for (const x of lista) {
      const t = x.traderName ?? x.trader ?? '—';
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lista]);

  const shown = useMemo(() => {
    if (!lista) return [];
    const s = norm(q);
    return lista.filter((x) => {
      if (s && !norm(texto(x.name ?? x.title)).includes(s)) return false;
      if (trader !== '__all__' && (x.traderName ?? x.trader ?? '—') !== trader) return false;
      return true;
    });
  }, [lista, q, trader]);

  if (erro) return <Vazio titulo="Quests indisponíveis" dica="A release não trouxe quests.json." />;
  if (!lista) return <div class="muted">carregando quests…</div>;

  const prontas = shown.filter((x) => passos(x).length > 0 && passos(x).every((s) => s.optional));
  const emAndamento = shown.filter((x) => !prontas.includes(x));

  const visivel = aba === 'prontas' ? prontas : aba === 'andamento' ? emAndamento : shown;

  return (
    <>
      <div class="page-head">
        <div>
          <div class="h2">Quests</div>
          <div class="muted">{shown.length} de {lista.length} quests</div>
        </div>
      </div>

      <div class="toolbar">
        <input
          class="input"
          placeholder="Buscar quest ou comerciante…"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        <select class="input" value={trader} onChange={(e) => setTrader((e.target as HTMLSelectElement).value)}>
          <option value="__all__">Todos os comerciantes</option>
          {traders.map(([t, n]) => (
            <option key={t} value={t}>
              {t} ({n})
            </option>
          ))}
        </select>
        <div class="segment">
          {(['todas', 'andamento', 'prontas'] as Aba[]).map((a) => (
            <button
              key={a}
              type="button"
              class={aba === a ? 'on' : ''}
              onClick={() => setAba(a)}
            >
              {a === 'todas' ? 'Todas' : a === 'andamento' ? 'Em andamento' : 'Prontas'}
            </button>
          ))}
        </div>
      </div>

      {!visivel.length ? (
        <Vazio titulo="Nenhuma quest casa com isso" dica="Tente parte do nome, sem acento." />
      ) : (
        <div class="grid grid-2">
          {visivel.map((x) => (
            <QuestCard key={x.id} quest={x} />
          ))}
        </div>
      )}
    </>
  );
}

function QuestCard({ quest }: { quest: RawQuest }) {
  const ps = passos(quest);
  const trader = quest.traderName ?? quest.trader;
  const pronta = ps.length > 0 && ps.every((s) => s.optional);

  return (
    <div class="card quest">
      <div class="quest-head">
        <div style={{ minWidth: 0 }}>
          <div class="quest-name">{texto(quest.name ?? quest.title) || quest.id}</div>
          <div class="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {trader ? `entregar em ${trader}` : quest.id}
            {quest.map ? ` · ${quest.map}` : ''}
          </div>
        </div>
        {quest.xp ? <span class="pill">{valor(quest.xp)} xp</span> : null}
        {pronta ? <span class="pill ok">pronta</span> : null}
      </div>

      {ps.length ? (
        <div class="steps">
          {ps.map((s, i) => (
            <div key={i} class={s.reward ? 'step reward' : 'step'}>
              <span class="step-dot" />
              <span class="step-text">
                {s.optional ? 'opcional: ' : ''}
                {s.description ?? s.objective ?? s.itemId ?? s.item_id ?? 'passo'}
              </span>
              {s.qty || s.needed ? <span class="badge">×{s.qty ?? s.needed}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <div class="muted" style={{ fontSize: 11, marginTop: 8 }}>
          sem passos registrados
        </div>
      )}
    </div>
  );
}

export function Vazio({ titulo, dica }: { titulo: string; dica: string }) {
  return (
    <div class="card">
      <div class="empty">
        <div class="empty-title">{titulo}</div>
        <div class="empty-hint">{dica}</div>
      </div>
    </div>
  );
}
