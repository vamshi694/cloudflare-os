// The matter's desk files (plan.md, notes, delegated work) and the decisions only the attorney
// can answer, with their kinds: a plain decision, the plan approval, an outreach release, and the
// synthesized "couldn't read" items for unreadable documents.

import type { NeedsYouItem } from "@gadgets/workshop-shared/legal";
import type { Decision, DeskFile } from "./types.js";
import { ensureColumn, parseJson, type Db, type Row } from "./store-db.js";

export const DESK_SCHEMA = `
CREATE TABLE IF NOT EXISTS desk_files (
  path TEXT PRIMARY KEY, content TEXT NOT NULL, rev INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS desk_revisions (
  path TEXT NOT NULL, rev INTEGER NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (path, rev));
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, question TEXT NOT NULL, options TEXT NOT NULL, status TEXT NOT NULL, answer TEXT,
  raised_at TEXT NOT NULL, answered_at TEXT);
`;

export function migrateDecisions(db: Db): void {
  ensureColumn(db, "decisions", "kind", "TEXT NOT NULL DEFAULT 'decision'");
  ensureColumn(db, "decisions", "detail", "TEXT");
  ensureColumn(db, "decisions", "recommendation", "TEXT");
  ensureColumn(db, "decisions", "message_id", "TEXT");
}

// ---- desk --------------------------------------------------------------------------------------

export function deskList(db: Db): DeskFile[] {
  return db.sql<DeskFile>("SELECT path, LENGTH(content) AS bytes, rev, updated_at AS updatedAt, updated_by AS updatedBy FROM desk_files ORDER BY path");
}

export function deskRead(db: Db, path: string): { content: string; rev: number } | null {
  return db.sql<{ content: string; rev: number }>("SELECT content, rev FROM desk_files WHERE path = ?", path)[0] ?? null;
}

export function deskWrite(db: Db, path: string, content: string, by: string, baseRev?: number): { rev: number } {
  const current = deskRead(db, path);
  if (current && baseRev !== undefined && baseRev !== current.rev) {
    throw new Error(`"${path}" changed since you read it (you had revision ${baseRev}, it is now ${current.rev}). Read it again and merge.`);
  }
  const rev = (current?.rev ?? 0) + 1;
  const ts = db.now();
  db.sql(`INSERT INTO desk_files(path, content, rev, updated_at, updated_by) VALUES(?, ?, ?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET content = excluded.content, rev = excluded.rev, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    path, content, rev, ts, by);
  db.sql("INSERT INTO desk_revisions(path, rev, content, updated_at, updated_by) VALUES(?, ?, ?, ?, ?)", path, rev, content, ts, by);
  return { rev };
}

export function deskDelete(db: Db, path: string): void {
  if (path === "plan.md") throw new Error("plan.md is the matter's living plan and cannot be deleted; rewrite it instead.");
  db.sql("DELETE FROM desk_files WHERE path = ?", path);
}

// ---- decisions ---------------------------------------------------------------------------------

export type DecisionKind = "decision" | "plan" | "outreach";

export function raiseDecision(db: Db, input: {
  question: string; options: string[]; kind?: DecisionKind; detail?: string | null; recommendation?: string | null; messageId?: string | null;
}): { id: string } {
  const id = db.id();
  const options = input.options.map(o => o.trim()).filter(Boolean);
  db.sql("INSERT INTO decisions(id, question, options, status, raised_at, kind, detail, recommendation, message_id) VALUES(?, ?, ?, 'open', ?, ?, ?, ?, ?)",
    id, input.question, JSON.stringify(options), db.now(), input.kind ?? "decision", input.detail ?? null,
    input.recommendation ?? options[0] ?? null, input.messageId ?? null);
  db.log("agent", input.kind === "plan" ? "Put the plan on the attorney's desk for approval."
    : input.kind === "outreach" ? "Drafted a message to the client and put it on the attorney's desk for release."
    : `Asked the attorney: ${input.question}`);
  return { id };
}

export function decisionRow(db: Db, id: string): Row | undefined {
  return db.sql("SELECT * FROM decisions WHERE id = ?", id)[0];
}

export function answerDecision(db: Db, id: string, answer: string, by: string): Row | null {
  const row = db.sql("SELECT * FROM decisions WHERE id = ? AND status = 'open'", id)[0];
  if (!row) return null;
  db.sql("UPDATE decisions SET status = 'answered', answer = ?, answered_at = ? WHERE id = ?", answer, db.now(), id);
  db.log(by, row.kind === "plan" ? `On the plan: ${answer}` : row.kind === "outreach" ? `On the client message: ${answer}` : `Answered: ${answer}`);
  return row;
}

export function listDecisions(db: Db): Decision[] {
  return db.sql("SELECT * FROM decisions ORDER BY (status = 'open') DESC, raised_at DESC").map(r => ({
    id: r.id as string, question: r.question as string, options: parseJson<string[]>(r.options, []),
    status: r.status as "open" | "answered", answer: (r.answer as string | null) ?? null,
    raisedAt: r.raised_at as string, answeredAt: (r.answered_at as string | null) ?? null,
  }));
}

/** Everything waiting on the attorney: open decisions by kind, then the documents the firm could not read. */
export function needsYouItems(db: Db): NeedsYouItem[] {
  const decisions: NeedsYouItem[] = db.sql("SELECT * FROM decisions WHERE status = 'open' ORDER BY (kind = 'plan') DESC, raised_at").map(r => ({
    id: r.id as string,
    kind: (r.kind as DecisionKind) ?? "decision",
    title: r.question as string,
    detail: (r.detail as string | null) ?? null,
    options: parseJson<string[]>(r.options, []),
    recommendation: (r.recommendation as string | null) ?? null,
    raisedAt: r.raised_at as string,
  }));
  const unreadable: NeedsYouItem[] = db.sql("SELECT id, filename, display_title, note, updated_at FROM documents WHERE status = 'failed' ORDER BY updated_at DESC").map(r => ({
    id: `doc:${r.id as string}`,
    kind: "unreadable_document",
    title: `The firm could not read "${(r.display_title as string | null) ?? (r.filename as string)}"`,
    detail: (r.note as string | null) ?? null,
    options: [],
    recommendation: null,
    raisedAt: r.updated_at as string,
  }));
  return [...decisions, ...unreadable];
}

export function planState(db: Db): { proposed: boolean; approved: boolean } {
  const open = db.sql<{ n: number }>("SELECT COUNT(*) AS n FROM decisions WHERE kind = 'plan' AND status = 'open'")[0]?.n ?? 0;
  const approved = db.metaGet("plan_approved") === "1";
  return { proposed: open > 0 || approved, approved };
}
