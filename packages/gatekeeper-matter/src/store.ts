// MatterStore: one Durable Object per matter, holding the whole case file in its own SQLite
// database with the document bytes in R2. Nothing here talks to a model; the reading pipeline
// (ingest.ts) calls the state transitions below and the Session (matter.ts) reads through them.
//
// Every ingest state is honest (Counsel OS invariant 1): a document is `ready` only when a reader
// actually produced its facts, `empty` when it read cleanly and stated nothing usable, `failed`
// only after retries, and a transient provider failure re-queues rather than degrading.

import { DurableObject } from "cloudflare:workers";
import { filenameFamily, foldText } from "./pure.js";
import type {
  ActivityEntry, Decision, DeskFile, DocumentSummary, DocumentText, Fact, FactFilter,
  IngestStatus, MatterOverview, TextHit, Uploader,
} from "./types.js";

export type MatterMeta = {
  id: string;
  title: string;
  caseType: string | null;
  clientName: string;
  ownerAccountId: string;
  status: "open" | "paused" | "closed";
  createdAt: string;
};

export { filenameFamily, foldText };
export type IngestMessage = { matterId: string; documentId: string };

export type UnderstoodFact = {
  statement: string;
  quote: string;
  page: number | null;
  occurredOn: string | null;
  dateAmbiguous: boolean;
  significance: string | null;
  confidence: number;
};

