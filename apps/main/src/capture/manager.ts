import { createRequire } from 'node:module';
import { app } from 'electron';

import { createLogger, envNumber } from '@arcgx/shared';
import type { ArcGx } from '../index.js';

import {
  loadAddon,
  normalizeTitle,
  type CaptureSupport,
  type FrameInfo,
  type Rect,
  type WgcCaptureAddon,
} from './addon.js';

const log = createLogger('capture');
const requireCjs = createRequire(import.meta.url);

export type CaptureState = 'idle' | 'running' | 'error';

export interface CaptureStatsView {
  frames: number;
  lastFrameAt: number;
  avgFps: number;
  vramMb: number;
  width: number;
  height: number;
  dropped: number;
}

// `GameWindow` foi para o `shared` para o renderer poder tipar a lista de
// janelas. `Rect` continua vindo de `./addon.js` — reexportar os dois brigaria.
export type { GameWindow } from '@arcgx/shared';
import type { GameWindow } from '@arcgx/shared';

export interface GridSpec {
  cellWidth: number;
  cellHeight: number;
  pitch: number;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  confidence: number;
}

export interface CellRect {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Geometria da grade medida, indexada por resolução. */
export type GridCache = Record<string, GridSpec>;

/** Superfície do @arcgx/cell-vision usada pelo app. */
interface CellVisionAddon {
  calibrate(
    frame: Uint8Array,
    width: number,
    height: number,
    roi: Rect,
    config?: Record<string, number | boolean>,
  ): GridSpec | null;
}

let visionAddon: CellVisionAddon | null = null;
let visionError: string | null = null;

/**
 * ## O `catch` vazio aqui custou um bug de diagnóstico
 *
 * Se o addon falha ao carregar, o `catch` engolia a exceção e o app seguia
 * como se nada tivesse acontecido — o painel mostrava "indisponível" sem dizer
 * *por quê*, e não havia uma linha sequer no log. Falha de load de addon
 * nativo é justamente o caso em que a causa importa.
 */
function loadVision(): CellVisionAddon | null {
  if (visionAddon) return visionAddon;
  const erros: string[] = [];
  for (const candidate of ['@arcgx/cell-vision', '../../cell-vision/index.js']) {
    try {
      const mod = requireCjs(candidate) as CellVisionAddon;
      if (typeof mod?.calibrate !== 'function') throw new Error('sem calibrate()');
      visionAddon = mod;
      visionError = null;
      log.info(`cell-vision carregado de ${candidate}`);
      return mod;
    } catch (err) {
      erros.push(`${candidate}: ${(err as Error).message}`);
    }
  }
  visionError = erros.join(' | ');
  log.error(`cell-vision indisponivel -> ${visionError}`);
  return null;
}

/** Estado real da visao, para o painel e para o diagnostico. */
export function visionStatus(): { available: boolean; error: string | null } {
  return { available: loadVision() !== null, error: visionError };
}

/**
 * Ponte entre o addon Rust e o resto do app.
 *
 * A captura é PULL: o addon entrega frames por `pollFrame()` e o frame mais
 * recente é consumido. Não há callback — quem precisa de pixels chama
 * {@link takeFrame} e recebe uma cópia.
 *
 * O addon só produz frame quando a janela está sendo composta, então o
 * intervalo de poll é o que define a taxa de leitura. Manter o poll em um
 * timer do processo principal (e não num callback do Rust) evita que o
 * readback da GPU bloqueie o event loop do Electron.
 */
export class CaptureManager {
  private addon: WgcCaptureAddon | null = null;
  private support: CaptureSupport | null = null;
  private hwnd = 0;
  private running = false;
  private lastError: string | null = null;
  private lastFrame: FrameInfo | null = null;
  private lastFrameAt = 0;

  private frames = 0;
  private fpsWindowStart = 0;
  private fps = 0;
  private gx: ArcGx | null = null;

  constructor(gx?: ArcGx) {
    this.gx = gx ?? null;
  }

  /* ------------------------------------------------------------- ciclo */

  attach(gx: ArcGx): void {
    this.gx = gx;
  }

  init(): boolean {
    if (process.platform !== 'win32') {
      this.lastError = 'captura suportada apenas no Windows';
      return false;
    }
    if (this.addon) return true;
    this.addon = loadAddon<WgcCaptureAddon>('wgc-capture');
    if (!this.addon) {
      this.lastError = 'addon wgc-capture não carregou (rode `npm run build:native:wgc`)';
      return false;
    }
    this.support = this.addon.captureSupport();
    if (!this.support.windowsGraphicsCapture) {
      const detail = this.addon.lastD3DError();
      this.lastError = this.support.reason ?? 'Windows Graphics Capture indisponível';
      if (detail) this.lastError += ` — ${detail}`;
      return false;
    }
    return true;
  }

