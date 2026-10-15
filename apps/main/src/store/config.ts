import { safeStorage, screen } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_CONFIG, Paths, createLogger, sanitizeConfig, type AppConfig } from '@arcgx/shared';

const log = createLogger('store:config');

/**
 * Config em JSON atômico, no userData. Autenticidade/tokens ficam em outro
 * arquivo cifrado pelo `safeStorage` do Electron (ver store/secrets.ts).
 */
export class AppStore {
  private current: AppConfig = { ...DEFAULT_CONFIG };

  get config(): AppConfig {
    return this.current;
  }

  async load(): Promise<AppConfig> {
    const file = Paths.configPath;
    try {
      if (existsSync(file)) {
        this.current = sanitizeConfig(JSON.parse(readFileSync(file, 'utf8')));
      } else {
        this.current = { ...DEFAULT_CONFIG };
      }
    } catch (err) {
      log.error('config corrompida, usando defaults', err);
      this.current = { ...DEFAULT_CONFIG };
    }
    this.pruneWindowBounds();
    return this.current;
  }

  async patch(patch: Partial<AppConfig>): Promise<AppConfig> {
    this.current = sanitizeConfig({ ...this.current, ...patch });
    this.save();
    return this.current;
  }

  private save(): void {
    try {
      mkdirSync(path.dirname(Paths.configPath), { recursive: true });
      const tmp = Paths.configPath + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.current, null, 2), 'utf8');
      renameSync(tmp, Paths.configPath);
    } catch (err) {
      log.error('falha ao salvar config', err);
    }
  }

  /** Bounds de janela fora de qualquer tela não devem ser restaurados. */
  private pruneWindowBounds(): void {
    const b = this.current.windowBounds;
    if (!b || b.x === undefined || b.y === undefined) return;
    const visible = screen.getAllDisplays().some((d) => {
      const w = d.workArea;
      return (
        b.x! < w.x + w.width &&
        b.x! + b.width > w.x &&
        b.y! < w.y + w.height &&
        b.y! + b.height > w.y
      );
    });
    if (!visible) this.current = { ...this.current, windowBounds: { width: b.width, height: b.height } };
  }
}