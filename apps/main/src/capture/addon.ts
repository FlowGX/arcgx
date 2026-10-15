import { createRequire } from 'node:module';

import { Paths, createLogger } from '@arcgx/shared';

const log = createLogger('addon-loader');
const requireCjs = createRequire(import.meta.url);

export interface FrameInfo {
  width: number;
  height: number;
  /** Bytes por pixel do frame (BGRA = 4). */
  stride: number;
  /** Cópia do frame — snapshot, não uma visão da GPU. */
  data: Uint8Array;
  /** ms desde epoch. */
  timestamp: number;
  source: string;
  hwnd?: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowInfo {
  hwnd: number;
  title: string;
  rect?: Rect;
  pid: number;
}

export interface CaptureStats {
  frames: number;
  dropped: number;
  lastWidth: number;
  lastHeight: number;
  lastError?: string;
  fps: number;
  vramMb: number;
}

export interface CaptureSupport {
  windowsGraphicsCapture: boolean;
  d3d11?: boolean;
  reason?: string;
}

/**
 * Remove caracteres de largura zero e normaliza espaços.
 *
 * O ARC Raiders embaralha o título da janela com esses caracteres:
 * `"A\u200bR\u200bC\u200b Ra\u200bi\u200bd\u200be\u200br\u200bs"`. Qualquer
 * comparação por título, mesmo com regex e flag `i`, nunca casa — e o
 * filtro do app silenciosamente não acha o jogo.
 */
export function normalizeTitle(title: string): string {
  return title
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Superfície do addon @arcgx/wgc-capture (Rust / N-API).
 *
 * Espelha `packages/native/wgc-capture/index.d.ts`, gerado pelo build. A
 * captura é PULL: `startCapture` só liga a sessão e `pollFrame()` devolve o
 * frame mais recente, ou `null` se não chegou nada novo.
 */
export interface WgcCaptureAddon {
  captureSupport(): CaptureSupport;
  lastD3DError(): string;

  startCapture(hwnd: number): void;
  stopCapture(): void;
  isRunning(): boolean;
  pollFrame(): FrameInfo | null;
  stats(): CaptureStats;

  listWindows(): WindowInfo[];
  isWindow(hwnd: number): boolean;
  windowTitle(hwnd: number): string;
  targetWindowRect(hwnd: number): Rect | null;
  targetClientRect(hwnd: number): Rect | null;
  isTargetForeground(hwnd: number): boolean;
  windowHasForeground(hwnd: number): boolean;
  focusGameWindow(hwnd: number): void;
  /**
   * Veredito sobre a janela, com motivo. Opcional porque vem de JS puro em
   * `processos.cjs`; um addon antigo sem isso nao deve derrubar a captura —
   * mas sem ele a checagem por processo simplesmente nao acontece, e o log
   * precisa dizer isso.
   */
  descreverProcesso?(w: { hwnd: number; pid: number; rect?: Rect | null }): {
    nome: string;
    ehJogo: boolean;
    motivo: string | null;
  };
}

/**
 * Carrega um addon N-API tolerante à ausência: em dev o `.node` pode não estar
 * compilado ainda, e num PC sem GPU o addon pode recusar carregar.
 */
export function loadAddon<T>(name: 'wgc-capture' | 'cell-vision'): T | null {
  for (const candidate of Paths.nativePackageCandidates(name)) {
    try {
      const mod = requireCjs(candidate);
      if (mod && typeof mod === 'object') {
        log.info(`${name} carregado de ${candidate}`);
        return mod as T;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (process.env[`ARC_${name.replace('-', '_').toUpperCase()}_ADDON`]) {
        log.error(`${name}: override explícito falhou (${candidate}): ${msg}`);
        return null;
      }
      log.debug(`${name}: ${candidate} -> ${msg}`);
    }
  }
  log.warn(`${name} indisponível`);
  return null;
}