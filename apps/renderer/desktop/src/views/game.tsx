import { useMemo, useState } from 'preact/hooks';

import type { AppConfig } from '@arcgx/shared';

import { norm, txt, useColecao, useGameFile, useItens, useRaids, useStash, valor } from '../lib/data';
import { Tile } from '../components/tile';
import { Vazio } from './quests';

/* ------------------------------------------------------------------ stash */

export function Stash() {
  const { entries } = useStash();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('__all__');

  const categorias = useMemo(() => {
    if (!entries) return [];
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.category ?? '—', (m.get(e.category ?? '—') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const shown = useMemo(() => {
    if (!entries) return [];
    const s = norm(q);
    return entries.filter((e) => {
      if (s && !norm(e.name).includes(s)) return false;
      if (cat !== '__all__' && (e.category ?? '—') !== cat) return false;
      return true;
    });
  }, [entries, q, cat]);

  const total = useMemo(
    () => shown.reduce((acc, e) => acc + (Number(e.baseValue) || 0) * (e.qty || 1), 0),
    [shown],
  );

  if (!entries) return <div class="muted">carregando stash…</div>;

  if (!entries.length) {
    return (
      <>
        <div class="page-head">
          <div>
            <div class="h2">Stash</div>
            <div class="muted">nenhuma pilha registrada</div>
          </div>
        </div>
        <Vazio
          titulo="O stash ainda não foi lido"
          dica="Ligue a captura em Ajustes, abra o inventário no jogo e role a mochila de cima para baixo. Cada pilha lida aparece aqui."
        />
      </>
    );
  }

  return (
    <>
      <div class="page-head">
        <div>
          <div class="h2">Stash</div>
          <div class="muted">
            {shown.length} pilhas · {valor(total)} em valor de referência
          </div>
        </div>
      </div>

      <div class="toolbar">
        <input
          class="input"
          placeholder="Buscar no stash…"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        <select class="input" value={cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value)}>
          <option value="__all__">Todas as categorias ({entries.length})</option>
          {categorias.map(([c, n]) => (
            <option key={c} value={c}>
              {c} ({n})
            </option>
          ))}
        </select>
      </div>

      {!shown.length ? (
        <Vazio titulo="Nada no filtro" dica="Limpe a busca ou troque a categoria." />
      ) : (
        <div class="card" style={{ padding: 16 }}>
          <div class="tiles">
            {shown.map((e) => (
              <div key={e.slot} class="stash-cell">
                <Tile
                  item={{
                    id: e.itemId,
                    name: e.name,
                    tier: (e.tier ?? 'common') as never,
                    baseValue: e.baseValue,
                    imageUrl: e.imageUrl,
                    category: e.category,
                  }}
                  qty={e.qty}
                />
                <div class="stash-name">{e.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- incursões */

export function Raids() {
  const { raids } = useRaids();

  if (!raids) return <div class="muted">carregando incursões…</div>;

  const loot = raids.reduce((a, r) => a + (Number(r.lootValue) || 0), 0);
  const dead = raids.filter((r) => /morreu|perdeu|derrot|death/i.test(r.outcome ?? '')).length;

  return (
    <>
      <div class="page-head">
        <div>
          <div class="h2">Incursões</div>
          <div class="muted">{raids.length} registradas neste PC</div>
        </div>
      </div>

      {!raids.length ? (
        <Vazio
          titulo="Nenhuma incursão registrada"
          dica="O histórico aparece quando o app observa o fim de uma incursão. É leitura de tela — nada sai do jogo."
        />
      ) : (
        <>
          <div class="stat-row">
            <Stat rotulo="Incursões" valor={String(raids.length)} />
            <Stat rotulo="Saída" valor={valor(loot)} />
            <Stat rotulo="Extração" valor={String(raids.length - dead)} />
            <Stat rotulo="Perdidas" valor={String(dead)} />
          </div>

          <div class="card" style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
            <table class="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Mapa</th>
                  <th>Resultado</th>
                  <th class="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {raids.map((r) => (
                  <tr key={r.id}>
                    <td class="muted">
                      {new Date(r.startedAt).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>{r.map ?? '—'}</td>
                    <td>
                      <span class={/morreu|perdeu/i.test(r.outcome ?? '') ? 'pill bad' : 'pill ok'}>
                        {r.outcome ?? '—'}
                      </span>
                    </td>
                    <td class="num">{valor(r.lootValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ rotulo, valor: v }: { rotulo: string; valor: string }) {
  return (
    <div class="card stat">
      <div class="stat-label">{rotulo}</div>
      <div class="stat-value">{v}</div>
    </div>
  );
}
