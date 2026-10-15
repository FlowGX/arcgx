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
   * Cria a bandeja.
   *
   * ## ## ## Por que deixou de depender da configuração
   *
   * Antes era `if (!minimizeToTray) return`. Com o padrão `false`, a bandeja
   * **nunca existia** — e o usuário reclamava que o app "não fica na bandeja",
   * sem ter como descobrir que o culpado era um checkbox desligado em
   * Ajustes, numa tela que ele só acharia depois de fechar o app sem querer.
   *
   * ## ## ## Separação de responsabilidades
   *
   * Agora a bandeja é sempre criada e é a **âncora de saída**: existe um lugar
   * previsível para voltar ao app e um item "Sair" no menu, independente da
   * configuração. `minimizeToTray` decide apenas o que o **X** faz:
   *
   *   true  — X esconde, o app continua com a captura ligada enquanto joga
   *   false — X encerra, e a bandeja some junto com o processo
   *
   * Criar sempre é a única versão em que o item de menu "Sair" é confiável:
   * com a bandeja condicional, fechar a janela matava o app e o menu sumia.
   *
   * Deve rodar depois de `app.whenReady()`: no macOS a bandeja antes disso
   * fica invisível e precisa ser recriada depois.
   */
  create(): void {
    if (!app.isReady()) {
      log.warn('bandeja pedida antes de app.whenReady');
      return;
    }
    if (this.tray) return;

    const icone = this.icone();
    this.tray = new Tray(icone);
    this.tray.setToolTip('Arc GX');
    this.tray.setContextMenu(this.menu());
    this.tray.on('click', () => this.gx.panel.toggle());

    log.info('bandeja criada');
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