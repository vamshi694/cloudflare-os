// Tabular review over the record (WP-14): every document a row, every question a column, every
// cell an answer with the page and the verbatim words it rests on. The default columns come from
// the record itself where the record already knows (criterion, pages) and from one model pass per
// document where it does not (date, issuer, what it proves). A custom question is one lane job
// per document. Pure functions here; the store composes the view and jobs.ts runs the passes.

import type { TableCell, TableColumn, TableView } from "@gadgets/workshop-shared/legal";
import type { Db, Row } from "./store-db.js";

export const TABULAR_SCHEMA = `
CREATE TABLE IF NOT EXISTS review_questions (
  key TEXT PRIMARY KEY, question TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS document_answers (
  document_id TEXT NOT NULL, question_key TEXT NOT NULL, answer TEXT, page INTEGER, quote TEXT,
  status TEXT NOT NULL, note TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (document_id, question_key));
`;

/** The questions the firm answers for every document without being asked. */
export const DEFAULT_QUESTIONS: { key: string; question: string; derived: boolean }[] = [
  { key: "date", question: "What date does this document carry (the date it was issued or signed)?", derived: false },
  { key: "issuer", question: "Who issued or authored this document (the organization or person, as named in it)?", derived: false },
  { key: "proves", question: "What does this document prove for the petition, in one sentence?", derived: false },
  { key: "criterion", question: "Which petition criteria does it support?", derived: true },
  { key: "pages", question: "How many pages?", derived: true },
];

export const MODEL_DEFAULT_KEYS = DEFAULT_QUESTIONS.filter(q => !q.derived).map(q => q.key);

export type AnswerInput = { key: string; answer: string | null; page: number | null; quote: string | null };

/** A model's raw answers, made honest: unknown keys dropped, empty answers become "not stated", pages sane. */
export function shapeAnswers(raw: unknown, allowedKeys: string[], pageCount: number | null): AnswerInput[] {
  const allowed = new Set(allowedKeys);
  const list = Array.isArray(raw) ? raw : [];
  const out = new Map<string, AnswerInput>();
  for (const item of list as Record<string, unknown>[]) {
    if (!item || typeof item !== "object") continue;
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!allowed.has(key) || out.has(key)) continue;
    const answerRaw = typeof item.answer === "string" ? item.answer.replace(/\s+/g, " ").trim() : "";
    const answer = answerRaw && !/^(unknown|n\/?a|none|not stated|not found)\.?$/i.test(answerRaw) ? answerRaw.slice(0, 600) : null;
    let page: number | null = typeof item.page === "number" && Number.isInteger(item.page) && item.page >= 1 ? item.page : null;
    if (page !== null && pageCount !== null && page > pageCount) page = null;
    const quote = typeof item.quote === "string" && item.quote.trim() ? item.quote.replace(/\s+/g, " ").trim().slice(0, 400) : null;
    out.set(key, { key, answer, page, quote: answer ? quote : null });
  }
  return [...out.values()];
}

/** One cell as the grid shows it. A cell nobody has answered yet says so; a failed pass says why. */
export function cellOf(row: Row | undefined): TableCell {
  if (!row) return { status: "pending", answer: null, page: null, quote: null, note: null };
  const status = row.status as TableCell["status"];
  return {
    status,
    answer: (row.answer as string | null) ?? null,
    page: (row.page as number | null) ?? null,
    quote: (row.quote as string | null) ?? null,
    note: (row.note as string | null) ?? null,
  };
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}

