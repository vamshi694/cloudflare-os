// The client's intake answers on the matter: one row per question key, saved as the client goes,
// with who last set it. The firm can correct an answer; the client's original stays in history.

import type { IntakeAnswers } from "./intake.js";
import { intakeCompletion, intakeSchema, type IntakeCompletion } from "./intake.js";
import type { Db } from "./store-db.js";

export const INTAKE_SCHEMA = `
CREATE TABLE IF NOT EXISTS intake_answers (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS intake_history (
  key TEXT NOT NULL, value TEXT NOT NULL, source TEXT NOT NULL, at TEXT NOT NULL);
`;

export type IntakeAnswer = { key: string; value: string; source: "client" | "lawyer"; updatedAt: string };

export function listAnswers(db: Db): IntakeAnswer[] {
  return db.sql("SELECT * FROM intake_answers ORDER BY key").map(r => ({
    key: r.key as string, value: r.value as string, source: r.source as IntakeAnswer["source"], updatedAt: r.updated_at as string,
  }));
}

export function answersMap(db: Db): IntakeAnswers {
  const out: IntakeAnswers = {};
  for (const a of listAnswers(db)) out[a.key] = a.value;
  return out;
}

/** Save answers (empty string clears). Returns how many keys changed. */
export function saveAnswers(db: Db, entries: Record<string, string>, source: IntakeAnswer["source"]): number {
  let changed = 0;
  const current = answersMap(db);
  for (const [key, raw] of Object.entries(entries)) {
    if (!/^[a-z0-9_]{1,64}$/.test(key)) continue;
    const value = String(raw ?? "").slice(0, 4000);
    if ((current[key] ?? "") === value) continue;
    changed += 1;
    if (current[key] !== undefined) db.sql("INSERT INTO intake_history(key, value, source, at) SELECT key, value, source, ? FROM intake_answers WHERE key = ?", db.now(), key);
    if (value.trim() === "") db.sql("DELETE FROM intake_answers WHERE key = ?", key);
    else db.sql(`INSERT INTO intake_answers(key, value, source, updated_at) VALUES(?, ?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, source = excluded.source, updated_at = excluded.updated_at`,
      key, value, source, db.now());
  }
  return changed;
}

export function completion(db: Db, caseType: string | null): IntakeCompletion {
  return intakeCompletion(intakeSchema(caseType), answersMap(db));
}

export function markSent(db: Db): void { db.metaSet("intake_sent_at", db.now()); }
export function sentAt(db: Db): string | null { return db.metaGet("intake_sent_at"); }
export function markCompleted(db: Db): boolean {
  if (db.metaGet("intake_completed_at")) return false;
  db.metaSet("intake_completed_at", db.now());
  return true;
}
export function completedAt(db: Db): string | null { return db.metaGet("intake_completed_at"); }
export function lastAnsweredAt(db: Db): string | null {
  return (db.sql<{ at: string | null }>("SELECT MAX(updated_at) AS at FROM intake_answers")[0]?.at) ?? null;
}
