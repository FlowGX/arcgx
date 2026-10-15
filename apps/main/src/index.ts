import { app, BrowserWindow, globalShortcut, session } from 'electron';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  APP_NAME,
  DataRelease,
  DesktopChannel,
  GameDataStore,
  OverlayChannel,
  Paths,
  createLogger,
  envString,
  isDev,
  resolveText,
  toTier,
  type AppStatus,
  type AttributionFile,
  type DataReleaseStatus,
  type Diagnostics,
  type GameItem,
  type RaidRecord,
  type RawGameItem,
  type StashEntry,
  type UpdateCheck,
  type UpdateState,
} from '@arcgx/shared';
import { WorkerPool } from '@arcgx/workers/pool';

import { GameUpdateService } from './services/game-update.js';
import { EventsService } from './services/events.js';
import { PlayersService } from './services/players.js';

import { CaptureManager, visionStatus } from './capture/manager.js';
import { registerIpc } from './ipc/index.js';
import { BackendService } from './services/backend.js';
import { SecretStore } from './store/secrets.js';
import { AppStore } from './store/config.js';
import { LocalDb } from './store/db.js';
import { Updater } from './update/updater.js';
import { ScanLoop } from './scan/loop.js';
import { OverlayWindow } from './windows/overlay.js';
import { PanelWindow } from './windows/panel.js';
import { TrayIcon } from './windows/tray.js';
import { resolveAsset } from './resolve.js';

const log = createLogger('main');
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Backend de correção comunitária.
 *
 * Host verificado: D1 criado, schema aplicado, `/v1/health` respondendo 200 e
 * POST de correção aceito com `status: pending` (consenso de 3).
 *
 * Antes desta linha o default era um domínio inventado — `arcgx-data.arcgx.
 * workers.dev` existia no código mas nunca resolvia no DNS. A URL agora vem
 * do output do `wrangler deploy`, não de previsão.
 */
const DEFAULT_BACKEND = 'https://arcgx-data.arcgx.workers.dev';

/**
 * Onde `npm run data:all` publica, relativo ao pacote principal.
 *
 * Sem isto, `npm start` sem variável de ambiente chega no `DataRelease` com
 * base `''`, o `joinUrl` monta `./current.json`, e o `fetch` do Electron
 * devolve `Failed to parse URL from ./current.json` — erro que aparece na UI
 * como "base de dados com erro" e não diz nada sobre a causa. A release é
 * local e versionada no repositório de dados; quando ela existe, é o padrão
 * razoável, e a variável de ambiente continua mandando por cima.
 */
function localReleaseBase(): string {
  const { join, dirname } = path;
  const candidates = [
    // ## ## ## Empacotado: `resources/data-release`
    //
    // Vem do `extraResources` do electron-builder. É o caminho que resolve o
    // `Failed to parse URL from ./current.json` — no pacote, os dois candidatos
    // abaixo não existem, a base voltava vazia e o app só não quebrava porque
    // o cache em %APPDATA% escondia o erro.
    process.resourcesPath ? join(process.resourcesPath, 'data-release') : null,
    // `dist/index.js` -> a raiz do pacote main
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'build', 'release'),
    join(process.cwd(), 'build', 'release'),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    // o ponteiro de "qual release está ativa" é `current.json`, na raiz. O
    // manifest de cada uma mora em `releases/<id>/`, então procurar
    // `manifest.json` aqui dava falso negativo sempre.
    if (existsSync(join(dir, 'current.json'))) return pathToFileURL(dir).href;
  }

  // ## ## ## Sem base nenhuma: erro que diz o que fazer
  //
  // Antes devolvia `''`, e o erro chegava na UI como
  // `Failed to parse URL from ./current.json` — que fala de URL e não de
  // arquivo faltando no instalador.
  log.error(
    'nenhum data-release encontrado. Procurado em:\n  ' + candidates.join('\n  ') +
    '\nGere com: npm run data:publish -- --src dados --out build/release',
  );
  return '';
}

export class ArcGx {
  readonly store = new AppStore();
  readonly db = new LocalDb();
  readonly capture = new CaptureManager(this);
  readonly updater = new Updater(() => this.store.config.updateFeedUrl);
  readonly secrets = new SecretStore();
  readonly backend: BackendService;

