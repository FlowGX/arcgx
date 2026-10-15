import { createRequire } from 'node:module';

import { app } from 'electron';

import { createLogger, isDev, normalizeFeedUrl, type UpdateState } from '@arcgx/shared';

const log = createLogger('updater');

/**
 * Sentinela: significa "sem override".
 *
 * ## ## ## Por que uma sentinela e nao uma URL real
 *
 * Antes isto era um `DEFAULT_FEED` apontando para um CDN que nunca existiu,
 * e `setFeedURL` era chamado **sempre**. Isso sobrescrevia o `app-update.yml`
 * que o `electron-builder` grava dentro do pacote — ou seja, mesmo com a
 * configuracao de `publish` correta, todo build falhava em 404.
 *
 * Devolvendo a sentinela, `init()` nao chama `setFeedURL` e o
 * `electron-updater` usa o arquivo embutido, que e o caminho que funciona para
 * quem so instala o app.
 */
const BUILTIN_FEED = "__app_update_yml__";

/**
 * `electron-updater` é CommonJS. Em main ESM só o default import existe, e
 * carregá-lo pode falhar (binário nativo do `app-builder-lib` ausente) — por
 * isso é preguiçoso: se o módulo não carregar, o app continua sem auto-update
 * em vez de morrer no boot.
 */
type UpdaterModule = typeof import('electron-updater');
let updaterModule: UpdaterModule | null = null;

function loadUpdater(): UpdaterModule | null {
  if (updaterModule) return updaterModule;
  try {
    const require_ = createRequire(import.meta.url);
    updaterModule = require_('electron-updater') as UpdaterModule;
  } catch (err) {
    log.warn('electron-updater indisponível:', err instanceof Error ? err.message : String(err));
    updaterModule = null;
  }
  return updaterModule;
}

/**
 * electron-updater com feed genérico.
 * Em dev o feed só é consultado se `ARC_UPDATE_FEED_URL` for definido.
 */
export class Updater {
  /**
   * Feed vindo da config, injetado pelo `ArcGx`.
   *
   * ## ## ## Por que um callback e nao o `ArcGx`
   *
   * Os outros servicos daqui (`ScanLoop`, `GameUpdate`) recebem so o que
   * usam, por callback. Passar o `ArcGx` inteiro criaria um ciclo: o `ArcGx`
   * cria o `Updater` no inicializador de campo, e o `Updater` reteria a
   * instancia do `ArcGx` para sempre.
   */
  constructor(private readonly lerFeedConfig: () => string) {}
  private state: UpdateState = { type: 'disabled', reason: 'não inicializado' };
  private readonly onChange = new Set<(s: UpdateState) => void>();

  /**
   * ## ## ## Ordem de precedência
   *
   * 1. `ARC_UPDATE_FEED_URL` — variável de ambiente, para testar um release sem
   *    instalar nada.
   * 2. `updateFeedUrl` da config — ajustável na tela de Configurações, sem
   *    rebuild. É o caminho para quem ainda não tem repositório publicado.
   * 3. `null` — nenhum override: o `electron-updater` usa o `app-update.yml`
   *    embutido pelo `electron-builder` no pacote.
   *
   * O antigo `DEFAULT_FEED` (um CDN que nunca existiu) foi removido: ele
   * sobrescrevia o `app-update.yml` do pacote e transformava todo build em um
   * 404 garantido.
   */
  feedUrl(): string | null {
    const env = normalizeFeedUrl(process.env.ARC_UPDATE_FEED_URL);
    if (env) return env;

    const cfg = normalizeFeedUrl(this.lerFeedConfig());
    if (cfg) return cfg;

    if (isDev()) return null;

    // Sem override: o `electron-updater` lê o `app-update.yml` do pacote.
    return BUILTIN_FEED;
  }

  async init(): Promise<void> {
    const feed = this.feedUrl();
    if (feed === BUILTIN_FEED) {
      // Segue com o `app-update.yml` embutido; `init` nao aborta.
      log.info('usando app-update.yml embutido no pacote');
    } else if (!feed) {
      this.apply({ type: 'disabled', reason: isDev() ? 'build de desenvolvimento' : 'sem feed configurado' });
      return;
    }

    const mod = loadUpdater();
    const autoUpdater = mod?.autoUpdater;
    if (!autoUpdater) {
      this.apply({ type: 'disabled', reason: 'electron-updater não carregou' });
      return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (m: string) => log.info(m),
      warn: (m: string) => log.warn(m),
      error: (m: string) => log.error(m),
      debug: (m: string) => log.debug(m),
    };

    /**
     * ## ## ## `setFeedURL` só quando há override
     *
     * Sem chamada, o `electron-updater` lê o `app-update.yml` que o
     * `electron-builder` assina dentro do pacote — esse é o caminho que
     * funciona para quem só instala o app.
     *
     * A chamada antiga era incondicional e apontava para um CDN que não
     * existe, o que fazia o build em casa e o pacote de teste falharem em 404
     * mesmo com a configuração correta no `electron-builder.yml`.
     *
     * Só sobrescreve quando alguém preencheu `updateFeedUrl` (config) ou
     * `ARC_UPDATE_FEED_URL` (variável de ambiente, para testar sem instalar).
     */
    if (feed && feed !== BUILTIN_FEED) {
      autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    }

    autoUpdater.on('checking-for-update', () => this.apply({ type: 'checking' }));
    autoUpdater.on('update-available', (info: { version: string; releaseNotes?: unknown }) =>
      this.apply({ type: 'available', version: info.version, notes: String(info.releaseNotes ?? '') }),
    );
    autoUpdater.on('update-not-available', () => this.apply({ type: 'disabled', reason: 'atualizado' }));
    autoUpdater.on('download-progress', (p: { percent: number }) =>
      this.apply({ type: 'downloading', percent: p.percent }),
    );
    autoUpdater.on('update-downloaded', (info: { version: string }) =>
      this.apply({ type: 'downloaded', version: info.version }),
    );
    autoUpdater.on('error', (err: Error) => this.apply({ type: 'error', message: err.message }));

    await this.check();
  }

  async check(): Promise<UpdateState> {
    if (!this.feedUrl()) return this.state;
    const autoUpdater = loadUpdater()?.autoUpdater;
    if (!autoUpdater) return this.state;

    this.apply({ type: 'checking' });
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.apply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return this.state;
  }

  installAndQuit(): void {
    const autoUpdater = loadUpdater()?.autoUpdater;
    if (!autoUpdater) {
      log.warn('installAndQuit ignorado: electron-updater indisponível');
      return;
    }
    log.info('instalando atualização e saindo');
    autoUpdater.quitAndInstall();
  }

  subscribe(cb: (s: UpdateState) => void): () => void {
    this.onChange.add(cb);
    cb(this.state);
    return () => this.onChange.delete(cb);
  }

  get current(): UpdateState {
    return this.state;
  }

  private apply(next: UpdateState): void {
    this.state = next;
    for (const cb of this.onChange) cb(next);
  }
}

export const appVersion = (): string => app.getVersion();