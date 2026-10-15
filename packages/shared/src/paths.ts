import { createRequire } from 'node:module';
import path from 'node:path';

import { createLogger } from './logger.js';

const log = createLogger('paths');

type ElectronApp = typeof import('electron').app;

/**
 * `electron` só existe no processo principal. Importar no topo do módulo
 * quebraria qualquer outro consumidor de `@arcgx/shared` (workers, renderers,
 * ferramentas de CLI), então a resolução é preguiçosa e tolerante à ausência.
 */
let cached: ElectronApp | null | undefined;

function app(): ElectronApp | null {
  if (cached !== undefined) return cached;
  try {
    cached = createRequire(import.meta.url)('electron')?.app ?? null;
  } catch {
    cached = null;
  }
  if (!cached) log.debug('fora do Electron: usando caminhos relativos');
  return cached ?? null;
}

const isElectron = (): boolean => app() !== null;

export const isDev = (): boolean => (app() ? !app()!.isPackaged : process.env.NODE_ENV !== 'production');

const USER_DATA_FALLBACK = path.join(process.cwd(), '.arcgx-data');

export const Paths = {
  get userData(): string {
    return app()?.getPath('userData') ?? USER_DATA_FALLBACK;
  },

  get logs(): string {
    return path.join(Paths.userData, 'logs');
  },

  get dataReleaseRoot(): string {
    return path.join(Paths.userData, 'data-release');
  },

  get sqlitePath(): string {
    return path.join(Paths.userData, 'arcgx.sqlite');
  },

  get configPath(): string {
    return path.join(Paths.userData, 'arcgx-config.json');
  },

  /** Raiz dos addons .node empacotados (`asarUnpack`). */
  get nativeRoot(): string | null {
    const resources = process.resourcesPath;
    if (!resources) return null;
    return path.join(resources, 'app.asar.unpacked', 'packages', 'native');
  },

  /**
   * Locais para procurar um addon nativo, em ordem.
   * O primeiro caminho existente vence; `require` de um `.node` que não existe
   * lança, e o `addon.ts` tenta o próximo.
   */
  nativePackageCandidates(name: 'wgc-capture' | 'cell-vision'): string[] {
    const candidates: string[] = [];

    const override = process.env[`ARC_${name.replace('-', '_').toUpperCase()}_ADDON`]?.trim();
    if (override) candidates.push(path.resolve(override));

    const nativeRoot = Paths.nativeRoot;
    if (nativeRoot) candidates.push(path.join(nativeRoot, name));

    const appPath = app()?.getAppPath();
    if (appPath) candidates.push(path.join(appPath, '..', 'native', name));

    candidates.push(`@arcgx/${name}`);

    return candidates;
  },
};

export { isElectron };