// The little database surface the store modules share. The MatterStore Durable Object owns the
// SQLite handle and hands this to each module; modules never import cloudflare:workers, so their
// SQL can be exercised against any SQLite-shaped runner.

export type Row = Record<string, unknown>;

export interface Db {
  sql<T = Row>(query: string, ...params: unknown[]): T[];
  now(): string;
  id(): string;
  /** One line of activity in plain legal English, attributed to "agent", "lawyer", "client" or "system". */
  log(actor: string, summary: string): void;
  metaGet(key: string): string | null;
  metaSet(key: string, value: string): void;
  metaDelete(key: string): void;
}

/** Add a column to an existing table when an older database lacks it. */
export function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const cols = db.sql<{ name: string }>(`PRAGMA table_info(${table})`).map(r => r.name);
  if (!cols.includes(column)) db.sql(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
