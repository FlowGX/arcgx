import { readFile } from 'node:fs/promises';

import { createLogger } from './logger.js';
import type {
  BlueprintsFile,
  ContainersFile,
  ExtractionsFile,
  GameDataBundle,
  ItemsFile,
  ItemUsageFile,
  OutpostsFile,
  ProjectsFile,
  QuestsFile,
  ResearchFile,
  SkillNodesFile,
} from './game-schema.js';

const log = createLogger('game-data');

/**
 * Lê os JSONs do data-release com cache por caminho+mtime.
 *
 * `items.json` tem ~5 MB — ler a cada chamada de IPC custa caro, então o cache
 * só invalida quando o arquivo realmente muda no disco.
 */
export class GameDataStore {
  private readonly cache = new Map<string, { mtimeMs: number; value: unknown }>();
  private bundle: GameDataBundle | null = null;
  private bundleStamp = 0;

  constructor(
    private readonly resolve: (relative: string) => string | null,
    private readonly stat: (file: string) => { mtimeMs: number } | null,
  ) {}

  private async read<T>(relative: string): Promise<T | null> {
    const file = this.resolve(relative);
    if (!file) return null;

    let mtimeMs = 0;
    try {
      mtimeMs = this.stat(file)?.mtimeMs ?? 0;
    } catch {
      return null;
    }

    const hit = this.cache.get(relative);
    if (hit && hit.mtimeMs === mtimeMs) return hit.value as T;

    try {
      const value = JSON.parse(await readFile(file, 'utf8')) as T;
      this.cache.set(relative, { mtimeMs, value });
      return value;
    } catch (err) {
      log.warn(`${relative} ilegível:`, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /** Carrega (ou reaproveita) o pacote completo de dados do jogo. */
  async load(): Promise<GameDataBundle> {
    const stamp = this.stamp();
    if (this.bundle && stamp === this.bundleStamp) return this.bundle;

    const [items, containers, quests, research, skillNodes, projects, outposts, extractions, blueprints, itemUsage] =
      await Promise.all([
        this.read<ItemsFile>('game/items.json'),
        this.read<ContainersFile>('game/containers.json'),
        this.read<QuestsFile>('game/quests.json'),
        this.read<ResearchFile>('game/research.json'),
        this.read<SkillNodesFile>('game/skill-nodes.json'),
        this.read<ProjectsFile>('game/projects.json'),
        this.read<OutpostsFile>('game/outposts.json'),
        this.read<ExtractionsFile>('game/extractions.json'),
        this.read<BlueprintsFile>('game/blueprints.json'),
        this.read<ItemUsageFile>('game/item-usage.json'),
      ]);

    this.bundle = { items, containers, quests, research, skillNodes, projects, outposts, extractions, blueprints, itemUsage };
    this.bundleStamp = stamp;
    log.info(
      `dados carregados: ${items?.itemCount ?? 0} itens, ${Object.keys(containers?.containers ?? {}).length} containers, ${quests?.totalQuests ?? 0} quests`,
    );
    return this.bundle;
  }

  /** Invalida o cache (chamar após um novo data-release). */
  invalidate(): void {
    this.cache.clear();
    this.bundle = null;
    this.bundleStamp = 0;
  }

  private stamp(): number {
    try {
      const items = this.resolve('game/items.json');
      return items ? (this.stat(items)?.mtimeMs ?? 0) : -1;
    } catch {
      return -1;
    }
  }
}