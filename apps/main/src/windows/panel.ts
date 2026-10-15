import { BrowserWindow, app, globalShortcut, shell } from 'electron';

import { createLogger } from '@arcgx/shared';
import { preloadPath, rendererIndex } from '../resolve.js';
import type { ArcGx } from '../index.js';

const log = createLogger('window:panel');

export class PanelWindow {
  private win: BrowserWindow | null = null;
  /** true a partir do momento em que o fechamento passa a ser saída real */
  private saindo = false;

  constructor(private readonly gx: ArcGx) {}

  get window(): BrowserWindow | null {
    return this.win;
  }

  async create(): Promise<void> {
    const bounds = this.gx.store.config.windowBounds;
    this.win = new BrowserWindow({
      width: bounds?.width ?? 1180,
      height: bounds?.height ?? 760,
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 960,
      minHeight: 620,
      show: false,
      backgroundColor: '#0d0b09',
      title: 'Arc GX',
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      },
    });

    /**
     * `ready-to-show` precisa ser ouvido ANTES do load, e_show() precisa
     * happen depois dele.
     *
     * A janela nasce escondida (`show: false`) para não piscar, e quem manda
     * mostrar é o `ready-to-show`. Mas `loadFile()` só resolve quando a página
     * terminou de carregar — e o `ready-to-show` dispara antes disso. Com o
     * listener registrado depois do `await`, o evento já passou, o `once` nunca
     * roda, e o app fica no ar mostrando só o overlay, sem painel nenhum. Sem
     * erro em lugar nenhum: é o pior tipo de bug, o sintoma é "não abre".
     */
    const mostrar = () => {
      if (this.win && !this.win.isDestroyed() && !this.win.isVisible()) this.win.show();
    };
    this.win.once('ready-to-show', mostrar);

    const devUrl = process.env.ARC_DESKTOP_DEV_URL;
    if (devUrl) await this.win.loadURL(devUrl);
    else await this.win.loadFile(rendererIndex('desktop'));

    // rede de segurança para o caso de o evento ter disparado durante o load
    mostrar();

    /**
     * Erro de renderer não aparece em lugar nenhum sem isto.
     *
     * A árvore do Preact não tem error boundary: uma exceção dentro de uma
     * view desmonta a árvore inteira e o `main` fica em branco — a janela
     * continua aberta, o menu continua clicável, e nada diz por quê. Puxar o
     * console para o log é o que separa "tela vazia" de "tela vazia por quê".
     */
    this.win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) {
        // 2 = warning, 3 = error
        const where = sourceId ? `${sourceId.split(/[\\/]/).pop()}:${line}` : `linha ${line}`;
        log.error(`[renderer] ${message} (${where})`);
      }
    });
    this.win.webContents.on('render-process-gone', (_e, d) => {
      log.error(`renderer morreu: ${d.reason}`);
    });
    this.win.webContents.on('preload-error', (_e, p, err) => {
      log.error(`preload falhou em ${p}: ${err.message}`);
    });
    /**
     * Fechar **sai**. Esconder é outra coisa, e é o atalho.
     *
     * ## ## ## O que estava quebrado
     *
     * O `close` fazia `preventDefault()` + `hide()`. Com isso o painel sumia,
     * o overlay continuava aberto, `window-all-closed` nunca disparava e o
     * processo ficava vivo — e, como não existe **nenhum** botão de sair no
     * renderer do painel nem ícone na bandeja, fechar a janela era a única
     * coisa que o usuário podia tentar, e não levava a lugar nenhum. O
     * overlay ficava sobre o jogo como fantasma, e `npm start` de novo batia
     * no single instance lock sem abrir janela.
     *
     * O comentário antigo falava em "sair é outra coisa, é explícita:
     * `QUIT` -> `app.quit()`". Esse caminho existia no main e **não existia na
     * interface** — `DesktopChannel.QUIT` não tinha chamador nenhum.
     *
     * Sem bandeja, fechar tem que sair. O `saindo` evita recursão: o
     * `app.quit()` fecha as janelas de novo, o `close` dispara de novo, e sem
     * a guarda ele cancelaria a própria saída.
     */
    /**
     * Sem bandeja, fechar tem que sair.
     *
     * A ordem dos dois `if` é o que importa, e na primeira versão estava
     * invertida: o `preventDefault()` vinha antes do teste de `saindo`, entao
     * a **segunda** chamada de `close` — que vem do próprio `app.quit()` —
     * cancelava o fechamento do painel. O overlay sumia, o painel ficava, e
     * `window-all-closed` nunca disparava: 4 processos vivos e nenhuma janela
     * de onde sair. A guarda de recursão tem de decidir *antes* de cancelar.
     */
    this.win.on('close', (event) => {
      if (this.saindo) return;
      event.preventDefault();
      /**
       * O destino do botao X depende de existir bandeja.
       *
       * Com bandeja, fechar minimiza: o app precisa continuar rodando com a
       * captura ligada enquanto o jogador esta em tela cheia. Sem bandeja,
       * esconder deixa o usuario sem volta nenhuma — overlay vivo sobre o
       * jogo, processo vivo, e `npm start` batendo no single instance lock
       * sem abrir janela.
       */
      if (this.gx.store.config.minimizeToTray && this.gx.tray.active) {
        if (this.win && !this.win.isDestroyed()) this.win.hide();
        return;
      }
      this.saindo = true;
      app.quit();
    });

    this.win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  bindHotkeys(): void {
    globalShortcut.register(this.gx.store.config.panelHotkey, () => this.toggle());
  }

  toggle(): void {
    if (!this.win) return;
    if (this.win.isVisible() && this.win.isFocused()) {
      this.win.hide();
      return;
    }
    this.win.show();
    this.win.focus();
    log.debug('painel alternado');
  }

  show(): void {
    this.win?.show();
  }

  /**
   * Marca que a próxima destruction é saída, não fechamento de janela.
   *
   * A bandeja chama isto antes de `app.quit()`. Sem ele, o `close` disparado
   * pelo `quit()` veria `minimizeToTray` ligado e esconderia o painel em vez
   * de fechar — e o processo ficaria vivo com a bandeja já destruída.
   */
  requestQuit(): void {
    this.saindo = true;
  }

  broadcast(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }
}