export type Understanding = {
  docType: string | null;
  displayTitle: string | null;
  facts: UnderstoodFact[];
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  display_title TEXT,
  doc_type TEXT,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  text_key TEXT,
  page_count INTEGER,
  text_length INTEGER,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL,
  relevance TEXT NOT NULL DEFAULT 'included',
  superseded_by TEXT,
  exhibit_no INTEGER,
  note TEXT,
  uploaded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS ix_documents_sha ON documents(sha256);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page INTEGER,
  statement TEXT NOT NULL,
  quote TEXT NOT NULL,
  occurred_on TEXT,
  date_ambiguous INTEGER NOT NULL DEFAULT 0,
  significance TEXT,
  confidence REAL NOT NULL,
  verified_by TEXT,
  verified_at TEXT,
  extraction_v INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_facts_document ON facts(document_id);
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(id UNINDEXED, statement, quote);
CREATE TABLE IF NOT EXISTS desk_files (
  path TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  rev INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS desk_revisions (
  path TEXT NOT NULL, rev INTEGER NOT NULL, content TEXT NOT NULL,
  updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (path, rev)
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  status TEXT NOT NULL,
  answer TEXT,
  raised_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE TABLE IF NOT EXISTS activity (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  summary TEXT NOT NULL
);
`;

// The reader's output contract. Bump when the understand prompt or fact shape changes so every
// document re-queues for a fresh read instead of mixing two vintages of facts on one record.
export const EXTRACTION_VERSION = 1;
const MAX_READ_ATTEMPTS = 4;
const FIND_WINDOW = 150;

function now(): string { return new Date().toISOString(); }
function newId(): string { return crypto.randomUUID().replace(/-/g, ""); }

export class MatterStore extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => { ctx.storage.sql.exec(SCHEMA); });
  }

  #sql<T = Record<string, unknown>>(query: string, ...params: unknown[]): T[] {
    return this.ctx.storage.sql.exec(query, ...params).toArray() as T[];
  }

  #metaGet(key: string): string | null {
    const row = this.#sql<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)[0];
    return row?.value ?? null;
  }

  #metaSet(key: string, value: string): void {
    this.#sql("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  #log(actor: string, summary: string): void {
    this.#sql("INSERT INTO activity(at, actor, summary) VALUES(?, ?, ?)", now(), actor, summary);
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  async init(meta: Omit<MatterMeta, "status" | "createdAt">): Promise<MatterMeta> {
    const existing = await this.meta();
    if (existing) return existing;
    const full: MatterMeta = { ...meta, status: "open", createdAt: now() };
    this.#metaSet("matter", JSON.stringify(full));
    this.#log("lawyer", `Opened the matter "${meta.title}" for ${meta.clientName}.`);
    return full;
  }

  async meta(): Promise<MatterMeta | null> {
    const raw = this.#metaGet("matter");
    return raw ? JSON.parse(raw) as MatterMeta : null;
  }

  async #requireMeta(): Promise<MatterMeta> {
    const meta = await this.meta();
    if (!meta) throw new Error("This matter does not exist.");
    return meta;
  }

  async setCaseType(caseType: string, actor: string): Promise<void> {
    const meta = await this.#requireMeta();
    this.#metaSet("matter", JSON.stringify({ ...meta, caseType }));
    this.#log(actor, `Set the matter type to ${caseType}.`);
  }

  async setStatus(status: MatterMeta["status"], actor: string): Promise<void> {
    const meta = await this.#requireMeta();
    this.#metaSet("matter", JSON.stringify({ ...meta, status }));
    this.#log(actor, status === "paused" ? "Stopped all work on the matter." : `Matter is now ${status}.`);
  }

  async note(actor: string, summary: string): Promise<void> {
    this.#log(actor, summary.slice(0, 2000));
  }

  async activity(limit = 50): Promise<ActivityEntry[]> {
    return this.#sql<ActivityEntry>(
      "SELECT at, actor, summary FROM activity ORDER BY seq DESC LIMIT ?", Math.min(limit, 500));
  }

  // ---- overview --------------------------------------------------------------------------------

  async overview(): Promise<MatterOverview> {
    const meta = await this.#requireMeta();
    const counts: Record<string, number> = {};
    for (const row of this.#sql<{ status: string; n: number }>(
        "SELECT status, COUNT(*) AS n FROM documents GROUP BY status")) {
      counts[row.status] = row.n;
    }
    const facts = this.#sql<{ n: number }>("SELECT COUNT(*) AS n FROM facts")[0]?.n ?? 0;
    const openDecisions = this.#sql<{ n: number }>(
      "SELECT COUNT(*) AS n FROM decisions WHERE status = 'open'")[0]?.n ?? 0;
    const plan = this.#sql<{ content: string }>("SELECT content FROM desk_files WHERE path = 'plan.md'")[0];
    const reading = (counts.queued ?? 0) + (counts.reading ?? 0);
    return {
      id: meta.id,
      title: meta.title,
      caseType: meta.caseType,
      clientName: meta.clientName,
      status: meta.status,
      record: {
        documents: Object.values(counts).reduce((a, b) => a + b, 0),
        reading,
        ready: counts.ready ?? 0,
        empty: counts.empty ?? 0,
        failed: counts.failed ?? 0,
        superseded: counts.superseded ?? 0,
        facts,
        stillArriving: reading > 0,
      },
      needsYou: { openDecisions, unreadableDocuments: counts.failed ?? 0 },
      lastReadNote: this.#sql<{ note: string }>(
        "SELECT note FROM documents WHERE note IS NOT NULL AND status IN ('queued','reading','failed') ORDER BY updated_at DESC LIMIT 1")[0]?.note ?? null,
      planHead: plan ? plan.content.split("\n").slice(0, 12).join("\n") : null,
      today: now().slice(0, 10),
    };
  }

  // ---- documents -------------------------------------------------------------------------------

  #docRow(reference: string): Record<string, unknown> | undefined {
    return this.#sql("SELECT * FROM documents WHERE id = ? OR filename = ? ORDER BY uploaded_at DESC LIMIT 1",
      reference, reference)[0];
  }

  #toSummary(row: Record<string, unknown>, factCount: number): DocumentSummary {
    return {
      id: row.id as string,
      filename: row.filename as string,
      displayTitle: (row.display_title as string | null) ?? null,
      docType: (row.doc_type as string | null) ?? null,
      mime: row.mime as string,
      bytes: row.bytes as number,
      pageCount: (row.page_count as number | null) ?? null,
      status: row.status as IngestStatus,
      uploadedBy: row.uploaded_by as Uploader,
      relevance: row.relevance as DocumentSummary["relevance"],
      factCount,
      exhibitNo: (row.exhibit_no as number | null) ?? null,
      note: (row.note as string | null) ?? null,
      uploadedAt: row.uploaded_at as string,
    };
  }

  async listDocuments(includeSuperseded = false): Promise<DocumentSummary[]> {
    const rows = this.#sql(
      `SELECT d.*, (SELECT COUNT(*) FROM facts f WHERE f.document_id = d.id) AS fact_count
       FROM documents d ${includeSuperseded ? "" : "WHERE d.status != 'superseded'"}
       ORDER BY d.uploaded_at DESC`);
    return rows.map(r => this.#toSummary(r, r.fact_count as number));
  }

  async getDocument(reference: string): Promise<DocumentSummary | null> {
    const row = this.#docRow(reference);
    if (!row) return null;
    const n = this.#sql<{ n: number }>("SELECT COUNT(*) AS n FROM facts WHERE document_id = ?", row.id)[0]?.n ?? 0;
    return this.#toSummary(row, n);
  }

  /**
   * Register an uploaded document whose bytes the caller already put in R2 under `r2Key`.
   * An exact duplicate (same sha256) is recorded as superseded, never silently dropped.
   */
  async registerUpload(input: {
    filename: string; mime: string; bytes: number; sha256: string; r2Key: string; uploadedBy: Uploader;
  }): Promise<{ id: string; status: IngestStatus }> {
    const meta = await this.#requireMeta();
    const id = newId();
    const ts = now();
    const twin = this.#sql<{ id: string; filename: string }>(
      "SELECT id, filename FROM documents WHERE sha256 = ? AND status != 'superseded' LIMIT 1", input.sha256)[0];
    const status: IngestStatus = twin ? "superseded" : "queued";
    this.#sql(
      `INSERT INTO documents(id, filename, mime, bytes, sha256, r2_key, status, uploaded_by, superseded_by, note, uploaded_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.filename, input.mime, input.bytes, input.sha256, input.r2Key, status, input.uploadedBy,
      twin?.id ?? null, twin ? `Identical to "${twin.filename}", which stays on the record.` : null, ts, ts);
    if (twin) {
      this.#log(input.uploadedBy, `Received "${input.filename}", an exact copy of "${twin.filename}" already on the record.`);
      return { id, status };
    }
    this.#log(input.uploadedBy, `Put "${input.filename}" on the record.`);
    await this.env.INGEST_QUEUE.send({ matterId: meta.id, documentId: id } satisfies IngestMessage);
    return { id, status };
  }

  async setRelevance(reference: string, relevance: DocumentSummary["relevance"], reason: string, actor: string): Promise<void> {
    const row = this.#docRow(reference);
    if (!row) throw new Error(`No document "${reference}" on this matter.`);
    this.#sql("UPDATE documents SET relevance = ?, note = ?, updated_at = ? WHERE id = ?",
      relevance, reason, now(), row.id);
    this.#log(actor, `${relevance === "included" ? "Restored" : relevance === "excluded" ? "Set aside" : "Flagged for the attorney"} "${row.display_title ?? row.filename}": ${reason}`);
  }

  async requeue(reference: string, actor: string): Promise<void> {
    const meta = await this.#requireMeta();
    const row = this.#docRow(reference);
    if (!row) throw new Error(`No document "${reference}" on this matter.`);
    this.#sql("DELETE FROM facts WHERE document_id = ?", row.id);
    this.#sql("DELETE FROM facts_fts WHERE id IN (SELECT id FROM facts WHERE document_id = ?)", row.id);
    this.#sql("UPDATE documents SET status = 'queued', attempts = 0, note = NULL, updated_at = ? WHERE id = ?", now(), row.id);
    this.#log(actor, `Asked the firm to re-read "${row.display_title ?? row.filename}".`);
    await this.env.INGEST_QUEUE.send({ matterId: meta.id, documentId: row.id as string } satisfies IngestMessage);
  }

  // ---- ingest transitions (called only by ingest.ts) -------------------------------------------

  /** Claim a queued document for reading. Returns null when it is no longer queued (already read, superseded, or gone). */
  async claimForReading(documentId: string): Promise<{ r2Key: string; mime: string; filename: string; attempts: number } | null> {
    const row = this.#sql("SELECT * FROM documents WHERE id = ? AND status = 'queued'", documentId)[0];
    if (!row) return null;
    const attempts = (row.attempts as number) + 1;
    this.#sql("UPDATE documents SET status = 'reading', attempts = ?, updated_at = ? WHERE id = ?", attempts, now(), documentId);
    return { r2Key: row.r2_key as string, mime: row.mime as string, filename: row.filename as string, attempts };
  }

  async recordText(documentId: string, textKey: string, pageCount: number | null, textLength: number): Promise<void> {
    this.#sql("UPDATE documents SET text_key = ?, page_count = ?, text_length = ?, updated_at = ? WHERE id = ?", textKey, pageCount, textLength, now(), documentId);
  }

  async recordUnderstanding(documentId: string, u: Understanding): Promise<{ id: string; statement: string; quote: string }[]> {
    const row = this.#docRow(documentId);
    if (!row) return [];
    const stored: { id: string; statement: string; quote: string }[] = [];
    const ts = now();
    this.#sql("DELETE FROM facts_fts WHERE id IN (SELECT id FROM facts WHERE document_id = ?)", documentId);
    this.#sql("DELETE FROM facts WHERE document_id = ?", documentId);
    for (const f of u.facts) {
      const id = newId();
      this.#sql(
        `INSERT INTO facts(id, document_id, page, statement, quote, occurred_on, date_ambiguous, significance, confidence, extraction_v, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, documentId, f.page, f.statement, f.quote, f.occurredOn, f.dateAmbiguous ? 1 : 0, f.significance,
        Math.max(0, Math.min(1, f.confidence)), EXTRACTION_VERSION, ts);
      this.#sql("INSERT INTO facts_fts(id, statement, quote) VALUES(?, ?, ?)", id, f.statement, f.quote);
      stored.push({ id, statement: f.statement, quote: f.quote });
    }
    const status: IngestStatus = u.facts.length > 0 ? "ready" : "empty";
    this.#sql(
      "UPDATE documents SET status = ?, doc_type = ?, display_title = ?, note = NULL, updated_at = ? WHERE id = ?",
      status, u.docType, u.displayTitle, ts, documentId);
    const title = u.displayTitle ?? (row.filename as string);
    this.#log("system", status === "ready"
      ? `Read "${title}" (${u.docType ?? "document"}): ${u.facts.length} facts recorded.`
      : `Read "${title}" but found nothing the firm can rely on.`);
    return stored;
  }

  /** A read attempt failed. Transient failures re-queue until the attempt cap; terminal ones fail now. */
  async recordFailure(documentId: string, note: string, retryable: boolean): Promise<"requeued" | "failed"> {
    const row = this.#docRow(documentId);
    if (!row) return "failed";
    const attempts = row.attempts as number;
    if (retryable && attempts < MAX_READ_ATTEMPTS) {
      this.#sql("UPDATE documents SET status = 'queued', note = ?, updated_at = ? WHERE id = ?", note, now(), documentId);
      return "requeued";
    }
    this.#sql("UPDATE documents SET status = 'failed', note = ?, updated_at = ? WHERE id = ?", note, now(), documentId);
    this.#log("system", `Could not read "${row.display_title ?? row.filename}": ${note}`);
    return "failed";
  }

  /**
   * Mark same-family older copies superseded once a document is read. Filename family plus a
   * near-identical text length is the identity signal; anything weaker keeps both on the record.
   */
  async supersedeOlderVersions(documentId: string, textLength: number): Promise<number> {
    const row = this.#docRow(documentId);
    if (!row) return 0;
    const family = filenameFamily(row.filename as string);
    let n = 0;
    for (const other of this.#sql("SELECT * FROM documents WHERE id != ? AND status IN ('ready','empty') AND uploaded_at < ?",
        documentId, row.uploaded_at)) {
      if (filenameFamily(other.filename as string) !== family) continue;
      const otherLen = (other.text_length as number | null) ?? null;
      if (otherLen !== null && Math.abs(otherLen - textLength) / Math.max(1, textLength) > 0.08) continue;
      this.#sql("UPDATE documents SET status = 'superseded', superseded_by = ?, note = ?, updated_at = ? WHERE id = ?",
        documentId, `Older copy of "${row.filename}".`, now(), other.id);
      n++;
    }
    if (n) this.#log("system", `${n} older ${n === 1 ? "copy" : "copies"} of "${row.filename}" set aside; the newest stays on the record.`);
    return n;
  }

  /** True when no document is queued or reading. Records the settle once per drain so the wake fires once. */
  async settleIfDrained(): Promise<{ settled: boolean; summary: string | null }> {
    const pending = this.#sql<{ n: number }>("SELECT COUNT(*) AS n FROM documents WHERE status IN ('queued','reading')")[0]?.n ?? 0;
    if (pending > 0) return { settled: false, summary: null };
    const head = this.#sql<{ seq: number }>("SELECT MAX(seq) AS seq FROM activity")[0]?.seq ?? 0;
    const lastSettle = Number(this.#metaGet("settled_at_seq") ?? "0");
    if (head <= lastSettle) return { settled: false, summary: null };
    const o = await this.overview();
    const summary = `The record settled: ${o.record.ready} documents read, ${o.record.empty} empty, ${o.record.failed} unreadable, ${o.record.superseded} older copies set aside, ${o.record.facts} facts on file.`;
    this.#log("system", summary);
    const newHead = this.#sql<{ seq: number }>("SELECT MAX(seq) AS seq FROM activity")[0]?.seq ?? 0;
    this.#metaSet("settled_at_seq", String(newHead));
    return { settled: true, summary };
  }

  // ---- text ------------------------------------------------------------------------------------

  async #loadText(row: Record<string, unknown>): Promise<string> {
    const key = row.text_key as string | null;
    if (!key) throw new Error(`"${row.filename}" has not been read yet (status: ${row.status}).`);
    const obj = await this.env.MATTER_FILES.get(key);
    if (!obj) throw new Error(`The text of "${row.filename}" is missing from storage.`);
    return await obj.text();
  }

  async documentText(reference: string): Promise<DocumentText> {
    const row = this.#docRow(reference);
    if (!row) throw new Error(`No document "${reference}" on this matter.`);
    return {
      id: row.id as string,
      displayTitle: (row.display_title as string | null) ?? null,
      text: await this.#loadText(row),
      pageCount: (row.page_count as number | null) ?? null,
    };
  }

  async findInDocument(reference: string, query: string, maxResults = 8): Promise<TextHit[]> {
    const row = this.#docRow(reference);
    if (!row) throw new Error(`No document "${reference}" on this matter.`);
    const text = await this.#loadText(row);
    const folded = foldText(text);
    const needle = foldText(query);
    if (!needle) return [];
    const hits: TextHit[] = [];
    let from = 0;
    while (hits.length < maxResults) {
      const at = folded.indexOf(needle, from);
      if (at < 0) break;
      const start = Math.max(0, at - FIND_WINDOW);
      const end = Math.min(folded.length, at + needle.length + FIND_WINDOW);
      const before = folded.slice(0, at);
      const pageMarks = before.match(/=== page (\d+) ===/g);
      const page = pageMarks ? Number(pageMarks[pageMarks.length - 1].match(/\d+/)![0]) : null;
      hits.push({ page, snippet: folded.slice(start, end) });
      from = at + needle.length;
    }
    return hits;
  }

  // ---- facts -----------------------------------------------------------------------------------

  #toFact(r: Record<string, unknown>): Fact {
    return {
      id: r.id as string,
      documentId: r.document_id as string,
      documentTitle: (r.document_title as string | null) ?? (r.filename as string),
      page: (r.page as number | null) ?? null,
      statement: r.statement as string,
      quote: r.quote as string,
      occurredOn: (r.occurred_on as string | null) ?? null,
      dateAmbiguous: Boolean(r.date_ambiguous),
      significance: (r.significance as string | null) ?? null,
      confidence: r.confidence as number,
      verifiedBy: (r.verified_by as string | null) ?? null,
    };
  }

  #factSelect(): string {
    return `SELECT f.*, d.display_title AS document_title, d.filename FROM facts f JOIN documents d ON d.id = f.document_id
            WHERE d.status != 'superseded' AND d.relevance != 'excluded'`;
  }

  async facts(filter: FactFilter = {}): Promise<Fact[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.documentId) { where.push("f.document_id = ?"); params.push(filter.documentId); }
    if (filter.mentions) {
      where.push("(LOWER(f.statement) LIKE ? OR LOWER(f.quote) LIKE ?)");
      const like = `%${filter.mentions.toLowerCase()}%`;
      params.push(like, like);
    }
    if (filter.minConfidence !== undefined) { where.push("f.confidence >= ?"); params.push(filter.minConfidence); }
    const limit = Math.min(filter.limit ?? 200, 1000);
    const rows = this.#sql(
      `${this.#factSelect()} ${where.length ? "AND " + where.join(" AND ") : ""}
       ORDER BY f.confidence DESC, f.created_at ASC LIMIT ? OFFSET ?`, ...params, limit, filter.offset ?? 0);
    return rows.map(r => this.#toFact(r));
  }

  async factsByIds(ids: string[]): Promise<Fact[]> {
    if (ids.length === 0) return [];
    const marks = ids.map(() => "?").join(",");
    return this.#sql(`${this.#factSelect()} AND f.id IN (${marks})`, ...ids).map(r => this.#toFact(r));
  }

  /** Exact-word search over statements and quotes via FTS5. Returns fact ids with rank. */
  async searchExact(query: string, limit = 20, documentId?: string): Promise<{ id: string; rank: number }[]> {
    const terms = query.split(/\s+/).map(t => t.replace(/[^\p{L}\p{N}]/gu, "")).filter(t => t.length > 1);
    if (terms.length === 0) return [];
    const match = terms.map(t => `"${t}"`).join(" OR ");
    const rows = this.#sql<{ id: string; rank: number; document_id: string }>(
      `SELECT x.id, x.rank, f.document_id FROM facts_fts x JOIN facts f ON f.id = x.id
       WHERE facts_fts MATCH ? ${documentId ? "AND f.document_id = ?" : ""} ORDER BY x.rank LIMIT ?`,
      match, ...(documentId ? [documentId] : []), limit);
    return rows.map(r => ({ id: r.id, rank: r.rank }));
  }

  async verifyFact(factId: string, by: string): Promise<void> {
    this.#sql("UPDATE facts SET verified_by = ?, verified_at = ? WHERE id = ?", by, now(), factId);
  }

  // ---- desk ------------------------------------------------------------------------------------

  async deskList(): Promise<DeskFile[]> {
    return this.#sql<DeskFile & { bytes: number }>(
      "SELECT path, LENGTH(content) AS bytes, rev, updated_at AS updatedAt, updated_by AS updatedBy FROM desk_files ORDER BY path");
  }

  async deskRead(path: string): Promise<{ content: string; rev: number } | null> {
    const row = this.#sql<{ content: string; rev: number }>("SELECT content, rev FROM desk_files WHERE path = ?", path)[0];
    return row ?? null;
  }

  async deskWrite(path: string, content: string, by: string, baseRev?: number): Promise<{ rev: number }> {
    const current = await this.deskRead(path);
    if (current && baseRev !== undefined && baseRev !== current.rev) {
      throw new Error(`"${path}" changed since you read it (you had revision ${baseRev}, it is now ${current.rev}). Read it again and merge.`);
    }
    const rev = (current?.rev ?? 0) + 1;
    const ts = now();
    this.#sql(
      `INSERT INTO desk_files(path, content, rev, updated_at, updated_by) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET content = excluded.content, rev = excluded.rev, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      path, content, rev, ts, by);
    this.#sql("INSERT INTO desk_revisions(path, rev, content, updated_at, updated_by) VALUES(?, ?, ?, ?, ?)", path, rev, content, ts, by);
    return { rev };
  }

  async deskDelete(path: string): Promise<void> {
    if (path === "plan.md") throw new Error("plan.md is the matter's living plan and cannot be deleted; rewrite it instead.");
    this.#sql("DELETE FROM desk_files WHERE path = ?", path);
  }

  // ---- decisions -------------------------------------------------------------------------------

  async raiseDecision(question: string, options: string[]): Promise<{ id: string }> {
    const id = newId();
    this.#sql("INSERT INTO decisions(id, question, options, status, raised_at) VALUES(?, ?, ?, 'open', ?)",
      id, question, JSON.stringify(options), now());
    this.#log("agent", `Asked the attorney: ${question}`);
    return { id };
  }

  async answerDecision(id: string, answer: string, by: string): Promise<void> {
    this.#sql("UPDATE decisions SET status = 'answered', answer = ?, answered_at = ? WHERE id = ? AND status = 'open'",
      answer, now(), id);
    this.#log(by, `Answered: ${answer}`);
  }

  async listDecisions(): Promise<Decision[]> {
    return this.#sql<Record<string, unknown>>(
      "SELECT * FROM decisions ORDER BY (status = 'open') DESC, raised_at DESC").map(r => ({
      id: r.id as string,
      question: r.question as string,
      options: JSON.parse(r.options as string) as string[],
      status: r.status as "open" | "answered",
      answer: (r.answer as string | null) ?? null,
      raisedAt: r.raised_at as string,
      answeredAt: (r.answered_at as string | null) ?? null,
    }));
  }
}
