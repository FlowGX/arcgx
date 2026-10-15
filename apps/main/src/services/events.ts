/**
 * Eventos ao vivo.
 *
 * A MetaForge publica o **padrão recorrente** (`days` + `times` em HH:MM) e
 * uma **agenda absoluta** de ocorrências. Quem precisa de "ativo agora" com
 * contagem regressiva é o app, não a API: é daqui que sai o cálculo.
 *
 * Fazemos as duas leituras e cruzamos. O padrão serve para saber *quando* o
 * evento acontece e a agenda serve para cobrir o que o padrão não descreve.
 *
 * ## Região
 *
 * A API **não tem região**: 178 linhas idênticas para qualquer `?region=`,
 * e nenhum campo de região nos registros. A rotação é global. O seletor de
 * servidor, portanto, não filtra evento — ele muda o **fuso** em que os
 * horários são mostrados, que é a parte que de fato difere entre América do
 * Sul, América do Norte, Europa e Ásia.
 */

import { createLogger } from '@arcgx/shared';

const log = createLogger('events');

const BASE = 'https://metaforge.app/api/arc-raiders';

export interface EventTime {
  start: string;
  end: string;
}

export interface EventType {
  id: string;
  name: string;
  map: string;
  icon?: string;
  description?: string;
  /** 0 = domingo. Vazio = todo dia. */
  days: number[];
  times: EventTime[];
}

export interface Occurrence {
  /** epoch ms */
  start: number;
  end: number;
  map: string;
}

export interface LiveEvent {
  id: string;
  name: string;
  map: string;
  icon?: string;
  description?: string;
  /** próxima ocorrência já resolvida em epoch ms */
  next?: Occurrence;
  /** ocorrência em curso, se houver */
  current?: Occurrence;
  /** as próximas N, para a lista "upcoming instances" */
  upcoming: Occurrence[];
}

export interface EventsSnapshot {
  tipos: EventType[];
  /** por tipo de evento */
  aoVivo: LiveEvent[];
  /** contagem de revisão: quando o app leu a fonte */
  fetchedAt: number;
  ok: boolean;
  erro?: string;
}

function hhmm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return ((h || 0) * 60 + (m || 0)) * 60_000;
}

/**
 * Resolve as ocorrências de um padrão recorrente a partir de `agora`.
 *
 * `times` pode cruzar a meia-noite (`23:00 → 00:00`), e `days` vazio vale
 * todo dia. Ambos os casos aparecem na fonte.
 */
function resolver(
  ev: EventType,
  agenda: Occurrence[],
  agora: number,
  limite = 8,
): { current?: Occurrence; upcoming: Occurrence[] } {
  const diaAgora = new Date(agora).getDay();
  const msDia = 86_400_000;

  const geradas: Occurrence[] = [];
  for (let d = -1; d <= 14; d++) {
    const base = new Date(agora + d * msDia);
    base.setHours(0, 0, 0, 0);
    if (ev.days.length && !ev.days.includes(base.getDay())) continue;

    for (const t of ev.times) {
      const ini = hhmm(t.start);
      const fimBruto = hhmm(t.end);
      // janela que vira o dia seguinte
      const dura = fimBruto > ini ? fimBruto - ini : 24 * 60 * 60_000 - ini;
      const start = base.getTime() + ini;
      geradas.push({ start, end: start + dura, map: ev.map });
    }
  }

  // a agenda absoluta manda quando existe para aquele par evento+mapa
  const porNome = agenda.filter((o) => o.map === ev.map);
  const fonte = [...geradas, ...porNome]
    .filter((o) => Number.isFinite(o.start) && Number.isFinite(o.end))
    .sort((a, b) => a.start - b.start);

  const current = fonte.find((o) => o.start <= agora && o.end > agora);
  const upcoming = fonte.filter((o) => o.start > agora).slice(0, limite);

  return { current, upcoming };
}

export class EventsService {
  private timer: NodeJS.Timeout | null = null;
  private snapshot: EventsSnapshot = {
    tipos: [],
    aoVivo: [],
    fetchedAt: 0,
    ok: false,
  };
  private emVoo = false;

  constructor(private readonly aoMudar: (s: EventsSnapshot) => void) {}

  start(): void {
    if (this.timer) return;
    void this.buscar();
    // 2 min: a janela de evento é de 1 h, então 2 min dá margem de sobra sem
    // martelar a API. A contagem regressiva é calculada no renderer.
    this.timer = setInterval(() => void this.buscar(), 120_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get(): EventsSnapshot {
    return this.snapshot;
  }

  async buscar(): Promise<EventsSnapshot> {
    if (this.emVoo) return this.snapshot;
    this.emVoo = true;
    try {
      const [tipos, agenda] = await Promise.all([fetchTipos(), fetchAgenda()]);
      const agora = Date.now();

      const aoVivo: LiveEvent[] = tipos.map((ev) => {
        const r = resolver(ev, agenda, agora);
        return {
          id: ev.id,
          name: ev.name,
          map: ev.map,
          icon: ev.icon,
          description: ev.description || undefined,
          current: r.current,
          next: r.current ?? r.upcoming[0],
          upcoming: r.upcoming,
        };
      });

      this.snapshot = { tipos, aoVivo, fetchedAt: agora, ok: true };
      this.aoMudar(this.snapshot);
      return this.snapshot;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('agenda indisponível', msg);
      this.snapshot = { ...this.snapshot, ok: false, erro: msg };
      this.aoMudar(this.snapshot);
      return this.snapshot;
    } finally {
      this.emVoo = false;
    }
  }
}

async function fetchTipos(): Promise<EventType[]> {
  const r = await fetch(`${BASE}/event-timers`);
  if (!r.ok) throw new Error(`event-timers HTTP ${r.status}`);
  const j = (await r.json()) as { data?: Record<string, unknown>[] };
  const rows = j.data ?? [];
  return rows.map((e, i) => ({
    id: String(e.name ?? `evento-${i}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-'),
    name: String(e.name ?? `Evento ${i}`),
    map: String(e.map ?? '—'),
    icon: e.icon ? String(e.icon) : undefined,
    description: e.description ? String(e.description) : undefined,
    days: Array.isArray(e.days) ? (e.days as number[]) : [],
    times: Array.isArray(e.times) ? (e.times as EventTime[]) : [],
  }));
}

async function fetchAgenda(): Promise<Occurrence[]> {
  const r = await fetch(`${BASE}/events-schedule`);
  if (!r.ok) return [];
  const j = await r.json();
  const rows: Record<string, unknown>[] = Array.isArray(j) ? j : ((j.data ?? []) as Record<string, unknown>[]);
  return rows
    .map((e) => ({
      map: String(e.map ?? ''),
      start: Number(e.startTime),
      end: Number(e.endTime),
    }))
    .filter((o) => Number.isFinite(o.start) && Number.isFinite(o.end));
}
