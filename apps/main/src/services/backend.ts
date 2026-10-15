import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  BackendClient,
  Paths,
  applyPatch,
  createLogger,
  featuresFor,
  type Correction,
  type CorrectionReport,
  type DataPatch,
  type Entitlement,
  type PremiumFeatures,
  type SubmitResult,
  type UnknownSignal,
} from '@arcgx/shared';

const log = createLogger('backend');

/**
 * Mapeia o campo do backend para o campo do schema de item.
 *
 * O backend só conhece campos neutros (name/value/tier/type/description); quem
 * sabe que "tier" mora em `rarity` e "type" em `category` é o app.
 */
const FIELD_MAP = {
  name: 'name',
  value: 'baseValue',
  tier: 'tier',
  type: 'category',
  description: 'description',
} as const;

interface Persisted {
  installId: string;
  syncCursor: string | null;
  entitlement: Entitlement;
  pending: CorrectionReport[];
  /** correcoes aceitas localmente mas ainda nao publicadas */
  local: Record<string, Record<string, string>>;
}

const DEFAULTS: Persisted = {
  installId: '',
  syncCursor: null,
  entitlement: { tier: 'free', expiresAt: null },
  pending: [],
  local: {},
};

/**
 * Cola entre a semente (data-release) e o patch da comunidade.
 *
 * Regras que valem para todo o fluxo:
 *  - o app funciona offline; patch é melhoria, nunca requisito
 *  - nada é sobrescrito sem que o usuário tenha visto antes
 *  - toda correção enviada fica na fila até o backend confirmar
 */
export class BackendService {
  private state: Persisted = { ...DEFAULTS };
  private client: BackendClient | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly baseUrl: string) {}

  get features(): PremiumFeatures {
    return featuresFor(this.state.entitlement.tier);
  }

  get entitlement(): Entitlement {
    return this.state.entitlement;
  }

  get isOnline(): boolean {
    return this.client?.isOnline ?? false;
  }

  get pendingCount(): number {
    return this.state.pending.length;
  }

  get localCorrections(): Record<string, Record<string, string>> {
    return this.state.local;
  }

  pendingView(): CorrectionReport[] {
    return [...this.state.pending];
  }

  load(): void {
    const file = path.join(Paths.userData, 'backend-state.json');
    try {
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Persisted>;
        this.state = { ...DEFAULTS, ...raw };
      }
    } catch (err) {
      log.warn('estado do backend ilegível, recomeçando', err);
      this.state = { ...DEFAULTS };
    }

    if (!this.state.installId) {
      this.state.installId = randomUUID();
      log.info(`instalação identificada: ${this.state.installId.slice(0, 8)}…`);
    }

    this.client = new BackendClient({
      baseUrl: this.baseUrl,
      installId: this.state.installId,
      appVersion: this.appVersion,
    });
    this.client.setSyncCursor(this.state.syncCursor);
    this.save();
  }

  private appVersion = '0.1.0';

  setAppVersion(v: string): void {
    this.appVersion = v;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private save(): void {
    try {
      writeFileSync(path.join(Paths.userData, 'backend-state.json'), JSON.stringify(this.state), 'utf8');
    } catch (err) {
      log.error('não consegui salvar o estado do backend', err);
    }
    for (const cb of this.listeners) cb();
  }

  /* ------------------------------------------------------------- sync */

  /**
   * Busca as correcoes da comunidade.
   *
   * Retorna as correcoes que o renderer precisa aplicar na base local; quem
   * decide o que fazer com elas é a camada de dados.
   */
  async sync(): Promise<DataPatch | null> {
    if (!this.client) return null;
    const patch = await this.client.patch(this.state.syncCursor);
    if (!patch) {
      log.debug('sem patch (offline ou sem novidades)');
      return null;
    }
    this.state.syncCursor = patch.version;
    this.save();
    log.info(`patch aplicado: ${patch.count} correções desde o cursor`);
    return patch;
  }

  /** Aplica o patch sobre um mapa de itens e devolve o resumo. */
  applyTo<T extends Record<string, unknown>>(
    items: T,
    patch: DataPatch,
  ): { changed: number; unknownItems: string[] } {
    return applyPatch(items, patch, FIELD_MAP);
  }

  /* -------------------------------------------------------- correcoes */

  /**
   * Envia uma correção.
   *
   * Aplica localmente na hora (o usuário não espera round-trip) e enfileira
   * para o backend. Se a cota do dia estourar, fica na fila para depois.
   */
  async correct(report: CorrectionReport): Promise<SubmitResult> {
    const key = `${report.locale}:${report.field}`;
    (this.state.local[report.itemId] ??= {})[key] = report.value;
    this.save();

    if (this.state.pending.length >= this.features.dailySubmissionQuota) {
      this.state.pending.push(report);
      this.save();
      return {
        ok: false,
        status: 'pending',
        message: `cota do dia atingida (${this.features.dailySubmissionQuota}); na fila para amanhã`,
      };
    }

    if (!this.client) {
      this.state.pending.push(report);
      this.save();
      return { ok: false, status: 'pending', message: 'sem conexão; correção salva na fila' };
    }

    const res = await this.client.submit(report);
    if (!res) {
      this.state.pending.push(report);
      this.save();
      return { ok: false, status: 'pending', message: 'servidor fora do ar; correção salva na fila' };
    }

    log.info(`correção ${report.itemId}.${report.field} -> ${res.status}`);
    return res;
  }

  /** Reenvia o que ficou na fila. Chamar no boot e ao voltar o sinal de rede. */
  async flush(): Promise<number> {
    if (!this.client || this.state.pending.length === 0) return 0;
    const queue = [...this.state.pending];
    let sent = 0;

    for (const report of queue) {
      const res = await this.client.submit(report);
      if (!res) break; // ainda offline: preserva a ordem
      this.state.pending = this.state.pending.filter((r) => r !== report);
      sent++;
    }

    if (sent) {
      this.save();
      log.info(`${sent} correções enviadas da fila`);
    }
    return sent;
  }

  /* --------------------------------------------------------- premium */

  async redeem(code: string): Promise<{ ok: boolean; message: string }> {
    if (!this.client) return { ok: false, message: 'sem conexão' };
    const res = await this.client.redeem(code.trim());
    if (!res?.ok) return { ok: false, message: 'código inválido, usado ou expirado' };

    await this.refreshEntitlement();
    return { ok: true, message: 'premium ativado' };
  }

  async refreshEntitlement(): Promise<Entitlement> {
    const res = await this.client?.entitlement();
    if (res) {
      this.state.entitlement = res;
      this.save();
      log.info(`plano: ${res.tier}`);
    }
    return this.state.entitlement;
  }

  /* ----------------------------------------------------- sinais locais */

  /**
   * Item que o classificador não reconheceu.
   *
   * Guardamos localmente para agrupar: 5 linhas do mesmo ícone viram um report
   * só, em vez de inundar o backend.
   */
  recordUnknown(signal: UnknownSignal): Correction | null {
    return {
      itemId: `unknown_${signal.iconHash.slice(0, 12)}`,
      field: 'name',
      value: '',
      locale: 'en',
      fromCommunity: false,
    };
  }
}