  readonly panel: PanelWindow;
  readonly overlay: OverlayWindow;
  readonly tray: TrayIcon;

  /** Pool de worker do scan — 1 thread, para não pesar no processo main. */
  private scanPool: WorkerPool | null = null;
  readonly scan: ScanLoop;

  private dataRelease: DataRelease | null = null;

  /**
   * Checagem periódica de novidade no catálogo do jogo.
   *
   * Roda no main porque é timer + rede. Avisa o renderer pelo mesmo canal de
   * status, para o painel abrir já com o aviso pronto.
   */
  private readonly updates: GameUpdateService;

  /** Agenda de eventos ao vivo — coletada no main, consumida pela view. */
  private readonly events: EventsService;

  /** Jogadores online — mesma ideia: coleta no main, exibe no painel. */
  private readonly players: PlayersService;
  private dataStatus: DataReleaseStatus = {
    state: 'idle',
    manifestId: null,
    publishedAt: null,
    percent: null,
    error: null,
    count: null,
  };

  gameData: GameDataStore | null = null;
  private attribution: AttributionFile = { generatedAt: '', sources: [] };

  constructor() {
    this.panel = new PanelWindow(this);
    this.overlay = new OverlayWindow(this);
    this.tray = new TrayIcon(this);
    this.backend = new BackendService(envString('ARC_BACKEND_URL', DEFAULT_BACKEND));
    this.scan = new ScanLoop(this, this.capture, (payload) => this.scanRequest(payload));
    this.updates = new GameUpdateService(
      () => this.gameItems,
      () => this.panel.broadcast(DesktopChannel.STATUS_CHANGED, this.status()),
    );
    this.events = new EventsService((s) => this.panel.broadcast(DesktopChannel.EVENTS_SNAPSHOT, s));
    this.players = new PlayersService((p) => this.panel.broadcast(DesktopChannel.PLAYERS_COUNT, p));
  }

  /* ------------------------------------------------------------- ciclo */

  async start(): Promise<void> {
    await this.store.load();
    this.secrets.load();
    this.db.open();

    this.backend.setAppVersion(app.getVersion());
    this.backend.load();

    await Promise.all([this.panel.create(), this.overlay.create()]);
    this.tray.create();

    registerIpc(this);
    this.capture.init();
    this.panel.bindHotkeys();
    this.overlay.bindHotkeys();

    this.overlay.onReady(() => this.overlay.broadcast(OverlayChannel.CONFIG, this.store.config));

    /**
     * DevTools só com `ARC_DEVTOOLS=1`, nunca por padrão.
     *
     * O guarda anterior era `isDev()`, que vale para qualquer execução fora de
     * pacote empacotado — ou seja, `npm start` e `npm run dev` abriam o
     * depurador sozinhos, todas as vezes, mesmo sem ninguém pedir. Para quem
     * usa o app de verdade, isso é só uma janela extra na frente. Quem quiser
     * pedir explicitamente, pede.
     */
    if (process.env.ARC_DEVTOOLS === '1') {
      this.panel.window?.webContents.openDevTools({ mode: 'detach' });
    }

    log.info(`${APP_NAME} iniciado · userData=${app.getPath('userData')}`);

    /**
     * Auto-start da captura, só com `ARC_AUTOSTART=1`.
     *
     * O caminho normal é o botão do painel, e é o certo: quem não pediu para
     * ler a tela não começa a ler. Mas para conferir o overlay de ponta a
     * ponta exigiria um clique a cada iteração, e o resultado de um teste
     * depende de alguém lembrar de clicar — teste que depende de passo manual
     * deixa de ser teste.
     */
    if (process.env.ARC_AUTOSTART === '1') {
      const alvo = this.capture.findGameWindow()?.hwnd;
      if (alvo) {
        const ok = this.capture.startWindow(alvo);
        if (ok) this.scan.start();
        log.info(`autostart: captura ${ok ? 'iniciada' : 'recusada'} no hwnd 0x${alvo.toString(16)}`);
      } else {
        log.warn('autostart: janela do jogo nao encontrada');
      }
    }

    void this.loadDataRelease().then(() => this.syncCommunityData());
  }