/** The grid as CSV: a header row of column questions, then one row per document. Pages ride the cell as "p. N". */
export function toCsv(view: TableView): string {
  const header = ["Document", ...view.columns.map(c => c.question)];
  const lines = [header.map(csvField).join(",")];
  for (const r of view.rows) {
    const cells = view.columns.map(c => {
      const cell = r.cells[c.key];
      if (!cell || cell.status === "pending" || cell.status === "running") return "";
      if (cell.status === "failed") return cell.note ? `(${cell.note})` : "(could not answer)";
      const text = cell.answer ?? "not stated";
      return cell.page !== null ? `${text} (p. ${cell.page})` : text;
    });
    lines.push([r.title, ...cells].map(csvField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** A stable key for a lawyer's question: letters and digits of its opening words plus a short hash. */
export function questionKey(question: string): string {
  const words = question.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 4).join("-");
  let h = 0;
  for (const ch of question) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `q-${words || "question"}-${h.toString(36).slice(0, 6)}`;
}

export function listQuestions(db: Db): TableColumn[] {
  const custom = db.sql<{ key: string; question: string; created_by: string }>("SELECT key, question, created_by FROM review_questions ORDER BY created_at")
    .map(r => ({ key: r.key, question: r.question, custom: true, askedBy: r.created_by }));
  return [...DEFAULT_QUESTIONS.map(q => ({ key: q.key, question: q.question, custom: false, askedBy: null })), ...custom];
}

export function addQuestion(db: Db, question: string, by: string): TableColumn {
  const clean = question.replace(/\s+/g, " ").trim();
  if (clean.length < 4) throw new Error("Ask a question the firm can answer for each document.");
  if (clean.length > 300) throw new Error("Keep the question under 300 characters.");
  const key = questionKey(clean);
  db.sql("INSERT INTO review_questions(key, question, created_by, created_at) VALUES(?, ?, ?, ?) ON CONFLICT(key) DO NOTHING", key, clean, by, db.now());
  return { key, question: clean, custom: true, askedBy: by };
}

export function removeQuestion(db: Db, key: string): void {
  if (DEFAULT_QUESTIONS.some(q => q.key === key)) throw new Error("The firm's own columns stay; add or remove your questions.");
  db.sql("DELETE FROM review_questions WHERE key = ?", key);
  db.sql("DELETE FROM document_answers WHERE question_key = ?", key);
}

export function markRunning(db: Db, documentId: string, keys: string[]): void {
  for (const key of keys) {
    db.sql(`INSERT INTO document_answers(document_id, question_key, status, updated_at) VALUES(?, ?, 'running', ?)
            ON CONFLICT(document_id, question_key) DO UPDATE SET status = 'running', note = NULL, updated_at = excluded.updated_at`,
      documentId, key, db.now());
  }
}

export function recordAnswers(db: Db, documentId: string, answers: AnswerInput[]): void {
  for (const a of answers) {
    db.sql(`INSERT INTO document_answers(document_id, question_key, answer, page, quote, status, note, updated_at) VALUES(?, ?, ?, ?, ?, 'answered', NULL, ?)
            ON CONFLICT(document_id, question_key) DO UPDATE SET answer = excluded.answer, page = excluded.page, quote = excluded.quote,
            status = 'answered', note = NULL, updated_at = excluded.updated_at`,
      documentId, a.key, a.answer, a.page, a.quote, db.now());
  }
}

export function recordFailure(db: Db, documentId: string, keys: string[], note: string): void {
  for (const key of keys) {
    db.sql(`INSERT INTO document_answers(document_id, question_key, status, note, updated_at) VALUES(?, ?, 'failed', ?, ?)
            ON CONFLICT(document_id, question_key) DO UPDATE SET status = 'failed', note = excluded.note, updated_at = excluded.updated_at`,
      documentId, key, note.slice(0, 300), db.now());
  }
}

/** Which model-answered keys a document still lacks (never answered, or failed). */
export function missingKeys(db: Db, documentId: string, keys: string[]): string[] {
  const have = new Set(db.sql<{ question_key: string }>("SELECT question_key FROM document_answers WHERE document_id = ? AND status IN ('answered','running')", documentId).map(r => r.question_key));
  return keys.filter(k => !have.has(k));
}

export function answersFor(db: Db, documentIds: string[]): Map<string, Map<string, Row>> {
  const out = new Map<string, Map<string, Row>>();
  if (documentIds.length === 0) return out;
  const rows = db.sql(`SELECT * FROM document_answers WHERE document_id IN (${documentIds.map(() => "?").join(",")})`, ...documentIds);
  for (const r of rows) {
    const byKey = out.get(r.document_id as string) ?? new Map<string, Row>();
    byKey.set(r.question_key as string, r);
    out.set(r.document_id as string, byKey);
  }
  return out;
}
