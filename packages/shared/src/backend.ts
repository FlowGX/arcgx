import { createLogger } from './logger.js';
import type {
  CorrectionField,
  CorrectionReport,
  DataPatch,
  Entitlement,
  SubmitResult,
} from './backend-schema.js';

const log = createLogger('backend');

export interface BackendOptions {
  /** Ex.: https://arcgx-data.<sub>.workers.dev */
  baseUrl: string;
  /** Identificador estável da instalação (uuid salvo no userData). */
  installId: string;
  appVersion?: string;
  build?: string;
  timeoutMs?: number;
}

/**
 * Cliente do backend de dados.
 *
 * Falha de rede nunca pode derrubar o app: o tracker precisa funcionar offline
 * e o patch só melhora o que já está na semente. Então tudo aqui tem timeout
 * curto, e o estado fica cacheado em disco.
 */
export class BackendClient {
  private lastVersion: string | null = null;
  private online = false;

  constructor(private readonly options: BackendOptions) {}

  get isOnline(): boolean {
    return this.online;
  }

  get syncCursor(): string | null {
    return this.lastVersion;
  }

  setSyncCursor(version: string | null): void {
    this.lastVersion = version;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8000);

    try {
      const res = await fetch(`${this.options.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-arcgx-install': this.options.installId,
          'user-agent': `ArcGX/${this.options.appVersion ?? '0.1.0'}`,
          ...init.headers,
        },
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        log.warn(`${init.method ?? 'GET'} ${path} -> ${res.status} ${body.error ?? ''}`);
        return null;
      }

      this.online = true;
      return (await res.json()) as T;
    } catch (err) {
      this.online = false;
      log.debug(`${init.method ?? 'GET'} ${path} falhou:`, err instanceof Error ? err.message : err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<{ ok: boolean; corrections: number; time: string } | null> {
    return this.request('/v1/health');
  }

  /** Patch incremental. `since` = cursor da última aplicação. */
  async patch(since?: string | null): Promise<DataPatch | null> {
    const q = since ? `?since=${encodeURIComponent(since)}` : '';
    const patch = await this.request<DataPatch>(`/v1/patch${q}`);
    if (patch?.version) this.lastVersion = patch.version;
    return patch;
  }

  async submit(report: CorrectionReport): Promise<SubmitResult | null> {
    return this.request<SubmitResult>(`/v1/items/${encodeURIComponent(report.itemId)}`, {
      method: 'POST',
      body: JSON.stringify({
        field: report.field,
        value: report.value,
        locale: report.locale,
        note: report.note,
      }),
    });
  }

  async redeem(code: string): Promise<{ ok: boolean; tier?: string; expiresAt?: string | null } | null> {
    return this.request('/v1/entitlement/redeem', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async entitlement(): Promise<Entitlement | null> {
    return this.request<Entitlement>(`/v1/entitlement?install=${encodeURIComponent(this.options.installId)}`);
  }
}

/**
 * Aplica um patch sobre a semente local.
 *
 * Regra: correção da comunidade **sobrescreve** a semente quando tem
 * `weight >= 1` e o valor é diferente — o patch é mais recente por definição.
 * Para item inexistente na semente, cria a entrada.
 */
export function applyPatch<T extends Record<string, unknown>>(
  seed: T,
  patch: DataPatch,
  /** campo do backend -> chave no objeto local. ex.: { tier: 'rarity' } */
  fields: Record<string, string>,
): { changed: number; unknownItems: string[] } {
  let changed = 0;
  const unknownItems: string[] = [];

  for (const [itemId, byField] of Object.entries(patch.items ?? {})) {
    const target = seed[itemId];

    for (const [field, byLocale] of Object.entries(byField)) {
      const key = fields[field];
      if (!key) continue;
      const forLocale = byLocale[Object.keys(byLocale)[0] ?? ''];
      if (!forLocale) continue;

      if (!target) {
        unknownItems.push(itemId);
        continue;
      }

      const row = target as Record<string, unknown>;
      const numeric = field === 'value';
      const next = numeric ? Number(forLocale.value) : forLocale.value;
      if (row[key] !== next) {
        row[key] = next;
        changed++;
      }
    }
  }

  return { changed, unknownItems };
}