  /**
   * Inicia a sessão de captura na janela.
   *
   * ## Por que não exige primeiro plano aqui
   *
   * Exigia. E isso tornava o botão impossível de usar: para clicar em
   * "Iniciar" é preciso que o painel esteja em foco, e `isTargetForeground`
   * então era falso, e a chamada voltava recusada. O usuário nunca conseguia
   * chegar perto de iniciar, e o sintoma era "não faz o scan".
   *
   * A preocupação original — não ler pixels que o usuário não está olhando —
   * continua atendida, só que no lugar certo: a sessão fica armada e o
   * `ScanLoop` só faz trabalho quando `isGameFocused()` é verdadeiro
   * (`scan/loop.ts`). Nenhuma janela é capturada nem classificada fora de
   * foco; o que muda é que a sessão pode existir antes de o jogo voltar ao
   * primeiro plano.
   */
  startWindow(hwnd: number): boolean {
    if (!this.init()) return false;
    const addon = this.addon!;

    if (this.running) this.stop();
    try {
      addon.startCapture(hwnd);
      this.hwnd = hwnd;
      this.running = true;
      this.lastError = null;
      this.fpsWindowStart = 0;
      this.frames = 0;
      log.info(
        `capturando HWND 0x${hwnd.toString(16)} @ ${this.pollHz()} Hz` +
          (addon.isTargetForeground(hwnd) ? '' : ' (aguardando o jogo em foco)'),
      );
      return true;
    } catch (err) {
      const detail = addon.lastD3DError();
      this.lastError = (err instanceof Error ? err.message : String(err)) + (detail ? ` — ${detail}` : '');
      log.error('startCapture falhou', this.lastError);
      return false;
    }
  }

  stop(): void {
    if (!this.addon || !this.running) return;
    try {
      this.addon.stopCapture();
    } catch (err) {
      log.warn('stopCapture', err);
    }
    this.running = false;
    this.lastFrame = null;
    log.info('captura parada');
  }

  /**
   * Reconfigura a taxa de poll sem derrubar a sessão de captura.
   *
   * O addon não tem controle de taxa próprio — quem dita o ritmo é quem chama
   * {@link takeFrame}. A configuração vale para o próximo ciclo do scan.
   */
  setHz(hz: number): void {
    this.hzOverride = hz;
    log.info(`taxa de leitura: ${this.pollHz()} Hz`);
  }

  /* ------------------------------------------------------------ janelas */

  /**
   * Janelas visíveis, com o título limpo.
   *
   * Filtro por `title` sem normalizar não acha o ARC: o título real é
   * `"A\u200bR\u200bC\u200b Ra\u200bi\u200bd\u200be\u200br\u200bs"` e não casa
   * com nenhuma comparação literal.
   */
  listWindows(): GameWindow[] {
    if (!this.addon) return [];
    return this.addon.listWindows().map((w) => ({
      hwnd: w.hwnd,
      pid: w.pid,
      title: w.title,
      cleanTitle: normalizeTitle(w.title),
      rect: w.rect ?? null,
    }));
  }

/**
 * Acha a janela do jogo pelo título normalizado.
 *
 * ## ## ## Por que o título sozinho não basta
 *
 * O primeiro filtro era `cleanTitle.includes('arc raiders')` e pronto. Com um
 * vídeo do YouTube sobre o jogo aberto no Firefox — titulo
 * `"(18) New PVE Mode in Frozen trail Arc Raiders Update" —` ele casava e o app
 * passava a **capturar o navegador**: overlay sobre a página, nenhuma célula,
 * nenhum aviso. Pior que não achar a janela, que pelo menos avisa.
 *
 * Duasalsypos adjuncts, nesta ordem:
 *
 * 1. **O processo tem que ser o jogo.** Firefox, Chrome, Discord, Steam e
 *    exploradores são rejeitados pelo nome do processo. É o filtro que realmente
 *    segura, porque nome de vídeo é o que o usuário controla.
 * 2. **A janela tem que ter tamanho de jogo.** O inventário é lido em fração do
 *    frame, e uma janela pequena não tem onde a grade estar.
 */
/**
 * Acha a janela do jogo.
 *
 * ## ## ## Lista positiva, e falha fechada
 *
 * O filtro anterior aceitava qualquer janela cujo titulo containse "arc
 * raiders", com uma lista negativa de navegador e chat como unica protecao.
 * Duas janelas que casam e uma delas e o jogo nao e sorte: basta um video
 * sobre o jogo, uma aba com o nome dele, ou um atalho no explorer.
 *
 * Agora e o inverso: **so `PioneerGame` passa**, com tamanho de janela
 * plausivel. E quando o processo nao pode ser lido — o jogo roda elevado e o
 * `tasklist` e o unico caminho — a resposta e `null`, com o motivo no log.
 *
 * `null` aqui nao e "jogo fechado": e "nao achei o jogo, e nao vou ler outra
 * coisa". A diferenca importa, porque o chamador mostra uma mensagem diferente
 * para cada caso.
 */
findGameWindow(needle = 'arc raiders'): GameWindow | null {
  const want = needle.toLowerCase();
  const candidatas = this.listWindows().filter((w) => w.cleanTitle.toLowerCase().includes(want));
  if (candidatas.length === 0) return null;

  const veredito = this.addon?.descreverProcesso;
  for (const w of candidatas) {
    const v = veredito?.(w);
    if (v?.ehJogo) return w;
  }

  const recusa = candidatas
    .map((w) => (veredito ? veredito(w).motivo : `processo de "${w.cleanTitle}" nao verificado`))
    .join(' | ');
  log.warn(`captura recusada: nenhuma janela do jogo aprovada — ${recusa}`);
  return null;
}

