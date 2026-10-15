import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, copyFile, link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createLogger } from './logger.js';
import type { DataReleaseStatus } from './types.js';

const log = createLogger('data-release');

export interface ManifestEntry {
  sha256: string;
  bytes: number;
  key: string;
}

export interface DataReleaseManifest {
  schema: number;
  manifestId: string;
  publishedAt: string;
  files: Record<string, ManifestEntry>;
  optional?: Record<string, Record<string, ManifestEntry>>;
}

export interface DataReleaseOptions {
  /** Base do manifesto. Aceita http(s):// e file:// (dev offline). */
  base: string;
  /** Raiz local (userData/data-release). */
  root: string;
  /** Conjuntos opcionais a baixar (ex.: ["paddle-ocr"]). */
  includeOptional?: string[];
  onProgress?: (status: DataReleaseStatus) => void;
  signal?: AbortSignal;
}

const CURRENT_FILE = 'current.json';

/**
 * Data release endereçado por conteúdo:
 *   <root>/current.json              -> ponteiro para o manifest ativo
 *   <root>/objects/<sha256><ext>     -> blobs (dedupe por hash)
 *   <root>/releases/<manifestId>/...  -> montagem final (hardlink/copy)
 *
 * Publicar modelos e dados novos não exige reempacotar o instalador, e cada
 * arquivo é baixado uma única vez.
 */
export class DataRelease {
  private constructor(
    private readonly options: DataReleaseOptions,
    readonly manifest: DataReleaseManifest,
  ) {}

  static async load(options: DataReleaseOptions): Promise<DataRelease> {
    await mkdir(path.join(options.root, 'objects'), { recursive: true });
    await mkdir(path.join(options.root, 'releases'), { recursive: true });

    const url = joinUrl(options.base, CURRENT_FILE);
    const raw = url.startsWith('file:')
      ? await readFile(fileURLToPath(url), 'utf8')
      : await fetchText(url, options.signal);

    const manifest = JSON.parse(raw) as DataReleaseManifest;
    log.info(`manifest ${manifest.manifestId} (${Object.keys(manifest.files).length} arquivos)`);
    return new DataRelease(options, manifest);
  }

  /** Caminho absoluto de um arquivo do release. */
  filePath(relative: string): string {
    return path.join(this.options.root, 'releases', this.manifest.manifestId, relative);
  }

  has(relative: string): boolean {
    return Boolean(this.manifest.files[relative]);
  }

  /** Baixa (ou reusa do cache de objetos) todos os arquivos do release. */
  async sync(): Promise<void> {
    const manifest = this.manifest;
    const releaseDir = path.join(this.options.root, 'releases', manifest.manifestId);

    const wanted = new Map<string, ManifestEntry>(Object.entries(manifest.files));
    for (const name of this.options.includeOptional ?? []) {
      const group = manifest.optional?.[name];
      if (!group) {
        log.warn(`grupo opcional "${name}" ausente no manifesto`);
        continue;
      }
      for (const [k, v] of Object.entries(group)) wanted.set(k, v);
    }

    const total = wanted.size;
    let done = 0;
    const status: DataReleaseStatus = {
      state: 'loading',
      manifestId: manifest.manifestId,
      publishedAt: manifest.publishedAt,
      percent: 0,
      error: null,
      count: null,
    };
    this.options.onProgress?.(status);

    for (const [relative, entry] of wanted) {
      await this.fetchIntoObjectStore(entry, relative);
      await linkOrCopy(this.objectPath(entry), this.filePath(relative));
      done++;
      status.percent = Math.round((done / total) * 100);
      this.options.onProgress?.({ ...status });
    }

    await writeFile(path.join(releaseDir, '.complete'), manifest.manifestId, 'utf8');
    await writeFile(path.join(this.options.root, CURRENT_FILE), JSON.stringify(manifest, null, 2), 'utf8');

    status.state = 'ready';
    status.percent = null;
    this.options.onProgress?.(status);
    log.info(`release pronto: ${releaseDir}`);
  }

  private objectPath(entry: ManifestEntry): string {
    return path.join(this.options.root, 'objects', entry.sha256 + path.extname(entry.key));
  }

  private async fetchIntoObjectStore(entry: ManifestEntry, relative: string): Promise<void> {
    const dest = this.objectPath(entry);
    if (await exists(dest)) return;

    const url = joinUrl(this.options.base, entry.key);
    const tmp = dest + '.part';
    log.debug(`baixando ${relative} (${(entry.bytes / 1e6).toFixed(1)} MB)`);

    if (url.startsWith('file:')) {
      await copyFile(fileURLToPath(url), tmp);
    } else {
      const res = await fetch(url, { signal: this.options.signal });
      if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
    }

    const hash = await sha256(tmp);
    if (hash !== entry.sha256) {
      await rm(tmp, { force: true });
      throw new Error(`sha256 divergente em ${relative}: esperado ${entry.sha256}, obtido ${hash}`);
    }
    await rename(tmp, dest);
  }
}

/* ------------------------------------------------------------------ utils */

function joinUrl(base: string, rel: string): string {
  if (base.startsWith('file:')) {
    return pathToFileURL(path.join(fileURLToPath(base), rel)).href;
  }
  return base.replace(/\/+$/, '') + '/' + rel.replace(/^\/+/, '');
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function linkOrCopy(src: string, dest: string): Promise<void> {
  if (await exists(dest)) return;
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await link(src, dest);
  } catch {
    // hardlink pode falhar entre volumes -> cai para cópia
    await copyFile(src, dest);
  }
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}