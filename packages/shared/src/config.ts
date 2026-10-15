import type { AppConfig } from './types.js';
import { IDIOMA_PADRAO } from './i18n.js';

export const APP_ID = 'io.arcgx.app';
export const APP_NAME = 'Arc GX';

export const DEFAULT_CONFIG: AppConfig = {
  locale: 'pt-BR',
  overlayVisible: true,
  badgesEnabled: true,
  badgeOpacity: 0.95,
  showPrices: true,
  showSatisfied: true,
  itemCardEnabled: true,
  noticesEnabled: true,
  scannerTargetHz: 4,
  overlayHz: 15,
  scannerMemory: 'balanced',
  /**
   * Captura da janela do jogo fica DESLIGADA por padrao.
   *
   * Motivo: ARC Raiders roda Easy Anti-Cheat, Denuvo Anti-Cheat e Anybrain
   * (ML de telemetria de input). Ligar a captura e uma decricao consciente
   * do usuario, nunca um default. Ver docs/ANTICHEAT.md.
   */
  scannerCaptureEnabled: false,
  scannerDebugView: false,
  ocrEnabled: true,
  ocrEngine: 'auto',
  ocrLanguage: null,
  panelHotkey: 'Alt+X',
  overlayHotkey: 'Alt+Shift+X',
  /**
   * Abre o prompt de identificação do item sob o cursor.
   *
   * Existe como atalho porque o prompt **não pode abrir sozinho**: ele precisa
   * de foco de teclado para o input, e roubar o foco no meio de uma raid
   * tira o controle do jogador. O overlay e click-through, então o gatilho
   * tem de vir de fora dele.
   */
  identifyHotkey: 'Alt+Shift+Q',
  minimizeToTray: true,
  updateFeedUrl: '',
  windowBounds: null,
};

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;

/**
 * Normaliza a URL do feed de atualizacao.
 *
 * Aceita a URL colada pelo usuario em qualquer forma (`https://x/y`,
 * `https://x/y/`) e devolve sempre com barra final. Vazio devolve vazio, que
 * significa "usa o `app-update.yml` embutido no pacote".
 *
 * `http` e recusado de proposito: sem TLS nao ha integridade do `latest.yml`,
 * e um espelho interceptado dictate qual versao o app instala.
 */
export function normalizeFeedUrl(v: unknown): string {
  const raw = typeof v === 'string' ? v.trim() : '';
  if (!raw) return '';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return '';
  }
  if (u.protocol !== 'https:') return '';
  const path = u.pathname.endsWith('/') ? u.pathname : u.pathname + '/';
  return `${u.origin}${path}`;
}

export function sanitizeConfig(input: unknown): AppConfig {
  const raw = (input ?? {}) as Partial<AppConfig>;
  const cfg: AppConfig = { ...DEFAULT_CONFIG };

  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]) {
    if (raw[key] !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cfg as any)[key] = raw[key];
    }
  }

  cfg.badgeOpacity = clamp(Number(cfg.badgeOpacity), 0, 1);
  cfg.scannerTargetHz = clamp(Number(cfg.scannerTargetHz), 0.5, 30);
  cfg.overlayHz = clamp(Number(cfg.overlayHz), 1, 60);
  cfg.ocrEngine = ['auto', 'paddle', 'windows'].includes(cfg.ocrEngine) ? cfg.ocrEngine : 'auto';
  cfg.scannerMemory = ['fast', 'balanced', 'low'].includes(cfg.scannerMemory) ? cfg.scannerMemory : 'balanced';

  /**
   * A tabela de tradução só tem `pt-BR` e `en`.
   *
   * ## ## ## Por que normalizar em vez de só usar no `select`
   *
   * O select de idioma já teve uma opção `es` que não existia na tabela —
   * quem salvasse nela ficaria com `locale: 'es'` no disco para sempre, e o
   * `<select>` passaria a exibir **nada**, porque nenhum `<option>` casaria.
   *
   * Normalizar na entrada conserta o config já gravado, não só o novo.
   */
  cfg.locale = cfg.locale === 'en' ? 'en' : IDIOMA_PADRAO;

  /**
   * Feed de atualizacao.
   *
   * ## ## ## Por que normalizar aqui
   *
   * `feedUrl` no main le este campo e cai no `app-update.yml` embutido quando
   * vazio. Sem normalizar, um valor colado sem barra final faz o `latest.yml`
   * ser procurado em `.../releaseslatest.yml` e o updater falhar com 404 sem
   * mensagem util.
   */
  cfg.updateFeedUrl = normalizeFeedUrl(cfg.updateFeedUrl);


  return cfg;
}

export function envFlag(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

export function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function envString(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}