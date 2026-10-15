import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `apps/main/dist/main` em dev; `.../resources/app/apps/main/dist/main` empacotado.
 * Sem isto, o mesmo código não acha o preload e o HTML dos renderers nos dois modos.
 */
const appRoot: string = (() => {
  const candidates = [
    path.resolve(here, '..', '..'), // dev: apps/main
    path.resolve(here, '..', '..', '..'), // empacotado: <resources>/app
  ];
  return candidates.find((p) => existsSync(path.join(p, 'apps'))) ?? (candidates[0] as string);
})();

/** Primeiro caminho existente entre os candidatos. */
export function resolveAsset(...relatives: string[]): string {
  for (const base of [appRoot, path.resolve(appRoot, 'apps', 'main')]) {
    for (const rel of relatives) {
      const full = path.resolve(base, rel);
      if (existsSync(full)) return full;
    }
  }
  // fallback: primeiro candidato (o erro do Electron diz qual arquivo faltou)
  return path.resolve(appRoot, relatives[0] ?? '');
}

export const preloadPath = (): string => resolveAsset('preload.cjs', 'apps/main/preload.cjs');

export const rendererIndex = (which: 'desktop' | 'overlay'): string =>
  resolveAsset(`apps/renderer/${which}/dist/index.html`, `../../renderer/${which}/dist/index.html`);