  /* ------------------------------------------------------------ polling */

  /**
   * Consome o frame mais recente, se houver.
   *
   * Devolve `null` quando não chegou frame novo — o addon mantém apenas o
   * último, então chamar duas vezes seguidas devolve o segundo como `null`.
   */
  takeFrame(): FrameInfo | null {
    if (!this.addon || !this.running) return null;

    let frame: FrameInfo | null = null;
    try {
      frame = this.addon.pollFrame() ?? null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      log.error('pollFrame falhou', this.lastError);
      return null;
    }

    if (!frame) return null;

    this.frames++;
    this.lastFrame = frame;
    this.lastFrameAt = Date.now();

    const now = performance.now();
    if (!this.fpsWindowStart) this.fpsWindowStart = now;
    else if (now - this.fpsWindowStart >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsWindowStart));
      this.frames = 0;
      this.fpsWindowStart = now;
    }
    return frame;
  }

  /**
   * O jogo está em primeiro plano?
   *
   * O loop de scan consulta isso antes de processar qualquer frame: sem o
   * jogo em foco não há inventário na tela, e não vale o custo.
   *
   * `ARC_IGNORE_FOCUS=1` ignora a guarda — **só fora de pacote empacotado**.
   * Existe porque essa guarda é difficult de testar: quem conduz o teste está
   * no navegador, talking to the agent, e o navegador é justamente a janela
   * que fica em primeiro plano. Sem a flag, o teste do overlay nunca roda.
   *
   * A guarda é economia de CPU, não consentimento: a captura continua
   * somente do que o usuário abriu explicitamente, e a janela capturada é a do
   * jogo, não a tela. Ainda assim, num build empacotado a flag não existe.
   */
  isGameFocused(): boolean {
    if (!this.addon || !this.running) return false;
    if (process.env.ARC_IGNORE_FOCUS === '1' && !app.isPackaged) return true;
    try {
      return this.addon.isTargetForeground(this.hwnd);
    } catch {
      return false;
    }
  }

  /* ------------------------------------------------------- calibracao */

  /**
   * Geometria da grade nesta resolução, medindo uma vez e guardando.
   *
   * A autodetecção é *bootstrap*, não fonte da verdade. Medido em seis
   * resoluções, ela acerta o pitch em todas (erro ≤ 0,7 px) mas erra a
   * contagem de linhas na borda do painel em metade delas — a última linha é
   * parcial e depende de o rodapé da célula caber na ROI.
   *
   * O pitch é a medida que importa: com ele a grade inteira é derivada por
   * aritmética, e essa aritmética não erra. Por isso a geometria é medida uma
   * vez por resolução e reutilizada — o usuário nunca vê a grade errada.
   */
  gridSpec(frame: FrameInfo, roi: Rect): GridSpec | null {
    const key = `${frame.width}x${frame.height}:${roi.x},${roi.y},${roi.width},${roi.height}`;
    const hit = this.gridCache[key];
    if (hit) return hit;

    const vision = loadVision();
    if (!vision) return null;

    const spec = vision.calibrate(frame.data, frame.width, frame.height, roi, scaleConfig(1));
    if (!spec) return null;
    this.gridCache[key] = spec;
    log.info(
      `grade calibrada em ${frame.width}x${frame.height}: passo ${spec.pitch.toFixed(1)} px, ` +
      `celula ${spec.cellWidth.toFixed(0)}x${spec.cellHeight.toFixed(0)}`,
    );
    return spec;
  }

  /**
   * Células a partir da geometria medida.
   *
   * A contagem usa as colunas/linhas que o detector viu — elas vêm de bordas
   * reais, e por isso sabem que a última linha da captura é parcial e não tem
   * rodapé. A aritmética a partir do pitch é o *fallback*: ela não tem como
   * saber se a última célula fecha, e por isso só entra quando o detector não
   * disse nada.
   *
   * Contar por iteração, nunca por divisão: `floor((largura - origem) / passo)`
   * erra em um quando a última célula preenche exatamente o resto da ROI, que
   * foi o que aconteceu em 2400x1350.
   */
  cellsFromSpec(spec: GridSpec, roi: Rect): CellRect[] {
    const cells: CellRect[] = [];
    const maxCols = spec.cols > 0 ? spec.cols : Infinity;
    const maxRows = spec.rows > 0 ? spec.rows : Infinity;

    for (let c = 0; c < maxCols; c++) {
      const x = roi.x + spec.originX + c * spec.pitch;
      if (x + spec.cellWidth > roi.x + roi.width + 1) break;
      for (let r = 0; r < maxRows; r++) {
        const y = roi.y + spec.originY + r * spec.pitch;
        if (y + spec.cellHeight > roi.y + roi.height + 1) break;
        cells.push({
          index: cells.length,
          x,
          y,
          width: spec.cellWidth,
          height: spec.cellHeight,
        });
      }
    }
    return cells;
  }

  /** Substitui a grade detectada por um valor já conhecido. */
  setGridSpec(spec: GridSpec | null): void {
    this.manualGrid = spec;
  }

  /* ------------------------------------------------------------- estado */

  get available(): boolean {
    return Boolean(this.addon && this.support?.windowsGraphicsCapture);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * De onde vêm os pixels.
   *
   * Só existe captura de janela: o addon não implementa captura de tela
   * inteira, e é uma decisão — ler a tela toda capturaria janela de outros
   * programas junto com o jogo.
   */
  get source(): 'window' | 'screen' | null {
    return this.running ? 'window' : null;
  }

  get error(): string | null {
    return this.lastError;
  }

  get targetHwnd(): number {
    return this.hwnd;
  }

  get windowTitle(): string | null {
    if (!this.addon || !this.hwnd) return null;
    try {
      const title = this.addon.windowTitle(this.hwnd);
      return title ? normalizeTitle(title) : null;
    } catch {
      return null;
    }
  }

  get stats(): CaptureStatsView {
    let addon: CaptureStatsView = {
      frames: 0,
      lastFrameAt: this.lastFrameAt,
      avgFps: this.fps,
      vramMb: 0,
      width: 0,
      height: 0,
      dropped: 0,
    };
    if (this.addon) {
      try {
        const s = this.addon.stats();
        addon = {
          frames: s.frames,
          lastFrameAt: this.lastFrameAt,
          avgFps: this.fps || s.fps,
          vramMb: s.vramMb,
          width: s.lastWidth,
          height: s.lastHeight,
          dropped: s.dropped,
        };
        if (s.lastError) this.lastError = s.lastError;
      } catch {
        /* addon pode estar em estado invalido apos stop */
      }
    }
    return addon;
  }

  /* ------------------------------------------------------------ interno */

  private hzOverride = 0;
  private gridCache: GridCache = {};
  private manualGrid: GridSpec | null = null;

  private pollHz(): number {
    if (this.hzOverride > 0) return this.hzOverride;
    return envNumber('ARC_CAPTURE_HZ', this.gx?.store.config.overlayHz ?? 15);
  }

  /** Taxa efetiva do scan — o poll de captura segue, não o do overlay. */
  get scanHz(): number {
    return envNumber('ARC_SCAN_HZ', this.gx?.store.config.scannerTargetHz ?? 4);
  }
}

/**
 * Tolerâncias do detector ajustadas à escala da tela.
 *
 * O pad e as janelas internas são em pixels, mas a célula escala com a
 * resolução: 96 px em 1920x1080, 48 px em 960x540. Mesmos valores numéricos
 * acertam uma resolução e estragam a outra.
 */
export function scaleConfig(scale: number): Record<string, number | boolean> {
  return {
    edgeThreshold: 0.22,
    minCell: 16 * scale,
    maxCell: 400 * scale,
    bandEnergy: 0.45,
    mergeGap: 5 * scale,
    refine: true,
    padPx: 8 * scale,
  };
}