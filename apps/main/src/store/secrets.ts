import { safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { Paths, createLogger } from '@arcgx/shared';

const log = createLogger('store:secrets');

export interface AuthState {
  signedIn: boolean;
  userId: string | null;
  name: string | null;
  token: string | null;
  expiresAt: number | null;
}

const EMPTY: AuthState = { signedIn: false, userId: null, name: null, token: null, expiresAt: null };

/**
 * Token de sessão cifrado com o DPAPI do Windows via `safeStorage`.
 * O arquivo só guarda base64 do ciphertext — sem a chave do Windows, ilegível.
 */
export class SecretStore {
  private state: AuthState = { ...EMPTY };

  get current(): AuthState {
    return this.state;
  }

  private get file(): string {
    return path.join(Paths.userData, 'secrets.json');
  }

  load(): AuthState {
    try {
      if (!existsSync(this.file)) return this.state;
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as {
        enc?: string;
        userId?: string | null;
        name?: string | null;
        expiresAt?: number | null;
      };
      if (raw.enc && safeStorage.isEncryptionAvailable()) {
        const buf = Buffer.from(raw.enc, 'base64');
        const json = safeStorage.decryptString(buf);
        const parsed = JSON.parse(json) as { token: string };
        this.state = {
          signedIn: true,
          userId: raw.userId ?? null,
          name: raw.name ?? null,
          token: parsed.token,
          expiresAt: raw.expiresAt ?? null,
        };
      }
    } catch (err) {
      log.warn('falha ao ler secrets, sessão descartada', err);
      this.state = { ...EMPTY };
    }
    return this.state;
  }

  save(next: AuthState): void {
    this.state = next;
    if (!next.signedIn || !next.token) {
      this.clear();
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('safeStorage indisponível: token NÃO será persistido');
      return;
    }
    const enc = safeStorage.encryptString(next.token).toString('base64');
    const payload = { enc, userId: next.userId, name: next.name, expiresAt: next.expiresAt };
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify(payload), 'utf8');
      renameSync(tmp, this.file);
    } catch (err) {
      log.error('falha ao gravar secrets', err);
    }
  }

  clear(): void {
    this.state = { ...EMPTY };
    try {
      if (existsSync(this.file)) writeFileSync(this.file, JSON.stringify({ enc: null }), 'utf8');
    } catch {
      /* ignore */
    }
  }
}