  /**
   * Depois da semente, aplica o patch da comunidade.
   *
   * A semente é a fonte de verdade estrutural (tem tudo que existe na fonte
   * pública); o patch só ajusta valores e nomes que a comunidade corrigiu.
   */
  private async syncCommunityData(): Promise<void> {
    try {
      await this.backend.flush();
      const patch = await this.backend.sync();
      if (!patch || patch.count === 0) {
        log.info('nenhuma correção da comunidade nova');
        return;
      }
      const count = await this.reindex();
      log.info(`aplicadas ${patch.count} correções · ${count} itens reindexados`);
      this.panel.broadcast(DesktopChannel.STATUS_CHANGED, this.status());
    } catch (err) {
      log.warn('sync da comunidade falhou', err);
    }
  }

  /**
 * Onde o worker procura `gallery.json`.
 *
 * Empacotado, os modelos vivem ao lado dos addons nativos (mesmo `asarUnpack`);
 * em desenvolvimento, na raiz do repositório. Sem isso o worker sobe, detecta
 * as células e devolve todas sem item — e nada no payload denuncia isso além
 * do `fallback`.
 */
private get modelsDir(): string {
  const nativeRoot = Paths.nativeRoot;
  if (nativeRoot) return path.join(path.dirname(nativeRoot), 'models');
  return path.join(path.resolve(fileURLToPath(new URL('../../../..', import.meta.url))), 'models');
}

/**
   * Encaminha uma mensagem ao worker de scan.
   *
   * O pool é criado sob demanda: subir a thread antes de existir captura e
   * galeria só custa memória.
   */
  private async scanRequest<T>(payload: Record<string, unknown>): Promise<T> {
    if (!this.scanPool) {
      this.scanPool = new WorkerPool({
        kind: 'scan',
        modelsDir: this.modelsDir,
        resourcesDir: resolveAsset('resources'),
      });
    }
    return this.scanPool.request<T>(payload as never);
  }

  async shutdown(): Promise<void> {
    this.updates.stop();
    this.events.stop();
    this.players.stop();
    this.capture.stop();
    this.scan.stop();
    this.tray.dispose();

    /**
     * A thread do worker precisa ser encerrada, nao abandonada.
     *
     * Uma `worker_threads.Worker` viva mantem o event loop do Node de pe, e o
     * Electron espera esse loop para sair: fechar a janela deixava o processo
     * inteiro de pe — overlay fantasmando, `electron.exe` na lista de
     * processos, e `npm start` batendo no single instance lock sem abrir nada.
     *
     * `terminate()` tambem rejeita as requisicoes pendentes, entao um scan no
     * ar no momento do fechamento nao vira uma promessa que nunca resolve.
     */
    if (this.scanPool) {
      await this.scanPool.terminate();
      this.scanPool = null;
    }

    this.db.close();
  }

  /* -------------------------------------------------------- data release */

  private get dataReleaseBase(): string {
    return envString('ARC_DATA_RELEASE_URL', '') || localReleaseBase();
  }

  async loadDataRelease(): Promise<void> {
    this.dataStatus = { ...this.dataStatus, state: 'loading', error: null, percent: 0 };
    try {
      const release = await DataRelease.load({
        base: this.dataReleaseBase,
        root: path.join(app.getPath('userData'), 'data-release'),
        includeOptional: this.store.config.ocrEnabled ? ['paddle-ocr'] : [],
        onProgress: (s) => {
          this.dataStatus = s;
        },
      });
      this.dataRelease = release;
      await release.sync();

      this.gameData = new GameDataStore(
        (rel) => (this.dataRelease?.has(rel) ? this.dataRelease.filePath(rel) : null),
        (file) => statSync(file),
      );

      const count = await this.indexItems();
      log.info(`data release pronto — ${count} itens indexados`);
      this.dataStatus.count = count || this.dataStatus.count;

      // Só depois do catálogo existir a checagem tem contra o que comparar.
      this.updates.start();
      this.events.start();
      this.players.start();

      // Aplica o que já veio na sessão/fila local antes de buscar da comunidade.
      this.applyLocalCorrections();

      await this.loadAttribution();
    } catch (err) {
      this.dataStatus = {
        ...this.dataStatus,
        state: 'error',
        percent: null,
        error: err instanceof Error ? err.message : String(err),
      };
      log.error('data release falhou', err);
    }
  }

