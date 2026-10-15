import { app, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';

import { createLogger } from '@arcgx/shared';
import type { ArcGx } from '../index.js';
import { preloadPath } from '../resolve.js';

const log = createLogger('window:tray');

/**
 * Icone na bandeja.
 *
 * ## ## ## Por que isto decide quem sai
 *
 * Sem bandeja, fechar o painel nao tem para onde ir: esconder deixa o usuario
 * sem volta, e sair e a unica saida honesta. Com bandeja, fechar vira
 * "minimizar" — que e o que o usuario quer, porque o app precisa continuar
 * rodando com a captura ligada enquanto ele joga em tela cheia.
 *
 * E por isso que `minimizeToTray` e **condicional** e nao um comportamento
 * fixo: o destino do botao X depende de a bandeja existir.
 */
export class TrayIcon {
  private tray: Tray | null = null;

  constructor(private readonly gx: ArcGx) {}

  get active(): boolean {
    return this.tray !== null;
  }

  /**
   * Cria a bandeja, ou nao, conforme a configuracao.
   *
   * Deve rodar depois de `app.whenReady()`: no macOS a bandeja antes disso
   * fica invisivel e precisa ser recriada depois.
   */
  create(): void {
    if (!app.isReady()) {
      log.warn('bandeja pedida antes de app.whenReady');
      return;
    }
    if (this.tray) return;
    if (!this.gx.store.config.minimizeToTray) return;

    const icone = this.icone();
    this.tray = new Tray(icone);
    this.tray.setToolTip('Arc GX');
    this.tray.setContextMenu(this.menu());
    this.tray.on('click', () => this.gx.panel.toggle());
  }

  private icone(): Electron.NativeImage {
    // O icone precisa existir em `assets/` e estar listado em `extraResources`
    // (ou em `files`) do electron-builder. Sem ele, `nativeImage.createFromPath`
    // devolve vazio e a bandeja aparece sem imagem nenhuma no Windows.
    const candidatos = [
      path.join(process.resourcesPath ?? '', 'assets', 'icon.ico'),
      path.join(preloadPath(), '..', '..', '..', '..', 'assets', 'icon.ico'),
    ];
    for (const c of candidatos) {
      try {
        const img = nativeImage.createFromPath(c);
        if (!img.isEmpty()) return img;
      } catch {
        /* proximo candidato */
      }
    }
    log.warn('icone da bandeja nao encontrado; usando imagem vazia');
    return nativeImage.createEmpty();
  }

  private menu(): Electron.Menu {
    return Menu.buildFromTemplate([
      { label: 'Abrir Arc GX', click: () => this.gx.panel.show() },
      {
        label: 'Overlay',
        type: 'checkbox',
        checked: this.gx.store.config.overlayVisible,
        click: (item) => this.gx.overlay.setVisible(item.checked),
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          // Sai de verdade: `saindo` no painel precisa saber que o fechamento
          // ja foi decidido, senao ele cancela e o processo fica vivo.
          this.gx.panel.requestQuit();
          app.quit();
        },
      },
    ]);
  }

  /** some na hora de sair — um icone orfao mostra um app que nao existe mais. */
  dispose(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}