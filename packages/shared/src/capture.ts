/**
 * Tipos de captura e visão computacional.
 *
 * Vivem no `shared` porque os dois lados precisam concordar: o `main` produz,
 * o renderer consome. `GameWindow` morava em `apps/main/src/capture/manager.ts`,
 * o que significava que o renderer não tinha como tipar a lista de janelas — e
 * a lista de janelas era justamente o que faltava existir.
 */

import type { Rect } from './types.js';

/** Janela visível, com o título já limpo. */
export interface GameWindow {
  hwnd: number;
  pid: number;
  /** Título cru, com os caracteres de largura zero que o jogo injeta. */
  title: string;
  /** Título sem os caracteres de largura zero — é o que dá para comparar. */
  cleanTitle: string;
  rect: Rect | null;
}

export interface CaptureStartResult {
  ok: boolean;
  /** Mensagem do addon quando a recusa vem da captura, não do chamador. */
  error: string | null;
  hwnd?: number;
  title?: string | null;
}

// A função `captureHint` mora no renderer, e não aqui. Exportar código
// executável pelo barrel do `shared` arrasta `logger.ts`, que usa
// `mkdirSync` — e o bundle do navegador morre no `vite build`. Este módulo
// é só de tipos, de propósito.
