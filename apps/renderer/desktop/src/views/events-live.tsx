import { useEffect, useMemo, useState } from 'preact/hooks';
import { idioma } from '../lib/data';
import { mapaDoEvento, nomeEvento } from '@arcgx/shared/i18n';

const api = window.arcgx.desktop;

/* ------------------------------------------------------------------ tipos */

interface Occ {
  start: number;
  end: number;
  map: string;
}

interface LiveEvent {
  id: string;
  name: string;
  map: string;
  icon?: string;
  description?: string;
  current?: Occ;
  next?: Occ;
  upcoming: Occ[];
}

interface Snapshot {
  tipos: { id: string; name: string; map: string; icon?: string; days: number[] }[];
  aoVivo: LiveEvent[];
  fetchedAt: number;
  ok: boolean;
  erro?: string;
}

/* ------------------------------------------------------------- servidores */

/**
 * Regiões de servidor do ARC.
 *
 * A fonte **não separa evento por região** — a rotação é global. O que de
 * fato muda entre América do Sul, América do Norte, Europa e Ásia é o fuso em
 * que o horário aparece, então é isso que o seletor controla. Está escrito na
 * interface para ninguém supor que o filtro é mais forte do que é.
 */
const SERVIDORES = [
  { id: 'sa', nome: 'América do Sul', tz: 'America/Sao_Paulo' },
  { id: 'na', nome: 'América do Norte', tz: 'America/New_York' },
  { id: 'eu', nome: 'Europa', tz: 'Europe/London' },
  { id: 'as', nome: 'Ásia', tz: 'Asia/Tokyo' },
];

function fmtContagem(ms: number): string {
  if (ms <= 0) return 'agora';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function hora(ts: number, tz: string): string {
  return new Date(ts).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
}

function dia(ts: number, tz: string): string {
  return new Date(ts).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: tz,
  });
}

/* ------------------------------------------------------------------ view */

