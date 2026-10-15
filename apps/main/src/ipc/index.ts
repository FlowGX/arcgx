import { app, BrowserWindow, ipcMain, shell } from 'electron';

import {
  DesktopChannel,
  OverlayChannel, createLogger, type AppConfig, type CorrectionReport, type UnknownSignal } from '@arcgx/shared';
import type { ArcGx } from '../index.js';
import { preloadPath, rendererIndex } from '../resolve.js';

const log = createLogger('ipc');

/** Envolve um handler para nunca derrubar o main se algo lançar. */
function guard<A extends unknown[], R>(
  channel: string,
  handler: (...args: A) => Promise<R> | R,
): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await handler(...(args as A));
    } catch (err) {
      log.error(`${channel}`, err);
      throw err;
    }
  });
}

export function registerIpc(gx: ArcGx): void {
  /* ---------------------------------------------------------- desktop */

  guard(DesktopChannel.GET_CONFIG, () => gx.store.config);
  guard(DesktopChannel.SET_CONFIG, async (patch: Partial<AppConfig>) => {
    const next = await gx.store.patch(patch ?? {});

    // Mudou o idioma: os nomes gravados no sqlite precisam ser reindexados.
    if (patch.locale && patch.locale !== gx.store.config.locale) {
      void gx.reindex();
    }

    gx.overlay.broadcast(OverlayChannel.CONFIG, next);
    gx.panel.broadcast(DesktopChannel.CONFIG_CHANGED, next);
    return next;
  });

  guard(DesktopChannel.GET_STATUS, () => gx.status());
  guard(DesktopChannel.GET_DIAGNOSTICS, () => gx.diagnostics());

  guard(DesktopChannel.LOGIN, async () => {
    gx.secrets.load();
    gx.panel.broadcast(DesktopChannel.AUTH_CHANGED, { signedIn: gx.auth.signedIn });
  });
  guard(DesktopChannel.LOGOUT, async () => {
    gx.secrets.clear();
    gx.panel.broadcast(DesktopChannel.AUTH_CHANGED, { signedIn: false });
  });
  guard(DesktopChannel.GET_AUTH_STATE, () => ({
    signedIn: gx.auth.signedIn,
    userId: gx.auth.userId,
    name: gx.auth.name,
  }));

  guard(DesktopChannel.LIST_ITEMS, async (query: string, limit = 50) =>
    gx.searchItems(String(query ?? ''), Number(limit) || 50),
  );
  guard(DesktopChannel.GET_ITEM_DETAIL, async (id: string) => gx.getItem(String(id)));
  guard(DesktopChannel.LIST_QUESTS, () => gx.listJson('game/quests.json'));
  guard(DesktopChannel.LIST_PROJECTS, () => gx.listJson('game/projects.json'));

  /**
   * Um canal para todos os `game/*.json` da release.
   *
   * O nome vem do renderer, então a validação não pode ser opcional: sem ela,
   * `../../..` transformava o painel num leitor de arquivo arbitrário.
   *
   * A whitelist é a **lista do próprio manifesto**, não uma constante do
   * código — `GAME_DATA_FILES` descreve o que o app espera consumir, e é mais
   * estreita que a release real (maps.json, arc-enemies.json, hideout.json e
   * trades.json existem no disco e não estão naquela lista). Validar contra a
   * constante rejeitava página inteira por um nome em cache.
   */
  guard(DesktopChannel.LIST_GAME_FILE, async (name: string) => {
    const raw = String(name ?? '').trim();
    const key = raw.startsWith('game/') ? raw : `game/${raw}`;

    if (!/^game\/[a-z0-9-]+\.json$/i.test(key)) {
      throw new Error(`arquivo de jogo invalido: ${raw}`);
    }
    if (!gx.hasGameFile(key)) {
      throw new Error(`arquivo ausente na release: ${key}`);
    }
    return gx.listJson(key);
  });

  guard(DesktopChannel.LIST_STASH, () => gx.listStash());
  guard(DesktopChannel.LIST_RAIDS, () => gx.listRaids());

  guard(DesktopChannel.GAME_UPDATE_CHECK, () => gx.gameUpdate);
  guard(DesktopChannel.GAME_UPDATE_RESOLVE, (key: string) => {
    gx.resolveUpdate(String(key ?? ''));
  });
  guard(DesktopChannel.EVENTS_SNAPSHOT, () => gx.eventsSnapshot);

  guard(DesktopChannel.PLAYERS_COUNT, (forcar?: boolean) => {
    // leitura normal é instantânea; o botão "atualizar" força a ida à rede
    if (forcar) return gx.atualizarJogadores(true);
    return gx.playersCount;
  });

  guard(DesktopChannel.OPEN_LOGS_FOLDER, async () => {
    await shell.openPath(app.getPath('logs'));
  });

  guard(DesktopChannel.GET_CREDITS, () => gx.getCredits());
  guard(DesktopChannel.OPEN_CREDITS, async () => {
    const win = new BrowserWindow({
      width: 620,
      height: 560,
      title: 'Créditos e licenças',
      autoHideMenuBar: true,
      backgroundColor: '#0d0b09',
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    const devUrl = process.env.ARC_DESKTOP_DEV_URL;
    if (devUrl) await win.loadURL(`${devUrl}?view=credits`);
    else await win.loadFile(rendererIndex('desktop'), { search: 'view=credits' });
  });

  guard(DesktopChannel.GET_ENTITLEMENT, () => ({
    entitlement: gx.backend.entitlement,
    features: gx.backend.features,
  }));
  guard(DesktopChannel.REDEEM_CODE, async (code: string) => gx.backend.redeem(String(code ?? '')));
  guard(DesktopChannel.GET_PENDING, () => gx.backend.pendingView());
  guard(DesktopChannel.SYNC_DATA, () => gx.backend.sync());
  guard(DesktopChannel.FLUSH_PENDING, () => gx.backend.flush());
  guard(DesktopChannel.SUBMIT_CORRECTION, async (report: CorrectionReport) => {
    return gx.backend.correct(report);
  });

  guard(DesktopChannel.OPEN_EXTERNAL, async (url: string) => {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('apenas http/https');
    await shell.openExternal(String(url));
  });
  guard(DesktopChannel.QUIT, () => app.quit());

  /* -------------------------------------------------- captura e visao */

  /**
   * Janelas candidatas a captura.
   *
   * `listWindows` traz o que o `wgc-capture` enxerga de topo. O filtro de
   * tamanho não é enfeite: a captura do inventário é calibrada para a grade
   * 4x5 medida em 1920x1080, então uma janela estreita não tem como
   * funcionar — é melhor o usuário ver isso na lista do que descobrir depois
   * que o scan sai vazio.
   */
  guard(DesktopChannel.LIST_GAME_WINDOWS, () => {
    const janelas = gx.capture.listWindows();
    log.info(`captura: ${janelas.length} janela(s) disponivel(eis)`);
    return janelas;
  });

  /**
   * Iniciar captura.
   *
   * Sem `hwnd`, tenta achar a janela do jogo pelo título normalizado — o
   * título real do ARC é `"A\u200bR\u200bC\u200b Ra\u200bi\u200bd\u200be\u200br\u200bs"`,
   * com caractere de largura zero no meio, e não casa com comparação literal.
   *
   * `startWindow` já recusa janela fora de primeiro plano, porque o addon
   * precisa que o jogo seja composto. A falha volta para a UI com a mensagem
   * em vez de virar um "parada" sem explicação.
   */
  guard(DesktopChannel.START_CAPTURE, async (hwnd?: number) => {
    const alvo = hwnd ? Number(hwnd) : gx.capture.findGameWindow()?.hwnd;
    if (!alvo) {
      const msg = 'janela do jogo nao encontrada';
      log.warn(`captura: ${msg}`);
      return { ok: false, error: msg };
    }
    const ok = gx.capture.startWindow(alvo);
    if (ok) gx.scan.start();
    log.info(
      `captura ${ok ? 'iniciada' : 'recusada'} no hwnd 0x${alvo.toString(16)}` +
        (ok ? '' : ` — ${gx.capture.error ?? 'sem motivo'}`),
    );
    return { ok, error: gx.capture.error, hwnd: alvo, title: gx.capture.windowTitle };
  });

  guard(DesktopChannel.STOP_CAPTURE, () => {
    gx.scan.stop();
    gx.capture.stop();
    return { ok: true };
  });

  guard(DesktopChannel.CHECK_UPDATE, () => gx.updater.check());
  guard(DesktopChannel.INSTALL_UPDATE, () => gx.updater.installAndQuit());

  gx.updater.subscribe((state) => gx.panel.broadcast(DesktopChannel.UPDATE_STATE, state));

  /* ---------------------------------------------------------- overlay */

  guard(OverlayChannel.READY, () => {
    log.debug('overlay pronto');
  });
  guard(OverlayChannel.SET_INTERACTIVE, (on: boolean) => gx.overlay.setInteractive(Boolean(on)));
  guard(OverlayChannel.CLEAR, () => gx.overlay.broadcast(OverlayChannel.SCAN_RESULT, { t: 0, detections: [], ms: 0 }));
  guard(OverlayChannel.TOGGLE_VISIBILITY, () => {
    gx.overlay.setVisible(!gx.overlay.isVisible());
    return gx.overlay.isVisible();
  });
  guard(OverlayChannel.SET_SCAN_TARGET_HZ, async (hz: number) => {
    await gx.store.patch({ scannerTargetHz: Number(hz) || 4 });
    gx.overlay.broadcast(OverlayChannel.CONFIG, gx.store.config);
  });

  /**
   * O classificador não reconheceu o ícone e o usuário deu um nome.
   *
   * Isso é a peça que fecha o ciclo de dado: o app começa com a semente
   * (pública, defasada), o usuário nomeia o que falta, e a correção vira
   * patch para todo mundo.
   */
  guard(OverlayChannel.NAME_UNKNOWN, async (signal: UnknownSignal, name: string) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || trimmed.length > 80) throw new Error('nome inválido');

    const result = await gx.backend.correct({
      itemId: `unknown_${String(signal.iconHash ?? '').slice(0, 12)}`,
      field: 'name',
      value: trimmed,
      locale: gx.store.config.locale,
    });

    log.info(`item desconhecido nomeado: "${trimmed}" (${result.status})`);
    gx.panel.broadcast(DesktopChannel.STATUS_CHANGED, gx.status());
    return result;
  });

  guard(OverlayChannel.CANCEL_UNKNOWN, () => {
    // Descartado pelo usuário: fica só no log local, não vai para a fila.
    log.debug('item desconhecido descartado');
  });
}