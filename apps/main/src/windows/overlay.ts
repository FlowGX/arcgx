import { BrowserWindow, globalShortcut } from 'electron';

import { OverlayChannel, createLogger } from '@arcgx/shared';
import { preloadPath, rendererIndex } from '../resolve.js';
import type { ArcGx } from '../index.js';

const log = createLogger('window:overlay');

/**
 * HUD: janela transparente, sempre no topo, sem foco e "click-through".
 * A interação (clique em item, abrir busca) é feita explicitamente pelo
 * rendererasking `set-interactive(true)` — assim ela nunca rouba o foco do jogo.
 */
export class OverlayWindow {
  private win: BrowserWindow | null = null;
  private interactive = false;

  constructor(private readonly gx: ArcGx) {}

  get window(): BrowserWindow | null {
    return this.win;
  }

  async create(): Promise<void> {
    this.win = new BrowserWindow({
      width: 1920,
      height: 1080,
      x: 0,
      y: 0,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      focusable: false,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    // acima do fullscreen; o overlay nunca deve roubar o foco do jogo
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.setIgnoreMouseEvents(true, { forward: true });

    const devUrl = process.env.ARC_OVERLAY_DEV_URL;
    if (devUrl) await this.win.loadURL(devUrl);
    else await this.win.loadFile(rendererIndex('overlay'));

    this.win.once('ready-to-show', () => this.applyVisibility());
    this.win.on('blur', () => this.setInteractive(false));
  }

  bindHotkeys(): void {
    globalShortcut.register(this.gx.store.config.overlayHotkey, () => {
      this.setVisible(!this.isVisible());
    });

    /**
     * Abre o prompt de nomear item.
     *
     * ## ## ## Por que um atalho e nao um hover
     *
     * O HUD e click-through, entao nao recebe teclado, e o prompt precisa de
     * foco para o input. Ligar um hover nele resolve o primeiro problema
     * creando um pior: `setIgnoreMouseEvents(false)` desativa o click-through
     * da janela inteira, e o HUD esta em cima dos slots — o jogador passava o
     * mouse sobre um item, o overlay "acordava", e o clique seguinte ia para
     * a badge em vez de para o item.
     *
     * O atalho e acionado de fora, nao rouba foco por acidente, e e o mesmo
     * modelo que o overlay do ARC Tracker usa: la nao existe um unico
     * `pointer-events` no bundle inteiro.
     */
    globalShortcut.register(this.gx.store.config.identifyHotkey, () => {
      this.broadcast(OverlayChannel.IDENTIFY);
    });
  }

  isVisible(): boolean {
    return Boolean(this.win && this.win.isVisible());
  }

  setVisible(visible: boolean): void {
    const cfg = this.gx.store.config;
    if (cfg.overlayVisible !== visible) {
      void this.gx.store.patch({ overlayVisible: visible });
    }
    this.applyVisibility();
  }

  private applyVisibility(): void {
    if (!this.win) return;
    if (this.gx.store.config.overlayVisible) this.win.showInactive();
    else this.win.hide();
  }

  setInteractive(interactive: boolean): void {
    if (!this.win || this.interactive === interactive) return;
    this.interactive = interactive;
    this.win.setIgnoreMouseEvents(!interactive, { forward: true });
    this.win.setFocusable(interactive);
    log.debug(`interativo=${interactive}`);
  }

  broadcast(channel: string, payload?: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  onReady(cb: () => void): void {
    if (!this.win) return;
    if (this.win.webContents.isLoading()) this.win.webContents.once('did-finish-load', cb);
    else cb();
  }
}