  /**
   * `items.json` traz nome por idioma e um valor de referência. O sqlite guarda
   * o texto já resolvido no idioma configurado — reindexar quando o idioma muda.
   */
  private async indexItems(): Promise<number> {
    if (!this.gameData) return 0;
    const bundle = await this.gameData.load();
    if (!bundle.items) return 0;

    const locale = this.store.config.locale;

    this.gameItems = bundle.items.items as unknown as Record<string, RawGameItem>;

    // Catálogo é derivado da release: sobras de uma release anterior são
    // lixo, não histórico. `stash_stack` cai junto porque referencia `item`.
    const sobras = this.db.clearItems();

    const n = this.db.upsertItems(
      Object.values(bundle.items.items).map((it) => ({
        id: it.id,
        name: resolveText(it.name, locale, it.id),
        tier: toTier(it.rarity),
        category: it.type ?? null,
        baseValue: Number.isFinite(it.value) ? it.value : null,
        // `imageFilename` é uma URL absoluta do dump de dados. Sem ela o tile
        // do item sai vazio, que é a maior diferença visual contra a
        // referência — a grade inteira vira uma coluna de caixas sem arte.
        imageUrl: typeof it.imageFilename === 'string' ? it.imageFilename : null,
        stackSize: Number.isFinite(it.stackSize) ? it.stackSize : null,
      })),
    );

    if (sobras && sobras !== n) {
      log.warn(`catalogo reindexado: ${n} itens (${sobras} linhas antigas descartadas)`);
    }

    return n;
  }

  /** Reindexa os textos no idioma atual (chamado quando `locale` muda). */
  async reindex(): Promise<number> {
    this.gameData?.invalidate();
    return this.indexItems();
  }

  /**
   * Correções aceitas localmente entram por cima da semente.
   *
   * Sem isso o usuário renomeia um item, o indexador roda de novo e o nome
   * some — porque a semente do data-release não mudou.
   */
  private applyLocalCorrections(): void {
    const local = this.backend.localCorrections;
    const entries = Object.entries(local);
    if (!entries.length) return;

    let applied = 0;
    const raw = this.rawItems();
    if (!raw) return;

    for (const [itemId, fields] of entries) {
      const item = raw[itemId];
      if (!item) continue;

      for (const [key, value] of Object.entries(fields)) {
        const [locale, field] = key.split(':');
        if (!locale || !field) continue;
        if (field === 'name') {
          item.name = { ...item.name, [locale]: value };
          applied++;
        } else if (field === 'value') {
          const n = Number(value);
          if (Number.isFinite(n)) item.value = n;
        } else if (field === 'tier') {
          item.rarity = toTier(value) ?? item.rarity;
        }
      }
    }

    if (applied) log.info(`${applied} correções locais aplicadas sobre a semente`);
  }

  /** Itens crus carregados (necessário para editar a semente). */
  private rawItems(): Record<string, RawGameItem> | null {
    return this.gameItems;
  }

  private gameItems: Record<string, RawGameItem> | null = null;

  /**
   * Créditos das fontes de dados.
   *
   * O arquivo vem junto do data-release (o app baixa os dados de terceiros,
   * então a atribuição viaja com eles). Sem isso, usar o dado é uso não
   * licenciado.
   */
  private async loadAttribution(): Promise<void> {
    const rel = 'ATTRIBUTION.json';
    if (!this.dataRelease?.has(rel)) {
      log.warn('ATTRIBUTION.json ausente no release');
      return;
    }
    try {
      this.attribution = JSON.parse(await readFile(this.dataRelease.filePath(rel), 'utf8'));
      const required = this.attribution.sources.filter((s) => s.required);
      log.info(`créditos: ${this.attribution.sources.length} fontes, ${required.length} obrigatórias`);
    } catch (err) {
      log.error('ATTRIBUTION.json ilegível', err);
    }
  }

  getCredits(): AttributionFile {
    return this.attribution;
  }

  async listJson(relative: string): Promise<unknown> {
    if (!this.dataRelease?.has(relative)) return [];
    try {
      return JSON.parse(await readFile(this.dataRelease.filePath(relative), 'utf8'));
    } catch {
      return [];
    }
  }

  /** O manifesto é a lista de verdade do que a release trouxe. */
  hasGameFile(key: string): boolean {
    return this.dataRelease?.has(key) ?? false;
  }

