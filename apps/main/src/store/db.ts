import { DatabaseSync } from 'node:sqlite';

import { Paths, createLogger } from '@arcgx/shared';

const log = createLogger('store:db');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS item (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  tier        TEXT NOT NULL,
  category    TEXT,
  base_value  INTEGER,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS item_tier ON item(tier);
CREATE INDEX IF NOT EXISTS item_name ON item(name);

CREATE TABLE IF NOT EXISTS raid (
  id          TEXT PRIMARY KEY,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  map         TEXT,
  outcome     TEXT,
  kills       INTEGER DEFAULT 0,
  loot_value  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS raid_started ON raid(started_at DESC);

CREATE TABLE IF NOT EXISTS raid_loot (
  raid_id     TEXT NOT NULL REFERENCES raid(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,
  qty         INTEGER NOT NULL DEFAULT 1,
  value       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (raid_id, item_id)
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

/*
 * Stash lido da captura do inventário.
 *
 * "slot" é a posição no grid (1-based) e não um id autoincremental: o mesmo
 * slot lido de novo tem que SUBSTITUIR a leitura anterior, senão a lista
 * cresce a cada passe da câmera e o valor do stash sai dobrado.
 */
CREATE TABLE IF NOT EXISTS stash_stack (
  slot       INTEGER PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  qty        INTEGER NOT NULL DEFAULT 1,
  category   TEXT,
  checked_at INTEGER NOT NULL
);
`;

/**
 * Colunas adicionadas depois da primeira versão do schema.
 *
 * `CREATE TABLE IF NOT EXISTS` não altera tabela já criada, então um banco
 * existente precisa de `ALTER`. Cada uma é aplicada por conta própria e o
 * erro de "coluna já existe" é o caso normal na segunda abertura — deixá-lo
 * abortar derrubaria o app inteiro, porque o schema roda em um `exec` só.
 */
const MIGRATIONS: { table: string; column: string; type: string }[] = [
  { table: 'item', column: 'image_url', type: 'TEXT' },
  { table: 'item', column: 'stack_size', type: 'INTEGER' },
];

/** Banco local via `node:sqlite` (built-in do Node 22+, sem binding nativo). */
export class LocalDb {
  private db: DatabaseSync | null = null;

  open(): boolean {
    try {
      this.db = new DatabaseSync(Paths.sqlitePath);
      this.db.exec(SCHEMA);
      this.migrate();
      log.info(`sqlite aberto em ${Paths.sqlitePath}`);
      return true;
    } catch (err) {
      log.error('falha ao abrir sqlite', err);
      this.db = null;
      return false;
    }
  }

  private migrate(): void {
    for (const m of MIGRATIONS) {
      try {
        this.db?.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`);
      } catch {
        // já existe — esperado a partir da segunda abertura
      }
    }
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = null;
  }

  private get handle(): DatabaseSync | null {
    return this.db;
  }

  upsertItems(
    items: {
      id: string;
      name: string;
      tier: string;
      category?: string | null;
      baseValue?: number | null;
      imageUrl?: string | null;
      stackSize?: number | null;
    }[],
  ): number {
    const h = this.handle;
    if (!h) return 0;
    const stmt = h.prepare(
      `INSERT INTO item (id, name, tier, category, base_value, image_url, stack_size, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, tier = excluded.tier,
         category = excluded.category, base_value = excluded.base_value,
         image_url = excluded.image_url, stack_size = excluded.stack_size,
         updated_at = excluded.updated_at`,
    );
    const now = Date.now();
    h.exec('BEGIN');
    try {
      for (const it of items) {
        stmt.run(
          it.id,
          it.name,
          it.tier,
          it.category ?? null,
          it.baseValue ?? null,
          it.imageUrl ?? null,
          it.stackSize ?? null,
          now,
        );
      }
      h.exec('COMMIT');
    } catch (err) {
      h.exec('ROLLBACK');
      log.error('upsertItems', err);
      return 0;
    }
    return items.length;
  }

  searchItems(query: string, limit: number): unknown[] {
    const h = this.handle;
    if (!h) return [];
    const q = `%${query.toLowerCase()}%`;
    return h
      .prepare(
        `SELECT id, name, tier, category, base_value AS baseValue,
                image_url AS imageUrl, stack_size AS stackSize
         FROM item
         WHERE lower(name) LIKE ? OR lower(id) LIKE ?
         ORDER BY name LIMIT ?`,
      )
      .all(q, q, limit);
  }

  getItem(id: string): unknown | null {
    const h = this.handle;
    if (!h) return null;
    return (
      h
        .prepare(
          `SELECT id, name, tier, category, base_value AS baseValue,
                  image_url AS imageUrl, stack_size AS stackSize
           FROM item WHERE id = ?`,
        )
        .get(id) ?? null
    );
  }

  /**
   * Esvazia o catálogo antes de reindexar.
   *
   * `upsert` só toca nas linhas que vêm no release: item que saiu da base
   * (ou que mudou de id entre releases) continuava no sqlite para sempre. O
   * contador crescia a cada ingestão — 1117 itens viravam 1579 — e o app
   * mostrava o item antigo junto com o novo.
   */
  clearItems(): number {
    const h = this.handle;
    if (!h) return 0;
    try {
      const n = Number(
        (h.prepare('SELECT COUNT(*) AS n FROM item').get() as { n: number } | undefined)?.n ?? 0,
      );
      h.exec('BEGIN');
      h.exec('DELETE FROM item');
      h.exec('DELETE FROM stash_stack');
      h.exec('COMMIT');
      return n;
    } catch (err) {
      try {
        h.exec('ROLLBACK');
      } catch {
        /* já desfez */
      }
      log.error('clearItems', err);
      return 0;
    }
  }

  /** Stash atual, com nome/valor resolvidos pela tabela `item`. */
  listStash(): unknown[] {
    const h = this.handle;
    if (!h) return [];
    return h
      .prepare(
        `SELECT s.slot          AS slot,
                s.item_id       AS itemId,
                s.qty           AS qty,
                s.category      AS category,
                s.checked_at    AS checkedAt,
                i.name          AS name,
                i.tier          AS tier,
                i.base_value    AS baseValue,
                i.image_url     AS imageUrl
         FROM stash_stack s
         LEFT JOIN item i ON i.id = s.item_id
         ORDER BY s.slot`,
      )
      .all();
  }

  /** Substitui o stash inteiro por uma leitura nova. */
  replaceStash(rows: { slot: number; itemId: string; qty: number; category?: string | null }[]): number {
    const h = this.handle;
    if (!h) return 0;
    const now = Date.now();
    const stmt = h.prepare(
      `INSERT INTO stash_stack (slot, item_id, qty, category, checked_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(slot) DO UPDATE SET
         item_id = excluded.item_id, qty = excluded.qty,
         category = excluded.category, checked_at = excluded.checked_at`,
    );
    h.exec('BEGIN');
    try {
      // leitura nova invalida a anterior: o slot que veio vazio esta vazio
      h.prepare('DELETE FROM stash_stack WHERE slot > ?').run(rows.length);
      for (const r of rows) stmt.run(r.slot, r.itemId, r.qty, r.category ?? null, now);
      h.exec('COMMIT');
    } catch (err) {
      h.exec('ROLLBACK');
      log.error('replaceStash', err);
      return 0;
    }
    return rows.length;
  }

  /** Incursões registradas, mais recente primeiro. */
  listRaids(limit = 50): unknown[] {
    const h = this.handle;
    if (!h) return [];
    return h
      .prepare(
        `SELECT id, started_at AS startedAt, ended_at AS endedAt,
                map, outcome, kills, loot_value AS lootValue
         FROM raid
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(limit);
  }

  getKv(key: string): string | null {    const h = this.handle;
    if (!h) return null;
    const row = h.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setKv(key: string, value: string): void {
    const h = this.handle;
    if (!h) return;
    h.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      value,
    );
  }
}