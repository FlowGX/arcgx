import { useMemo } from 'preact/hooks';

import { useColecao, useItens, useStash, valor } from '../lib/data';
import { Tile } from '../components/tile';
import { Vazio } from './quests';

interface Ref {
  itemId?: string;
  item_id?: string;
  qty?: number;
  needed?: number;
  type?: string;
}

interface Alvo {
  itemId: string;
  precisa: number;
  tem: number;
  de: string[];
  /** quanto o item rende como recompensa de projeto */
  recompensa: number;
}

/**
 * Referência de item dentro de uma fase de projeto.
 *
 * O dump real é `{ itemId, quantity, rewardItemIds: [{ itemId, quantity }] }` —
 * não é um id solto nem `{ id, qty }`, que era o que a primeira versão lia e
 * por isso cruzava zero item.
 */
interface Ref {
  itemId?: string;
  quantity?: number;
  rewardItemIds?: Ref[];
}

interface Fase {
  requirementItemIds?: Ref[];
  rewardItemIds?: Ref[];
  rewards?: Ref[];
}

interface Projeto {
  id?: string;
  name?: unknown;
  phases?: Fase[];
  parts?: Fase[];
}

interface Quest {
  id?: string;
  /** as quests do dump trazem objetivo em texto traduzido, sem id de item */
  objectives?: unknown[];
  items?: Ref[];
  rewardItems?: Ref[];
}

/**
 * Cruza o que quests e projetos exigem com o que o jogador tem.
 *
 * `tem` é a soma das pilhas do stash. A cobertura é `min(precisa, tem)/precisa`
 * — somar tudo sem o `min` dá 100% com uma pilha só num item que pede oito.
 */
export function Needs() {
  const { rows: quests } = useColecao<Quest>('quests.json', 'quests');
  const { rows: projetos } = useColecao<Projeto>('projects.json', 'projects');
  const { items, get: acharItem } = useItens();
  const { entries } = useStash();

  const alvos = useMemo(() => {
    const mapa = new Map<string, Alvo>();

    const add = (ref: Ref, de: string) => {
      const id = ref?.itemId;
      if (!id) return;
      const cur = mapa.get(id) ?? { itemId: id, precisa: 0, tem: 0, de: [], recompensa: 0 };
      cur.precisa += Math.max(1, Number(ref.quantity) || 1);
      if (!cur.de.includes(de)) cur.de.push(de);
      // o que o item rende é informação de valor, não de falta
      for (const r of ref.rewardItemIds ?? []) {
        const rid = r?.itemId;
        if (!rid) continue;
        const c = mapa.get(rid) ?? { itemId: rid, precisa: 0, tem: 0, de: [], recompensa: 0 };
        c.recompensa += Math.max(1, Number(r.quantity) || 1);
        mapa.set(rid, c);
      }
      mapa.set(id, cur);
    };

    for (const p of projetos ?? []) {
      const id = String(p.id ?? '');
      for (const f of p.phases ?? p.parts ?? []) {
        for (const ref of f.requirementItemIds ?? []) add(ref, `projeto ${id}`);
        for (const ref of f.rewards ?? []) add(ref, `projeto ${id}`);
        for (const ref of f.rewardItemIds ?? []) add(ref, `projeto ${id}`);
      }
    }

    for (const q of quests ?? []) {
      const id = String(q.id ?? '');
      for (const ref of q.items ?? []) add(ref, `quest ${id}`);
      for (const ref of q.rewardItems ?? []) add(ref, `prêmio ${id}`);
    }

    // cruza com o stash
    const temPorItem = new Map<string, number>();
    for (const e of entries ?? []) temPorItem.set(e.itemId, (temPorItem.get(e.itemId) ?? 0) + (e.qty || 1));
    for (const a of mapa.values()) a.tem = temPorItem.get(a.itemId) ?? 0;

    return [...mapa.values()]
      .filter((x) => x.precisa > 0)
      .sort((a, b) => {
        const fa = Math.min(a.precisa, a.tem) / a.precisa;
        const fb = Math.min(b.precisa, b.tem) / b.precisa;
        if (fa !== fb) return fa - fb;
        return b.precisa - a.precisa;
      });
  }, [quests, projetos, entries]);

  if (!quests || !projetos) return <div class="muted">cruzando quests e projetos…</div>;

  const total = alvos.reduce((a, x) => a + x.precisa, 0);
  const coberto = alvos.reduce((a, x) => a + Math.min(x.precisa, x.tem), 0);
  const pct = total ? (coberto / total) * 100 : 0;
  const faltando = alvos.filter((x) => x.tem < x.precisa);

  return (
    <>
      <div class="page-head">
        <div>
          <div class="h2">O que ainda falta</div>
          <div class="muted">
            {alvos.length} itens citados por {total} unidades · {pct.toFixed(0)}% coberto
          </div>
        </div>
      </div>

      <div class="card" style={{ marginBottom: 12 }}>
        <div class="meter">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div class="muted" style={{ fontSize: 11, marginTop: 8 }}>
          {entries?.length
            ? `Calculado contra ${entries.length} pilhas lidas do seu stash.`
            : 'Sem stash lido, tudo aparece como faltando. Ligue a captura e role o inventário para isso fechar.'}
        </div>
      </div>

      {!faltando.length ? (
        <Vazio titulo="Tudo coberto" dica="Nenhum item citado por quests ou projetos está em falta." />
      ) : (
        <div class="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table class="table">
            <thead>
              <tr>
                <th style={{ width: 46 }} />
                <th>Item</th>
                <th class="num">Tem</th>
                <th class="num">Precisa</th>
                <th style={{ width: 120 }}>Cobertura</th>
              </tr>
            </thead>
            <tbody>
              {faltando.slice(0, 300).map((a) => {
                const item = acharItem(a.itemId);
                const p = Math.min(1, a.tem / a.precisa);
                return (
                  <tr key={a.itemId}>
                    <td>
                      <Tile item={item ?? { id: a.itemId, name: a.itemId, tier: 'common' }} bare={!item?.imageUrl} />
                    </td>
                    <td>
                      <div style={{ color: 'var(--gx-text-1)' }}>{item?.name ?? a.itemId}</div>
                      <div class="muted" style={{ fontSize: 10 }}>
                        {a.de.slice(0, 2).join(' · ')}
                        {a.de.length > 2 ? ` +${a.de.length - 2}` : ''}
                      </div>
                    </td>
                    <td class="num">{a.tem}</td>
                    <td class="num">{a.precisa}</td>
                    <td>
                      <div class="meter sm">
                        <i style={{ width: `${p * 100}%` }} />
                      </div>
                      <div class="muted" style={{ fontSize: 10, marginTop: 3 }}>
                        {Math.round(p * 100)}%
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div class="muted" style={{ marginTop: 12, fontSize: 11 }}>
        Valor de referência somado dos faltantes:{' '}
        <strong>
          {valor(
            faltando.reduce((acc, a) => {
              const it = acharItem(a.itemId);
              return acc + (Number(it?.baseValue) || 0) * (a.precisa - a.tem);
            }, 0),
          )}
        </strong>
      </div>
    </>
  );
}