  /** Nomes de arquivo disponíveis, para o painel não pedir o que não existe. */
  gameFiles(): string[] {
    if (!this.dataRelease) return [];
    return Object.keys(this.dataRelease.manifest.files).filter((f) => f.startsWith('game/'));
  }

  /* ----------------------------------------------------------- serviços */

  get auth(): { signedIn: boolean; userId: string | null; name: string | null } {
    return {
      signedIn: this.secrets.current.signedIn,
      userId: this.secrets.current.userId,
      name: this.secrets.current.name,
    };
  }

  searchItems(query: string, limit: number): GameItem[] {
    return this.db.searchItems(query, limit) as GameItem[];
  }

  listStash(): StashEntry[] {
    return this.db.listStash() as StashEntry[];
  }

  listRaids(): RaidRecord[] {
    return this.db.listRaids() as RaidRecord[];
  }

  /** Estado da última checagem de novidade do catálogo. */
  get gameUpdate(): UpdateCheck | null {
    return this.updates.get();
  }

  /** Força uma checagem agora (botão "verificar" no painel). */
  async checarUpdate(): Promise<UpdateCheck | null> {
    return this.updates.checar();
  }

  get eventsSnapshot() {
    return this.events.get();
  }

  get playersCount() {
    return this.players.get();
  }

  /** Força a releitura da contagem (botão no painel de créditos). */
  async atualizarJogadores(forcar = false) {
    return this.players.buscar(forcar);
  }

  resolveUpdate(chave: string): void {
    this.updates.resolver(chave);
  }

  getItem(id: string): GameItem | null {
    return this.db.getItem(id) as GameItem | null;  }

  status(): AppStatus {
    const cap = this.capture;
    return {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      capture: {
        available: cap.available,
        running: cap.isRunning,
        source: cap.source,
        windowTitle: cap.windowTitle,
        error: cap.error,
      },
      vision: visionStatus(),
      ocr: {
        available: this.dataStatus.state === 'ready',
        engine: null,
        locale: null,
        error: this.dataStatus.error,
      },
      dataRelease: this.dataStatus,
      update: this.updater.current,
      fps: { scan: 0, overlay: cap.stats.avgFps },
      memoryMb: Math.round(process.memoryUsage().rss / 1e6),
    };
  }

  diagnostics(): Diagnostics {
    const env = process.env as Record<string, string>;
    return {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node,
      v8: process.versions.v8,
      platform: `${process.platform} ${process.arch} (${os.release()})`,
      arch: process.arch,
      cwd: process.cwd(),
      userData: app.getPath('userData'),
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1e6),
      env: Object.fromEntries(
        Object.entries(env).filter(([k]) => k.startsWith('ARC_') || k === 'NODE_ENV'),
      ),
    };
  }

  updateState(): UpdateState {
    return this.updater.current;
  }
}

/* ------------------------------------------------------------ bootstrap */

const single = app.requestSingleInstanceLock();
if (!single) {
  app.quit();
} else {
  const instance: { gx: ArcGx | null } = { gx: null };

  /**
   * Segunda instância: mostra o painel.
   *
   * `getAllWindows()[0]` **não** é o painel — a janela em tela cheia e
   * transparente do overlay entra na lista e, dependendo da ordem de criação,
   * vem antes. Focar ela não mostra nada: o usuário roda `npm start`, o
   * processo novo sai em silêncio por causa do lock, e do lado de cá só um
   * overlay invisível ganhou foco. Parece que o app não abre.
   *
   * O alvo é o painel, sempre; o overlay nunca deve ser foco.
   */
  app.on('second-instance', () => {
    const painel = instance.gx?.panel.window;
    if (!painel || painel.isDestroyed()) return;
    if (painel.isMinimized()) painel.restore();
    if (!painel.isVisible()) painel.show();
    painel.focus();
  });

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    app.setAppUserModelId('io.arcgx.app');
    app.setName(APP_NAME);

    const gx = new ArcGx();
    instance.gx = gx;
    (globalThis as Record<string, unknown>).__arcgx = gx;

    // Um throw aqui derrubaria o app em silêncio; loga e segue.
    await gx.start().catch((err) => log.error('falha no start', err));
    await gx.updater.init().catch((err) => log.error('falha no updater', err));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void gx.start();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    void instance.gx?.shutdown();
  });
}