export function EventsLive() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [servidor, setServidor] = useState('sa');
  const [mapa, setMapa] = useState<string>('__all__');
  const [janela, setJanela] = useState<12 | 24>(24);
  // relógio local: só a contagem regressiva precisa disso, o resto re-renderiza
  // quando a fonte responde de novo
  const [, forcar] = useState(0);

  const tz = SERVIDORES.find((s) => s.id === servidor)?.tz ?? 'America/Sao_Paulo';

  useEffect(() => {
    let vivo = true;
    void api
      .eventsSnapshot()
      .then((s: unknown) => {
        if (vivo && s) setSnap(s as Snapshot);
      })
      .catch(() => {});
    const off = api.onEventsSnapshot((s) => {
      if (vivo && s) setSnap(s as Snapshot);
    });
    const t = window.setInterval(() => forcar((n) => n + 1), 1000);
    return () => {
      vivo = false;
      off();
      window.clearInterval(t);
    };
  }, []);

  const mapas = useMemo(() => {
    const m = new Set<string>();
    for (const e of snap?.aoVivo ?? []) m.add(e.map);
    return [...m].sort((a, b) => a.localeCompare(b));
  }, [snap]);

  const ativos = useMemo(
    () => (snap?.aoVivo ?? []).filter((e) => e.current),
    [snap],
  );
  const proximos = useMemo(() => {
    const limite = Date.now() + janela * 3600_000;
    return (snap?.aoVivo ?? [])
      .filter((e) => !e.current && e.next && e.next.start <= limite)
      .sort((a, b) => (a.next!.start || 0) - (b.next!.start || 0));
  }, [snap, janela]);

  const porMapa = useMemo(() => {
    if (mapa === '__all__') return null;
    return (snap?.aoVivo ?? []).filter((e) => e.map === mapa);
  }, [snap, mapa]);

  if (!snap) {
    return (
      <>
        <div class="page-head">
          <div class="h2">Eventos de mapa</div>
        </div>
        <div class="muted">buscando a agenda…</div>
      </>
    );
  }

  const semFonte = !snap.ok && snap.tipos.length === 0;

  return (
    <>
      <div class="page-head">
        <div>
          <div class="h2">Eventos de mapa</div>
          <div class="muted">
            {snap.tipos.length} tipos · agenda de{' '}
            {new Date(snap.fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            {snap.ok ? '' : ' · última leitura falhou'}
          </div>
        </div>
      </div>

      {semFonte ? (
        <div class="card">
          <div class="empty">
            <div class="empty-title">Agenda indisponível</div>
            <div class="empty-hint">
              A fonte não respondeu. O app tenta de novo a cada 2 minutos — nada precisa ser feito.
              {snap.erro ? ` (${snap.erro})` : ''}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div class="toolbar">
            <select
              class="input"
              value={servidor}
              onChange={(e) => setServidor((e.target as HTMLSelectElement).value)}
              title="A rotação de eventos é global; o seletor muda o fuso dos horários."
            >
              {SERVIDORES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} ({s.tz})
                </option>
              ))}
            </select>

            <div class="segment">
              {([12, 24] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  class={janela === h ? 'on' : ''}
                  onClick={() => setJanela(h)}
                >
                  {h}h
                </button>
              ))}
            </div>

            <div style={{ flex: 1 }} />

            <button
              type="button"
              class="chip-filter"
              aria-pressed={mapa === '__all__'}
              onClick={() => setMapa('__all__')}
            >
              Todos os mapas
            </button>
            {mapas.map((m) => (
              <button
                key={m}
                type="button"
                class="chip-filter"
                aria-pressed={mapa === m}
                onClick={() => setMapa(m)}
              >
                {m}
              </button>
            ))}
          </div>

          {mapa !== '__all__' ? (
            <div class="grid grid-3" style={{ marginBottom: 16 }}>
              {(porMapa ?? []).map((e) => (
                <CardEvento key={e.id} ev={e} tz={tz} />
              ))}
              {!(porMapa ?? []).length ? (
                <div class="muted">Nenhum evento registrado para este mapa.</div>
              ) : null}
            </div>
          ) : (
            <>
              <div class="ev-secao">
                <span class="dot live" />
                Acontecendo agora
                <span class="badge">{ativos.length}</span>
              </div>
              {ativos.length ? (
                <div class="grid grid-3" style={{ marginBottom: 20 }}>
                  {ativos.map((e) => (
                    <CardEvento key={e.id} ev={e} tz={tz} />
                  ))}
                </div>
              ) : (
                <div class="muted" style={{ marginBottom: 20 }}>
                  Nenhum evento em curso neste momento.
                </div>
              )}

              <div class="ev-secao">
                <span class="dot next" />
                A seguir nas próximas {janela}h
                <span class="badge">{proximos.length}</span>
              </div>
              {proximos.length ? (
                <div class="grid grid-3">
                  {proximos.slice(0, 18).map((e) => (
                    <CardEvento key={e.id} ev={e} tz={tz} />
                  ))}
                </div>
              ) : (
                <div class="muted">Nada agendado na janela.</div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function CardEvento({ ev, tz }: { ev: LiveEvent; tz: string }) {
  const ativo = !!ev.current;
  const ref = ev.current ?? ev.next;
  const restante = ref ? (ativo ? ref.end : ref.start) - Date.now() : 0;

  return (
    <div class="card evc" data-ativo={ativo ? '' : undefined}>
      {ev.icon ? (
        <img class="evc-icone" src={ev.icon} alt="" loading="lazy" draggable={false} />
      ) : (
        <div class="evc-icone fallback">?</div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div class="evc-nome">{nomeEvento(ev.id, ev.name, idioma())}</div>
        <div class="muted" style={{ fontSize: 11 }}>
          {mapaDoEvento(ev.map) ?? ev.map}
        </div>
      </div>

      <span class={ativo ? 'pill ok' : 'pill'}>
        {ativo ? 'ativo' : 'a seguir'}
      </span>

      {ref ? (
        <div class="evc-janela">
          <span class="mono">
            {hora(ref.start, tz)} – {hora(ref.end, tz)}
          </span>
          <span class={ativo ? 'evc-restante fim' : 'evc-restante'}>
            {ativo ? 'termina em' : 'começa em'} {fmtContagem(restante)}
          </span>
        </div>
      ) : null}

      {ev.upcoming.length > 1 ? (
        <div class="evc-proximas">
          {ev.upcoming.slice(0, 3).map((o, i) => (
            <div key={i} class="evc-oc">
              <span class="mono">
                {dia(o.start, tz)} {hora(o.start, tz)}–{hora(o.end, tz)}
              </span>
              <span class="muted">{o.map}</span>
              <span class="muted">{fmtContagem(o.start - Date.now())}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
