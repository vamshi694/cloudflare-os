// MatterStore: one Durable Object per matter, holding the whole case file in its own SQLite
// database with the document bytes in R2. Nothing here talks to a model except the RFE read; the
// reading pipeline (ingest.ts) and the knowledge build (knowledge.ts) call the transitions below
// and the Session (matter.ts) and the lawyer's desk (desk.ts) read through them.
//
// Every ingest state is honest (Counsel OS invariant 1): a document is `ready` only when a reader
// actually produced its facts, `empty` when it read cleanly and stated nothing usable, `failed`
// only after retries, and a transient provider failure re-queues rather than degrading.
//
// The tables beyond the record live in their modules (store-knowledge, store-petition,
// store-client, store-desk); this class composes them over one Db handle.

import { DurableObject } from "cloudflare:workers";
import type {
  CaseMap, CaseTypeSpec, ClientMessage, ClientRecord, Deadline, GovernmentForm, MatterStatusLine, NeedsYouItem,
  Petition, PetitionSection, PortalView, Readiness,
} from "@gadgets/workshop-shared/legal";
import type { HookInitiator } from "@gadgets/workshop-shared/gatekeeper";
import type { MatterWatcherTarget } from "./matter.js";
import { CASE_TYPES, caseTypeSpec, normalizeCaseType } from "./case-types.js";
import { filenameFamily, foldText } from "./pure.js";
import { computeReadiness, derivePhase, firstNameOf, portalDocumentState, portalStatusLine } from "./rules.js";
import { firmGuidance, firmRemember, firmSectionPlan, orderSections } from "./firm-library.js";
import type { Db, Row } from "./store-db.js";
import * as K from "./store-knowledge.js";
import * as P from "./store-petition.js";
import * as C from "./store-client.js";
import * as D from "./store-desk.js";
import { letterMarkdown, simulateRfe, writeWithVerification } from "./petition.js";
import type {
  ActivityEntry, Decision, DeskFile, DocumentSummary, DocumentText, Fact, FactFilter, IngestStatus, MatterOverview,
  TextHit, Uploader,
} from "./types.js";

export type MatterMeta = {
  id: string;
  title: string;
  caseType: string | null;
  clientName: string;
  ownerAccountId: string;
  /** The workspace whose chat is this matter's conversation, once the lawyer opened one. */
  workspaceId?: string | null;
  status: "open" | "paused" | "closed";
  createdAt: string;
};

export { filenameFamily, foldText };
export type IngestMessage = { matterId: string; documentId: string } | { type: "knowledge"; matterId: string };

export type UnderstoodFact = {
  statement: string; quote: string; page: number | null; occurredOn: string | null;
  dateAmbiguous: boolean; significance: string | null; confidence: number;
};
export type Understanding = { docType: string | null; displayTitle: string | null; facts: UnderstoodFact[] };

/** The lawyer's overview: the agent's plus the status row, the needs-you list and the client signals. */
export type FullOverview = MatterOverview & {
  workspaceId: string | null; statusLine: MatterStatusLine; needsYouItems: NeedsYouItem[];
  hasClientRecord: boolean; clientMessages: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, filename TEXT NOT NULL, display_title TEXT, doc_type TEXT, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL, r2_key TEXT NOT NULL, text_key TEXT, page_count INTEGER, text_length INTEGER, status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, uploaded_by TEXT NOT NULL, relevance TEXT NOT NULL DEFAULT 'included',
  superseded_by TEXT, exhibit_no INTEGER, note TEXT, uploaded_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS ix_documents_sha ON documents(sha256);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page INTEGER,
  statement TEXT NOT NULL, quote TEXT NOT NULL, occurred_on TEXT, date_ambiguous INTEGER NOT NULL DEFAULT 0,
  significance TEXT, confidence REAL NOT NULL, verified_by TEXT, verified_at TEXT, extraction_v INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_facts_document ON facts(document_id);
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(id UNINDEXED, statement, quote);
CREATE TABLE IF NOT EXISTS activity (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL);
` + D.DESK_SCHEMA + K.KNOWLEDGE_SCHEMA + P.PETITION_SCHEMA + C.CLIENT_SCHEMA;

export const EXTRACTION_VERSION = 1;
const MAX_READ_ATTEMPTS = 4;
const FIND_WINDOW = 150;
const NARRATIVE_WINDOW_MS = 10 * 60 * 1000;

function now(): string { return new Date().toISOString(); }
function newId(): string { return crypto.randomUUID().replace(/-/g, ""); }

export class MatterStore extends DurableObject<Cloudflare.Env> {
  readonly #db: Db;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.#db = {
      sql: <T = Row>(q: string, ...p: unknown[]) => ctx.storage.sql.exec(q, ...p).toArray() as T[],
      now, id: newId,
      log: (actor, summary) => { ctx.storage.sql.exec("INSERT INTO activity(at, actor, summary) VALUES(?, ?, ?)", now(), actor, summary.slice(0, 2000)); },
      metaGet: (key) => (ctx.storage.sql.exec("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value as string | undefined) ?? null,
      metaSet: (key, value) => { ctx.storage.sql.exec("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value); },
      metaDelete: (key) => { ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", key); },
    };
    ctx.blockConcurrencyWhile(async () => { ctx.storage.sql.exec(SCHEMA); D.migrateDecisions(this.#db); });
  }

  #sql<T = Row>(query: string, ...params: unknown[]): T[] { return this.#db.sql<T>(query, ...params); }
  #log(actor: string, summary: string): void { this.#db.log(actor, summary); }
  #baseUrl(): string { return (this.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, ""); }
  /** The portal link carries the matter id and the secret as one 64-hex token, so the public route needs no global index. */
  #portalUrl(matterId: string, token: string): string { return `${this.#baseUrl()}/gatekeeper/matter/portal/${matterId}${token}`; }
  #spec(meta: MatterMeta): CaseTypeSpec | null { return caseTypeSpec(meta.caseType); }

  /**
   * The wake hook. Records the reason, then delivers it to the counsel's chat through the hook
   * initiator the overseer handed us when the attorney enabled the watch (see MatterWatchController).
   * Two wake sources only: these events and the firm's scheduler. A paused matter never wakes.
   * Events within the same 20 seconds coalesce into one delivery so a burst of uploads is one turn.
   */
  #wake(reason: string): void {
    const pending = JSON.parse(this.#db.metaGet("wake_pending") ?? "[]") as string[];
    this.#db.metaSet("wake_pending", JSON.stringify([...pending.slice(-19), reason]));
    const meta = JSON.parse(this.#db.metaGet("matter") ?? "null") as MatterMeta | null;
    if (!meta || meta.status !== "open") return;
    const initiator = this.ctx.storage.kv.get<Fetcher<HookInitiator<MatterWatcherTarget>>>("watch_initiator");
    if (!initiator) return;
    const lastAt = Number(this.#db.metaGet("wake_delivered_at") ?? 0);
    const at = Date.now();
    if (at - lastAt < 20_000) return;
    this.#db.metaSet("wake_delivered_at", String(at));
    this.ctx.waitUntil(this.#deliverWake(initiator, reason, at).catch(err => {
      this.#log("system", `Could not wake the counsel (${reason}): ${err instanceof Error ? err.message : String(err)}`);
    }));
  }

  async #deliverWake(initiator: Fetcher<HookInitiator<MatterWatcherTarget>>, reason: string, at: number): Promise<void> {
    const reasons = JSON.parse(this.#db.metaGet("wake_pending") ?? "[]") as string[];
    this.#db.metaSet("wake_pending", "[]");
    const summary = reasons.length > 1
      ? `The matter changed: ${[...new Set(reasons)].join(", ")}.`
      : `The matter changed: ${reason}.`;
    // @ts-expect-error Worker RPC promises are disposable even though the mapped type omits it.
    using hook = initiator.startHook();
    const { callback, approvalQueue } = await hook;
    await approvalQueue.authorizeObservation({
      title: "Wake the counsel", description: summary,
    });
    await callback.matterEvent({ reason, summary, at: new Date(at).toISOString() });
  }

  /** Keep the overseer's hook initiator; called when the attorney enables the watch. */
  async setWatcher(initiator: Fetcher<HookInitiator<MatterWatcherTarget>>, workspaceId: string): Promise<void> {
    this.ctx.storage.kv.put("watch_initiator", initiator);
    this.#db.metaSet("watch_workspace", workspaceId);
    this.#log("system", "The counsel is now woken when the matter changes.");
  }

  async clearWatcher(): Promise<void> {
    this.ctx.storage.kv.delete("watch_initiator");
    this.#db.metaDelete("watch_bound_at");
  }

  /** True when a watch is enabled, or was bound in the last day and awaits the attorney's enable. */
  async watchIsLive(): Promise<boolean> {
    if (this.ctx.storage.kv.get("watch_initiator")) return true;
    const boundAt = this.#db.metaGet("watch_bound_at");
    return boundAt !== null && Date.now() - Date.parse(boundAt) < 24 * 60 * 60 * 1000;
  }

  async markWatchBound(): Promise<void> { this.#db.metaSet("watch_bound_at", now()); }

  // ---- lifecycle -------------------------------------------------------------------------------

  async init(meta: Omit<MatterMeta, "status" | "createdAt">): Promise<MatterMeta> {
    const existing = await this.meta();
    if (existing) return existing;
    const full: MatterMeta = { ...meta, caseType: normalizeCaseType(meta.caseType), status: "open", createdAt: now() };
    this.#db.metaSet("matter", JSON.stringify(full));
    this.#log("lawyer", `Opened the matter "${meta.title}" for ${meta.clientName}.`);
    return full;
  }

  async meta(): Promise<MatterMeta | null> {
    const raw = this.#db.metaGet("matter");
    return raw ? JSON.parse(raw) as MatterMeta : null;
  }

  async #requireMeta(): Promise<MatterMeta> {
    const meta = await this.meta();
    if (!meta) throw new Error("This matter does not exist.");
    return meta;
  }

  #saveMeta(meta: MatterMeta): void { this.#db.metaSet("matter", JSON.stringify(meta)); }

  async setCaseType(caseType: string, actor: string): Promise<void> {
    const meta = await this.#requireMeta();
    const ct = normalizeCaseType(caseType);
    this.#saveMeta({ ...meta, caseType: ct });
    P.ensureSections(this.#db, caseTypeSpec(ct));
    this.#log(actor, `Set the matter type to ${ct}.`);
  }

  async setStatus(status: MatterMeta["status"], actor: string): Promise<void> {
    const meta = await this.#requireMeta();
    this.#saveMeta({ ...meta, status });
    this.#log(actor, status === "paused" ? "Stopped all work on the matter." : status === "open" ? "Resumed the firm's work on the matter." : `Matter is now ${status}.`);
    if (status === "open") this.#wake("resumed");
  }

  async setWorkspace(workspaceId: string): Promise<void> {
    const meta = await this.#requireMeta();
    this.#saveMeta({ ...meta, workspaceId });
  }

  async note(actor: string, summary: string): Promise<void> { this.#log(actor, summary); }

  async activity(limit = 50): Promise<ActivityEntry[]> {
    return this.#sql<ActivityEntry>("SELECT at, actor, summary FROM activity ORDER BY seq DESC LIMIT ?", Math.min(limit, 500));
  }

  async wakeRequests(): Promise<string[]> { return JSON.parse(this.#db.metaGet("wake_pending") ?? "[]") as string[]; }

  /** Delete everything: rows, bytes, texts. The account removes its index entry. */
  async destroy(): Promise<{ factIds: string[] }> {
    const meta = await this.#requireMeta();
    const factIds = this.#sql<{ id: string }>("SELECT id FROM facts").map(r => r.id);
    let cursor: string | undefined;
    do {
      const page = await this.env.MATTER_FILES.list({ prefix: `matters/${meta.id}/`, cursor });
      if (page.objects.length) await this.env.MATTER_FILES.delete(page.objects.map(o => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    await this.ctx.storage.deleteAll();
    return { factIds };
  }

  // ---- overview --------------------------------------------------------------------------------

  async overview(): Promise<FullOverview> {
    const meta = await this.#requireMeta();
    const counts: Record<string, number> = {};
    for (const row of this.#sql<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM documents GROUP BY status")) counts[row.status] = row.n;
    const facts = this.#sql<{ n: number }>("SELECT COUNT(*) AS n FROM facts")[0]?.n ?? 0;
    const openDecisions = this.#sql<{ n: number }>("SELECT COUNT(*) AS n FROM decisions WHERE status = 'open'")[0]?.n ?? 0;
    const plan = this.#sql<{ content: string }>("SELECT content FROM desk_files WHERE path = 'plan.md'")[0];
    const reading = (counts.queued ?? 0) + (counts.reading ?? 0);
    const documents = Object.values(counts).reduce((a, b) => a + b, 0);
    const planState = D.planState(this.#db);
    const phase = derivePhase({
      paused: meta.status === "paused", documents, reading, ready: counts.ready ?? 0, failed: counts.failed ?? 0,
      building: this.#db.metaGet("knowledge_building") === "1", planProposed: planState.proposed, planApproved: planState.approved,
      writing: P.isWriting(this.#db), drafted: P.draftedCount(this.#db), pendingInstructions: P.pendingInstructions(this.#db).length,
    });
    const latest = this.#sql<{ at: string; summary: string }>("SELECT at, summary FROM activity ORDER BY seq DESC LIMIT 1")[0];
    const narrative = latest && Date.now() - Date.parse(latest.at) < NARRATIVE_WINDOW_MS ? latest.summary : null;
    const today = now().slice(0, 10);
    const nextDeadline = C.listDeadlines(this.#db, today).find(d => !d.met) ?? null;
    const client = C.clientRecord(this.#db, meta.clientName, t => this.#portalUrl(meta.id, t));
    const clientMessages = this.#sql<{ n: number }>("SELECT COUNT(*) AS n FROM messages")[0]?.n ?? 0;
    return {
      id: meta.id, title: meta.title, caseType: meta.caseType, clientName: meta.clientName, status: meta.status,
      workspaceId: meta.workspaceId ?? null,
      record: {
        documents, reading, ready: counts.ready ?? 0, empty: counts.empty ?? 0, failed: counts.failed ?? 0,
        superseded: counts.superseded ?? 0, facts, stillArriving: reading > 0,
      },
      needsYou: { openDecisions, unreadableDocuments: counts.failed ?? 0 },
      lastReadNote: this.#sql<{ note: string }>(
        "SELECT note FROM documents WHERE note IS NOT NULL AND status IN ('queued','reading','failed') ORDER BY updated_at DESC LIMIT 1")[0]?.note ?? null,
      planHead: plan ? plan.content.split("\n").slice(0, 12).join("\n") : null,
      today,
      statusLine: { phase, narrative, working: phase === "reading" || phase === "knowledge" || phase === "building", nextDeadline },
      needsYouItems: D.needsYouItems(this.#db),
      hasClientRecord: client.portal !== "not_invited" || clientMessages > 0 || client.documentsSent > 0,
      clientMessages,
    };
  }

  /** One call per matter for the firm's brief. */
  async briefSlice(): Promise<{ overview: FullOverview; deadlines: Deadline[]; updatesToday: number }> {
    const overview = await this.overview();
    const since = `${overview.today}T00:00:00`;
    const updatesToday = this.#sql<{ n: number }>("SELECT COUNT(*) AS n FROM activity WHERE at >= ?", since)[0]?.n ?? 0;
    return { overview, deadlines: C.listDeadlines(this.#db, overview.today).filter(d => !d.met), updatesToday };
  }

  // ---- documents -------------------------------------------------------------------------------

  #docRow(reference: string): Row | undefined {
    return this.#sql("SELECT * FROM documents WHERE id = ? OR filename = ? ORDER BY uploaded_at DESC LIMIT 1", reference, reference)[0];
  }

  #toSummary(row: Row, factCount: number): DocumentSummary {
    return {
      id: row.id as string, filename: row.filename as string, displayTitle: (row.display_title as string | null) ?? null,
      docType: (row.doc_type as string | null) ?? null, mime: row.mime as string, bytes: row.bytes as number,
      pageCount: (row.page_count as number | null) ?? null, status: row.status as IngestStatus, uploadedBy: row.uploaded_by as Uploader,
      relevance: row.relevance as DocumentSummary["relevance"], factCount, exhibitNo: (row.exhibit_no as number | null) ?? null,
      note: (row.note as string | null) ?? null, uploadedAt: row.uploaded_at as string,
    };
  }

  async listDocuments(includeSuperseded = false): Promise<DocumentSummary[]> {
    const rows = this.#sql(
      `SELECT d.*, (SELECT COUNT(*) FROM facts f WHERE f.document_id = d.id) AS fact_count FROM documents d
       ${includeSuperseded ? "" : "WHERE d.status != 'superseded'"} ORDER BY d.uploaded_at DESC`);
    return rows.map(r => this.#toSummary(r, r.fact_count as number));
  }

  async getDocument(reference: string): Promise<DocumentSummary | null> {
    const row = this.#docRow(reference);
    if (!row) return null;
    const n = this.#sql<{ n: number }>("SELECT COUNT(*) AS n FROM facts WHERE document_id = ?", row.id)[0]?.n ?? 0;
    return this.#toSummary(row, n);
  }

  /** Where the bytes live, for the signed file route. */
  async fileInfo(documentId: string): Promise<{ r2Key: string; mime: string; filename: string } | null> {
    const row = this.#docRow(documentId);
    return row ? { r2Key: row.r2_key as string, mime: row.mime as string, filename: row.filename as string } : null;
  }

  async registerUpload(input: { filename: string; mime: string; bytes: number; sha256: string; r2Key: string; uploadedBy: Uploader }): Promise<{ id: string; status: IngestStatus }> {
    const meta = await this.#requireMeta();
    const id = newId();
    const ts = now();
    const twin = this.#sql<{ id: string; filename: string }>("SELECT id, filename FROM documents WHERE sha256 = ? AND status != 'superseded' LIMIT 1", input.sha256)[0];
    const status: IngestStatus = twin ? "superseded" : "queued";
    this.#sql(
      `INSERT INTO documents(id, filename, mime, bytes, sha256, r2_key, status, uploaded_by, superseded_by, note, uploaded_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.filename, input.mime, input.bytes, input.sha256, input.r2Key, status, input.uploadedBy,
      twin?.id ?? null, twin ? `Identical to "${twin.filename}", which stays on the record.` : null, ts, ts);
    if (twin) {
      this.#log(input.uploadedBy, `Received "${input.filename}", an exact copy of "${twin.filename}" already on the record.`);
      return { id, status };
    }
    this.#log(input.uploadedBy, `Put "${input.filename}" on the record.`);
    await this.env.INGEST_QUEUE.send({ matterId: meta.id, documentId: id });
    return { id, status };
  }

  async setRelevance(reference: string, relevance: DocumentSummary["relevance"], reason: string, actor: string): Promise<void> {
    const row = this.#docRow(reference);
    if (!row) throw new Error(`No document "${reference}" on this matter.`);
    this.#sql("UPDATE documents SET relevance = ?, note = ?, updated_at = ? WHERE id = ?", relevance, reason, now(), row.id);
    this.#log(actor, `${relevance === "included" ? "Restored" : relevance === "excluded" ? "Set aside" : "Flagged for the attorney"} "${row.display_title ?? row.filename}": ${reason}`);
    if (relevance === "excluded") K.retireDocumentClaims(this.#db, row.id as string);
    else K.recomputeSalience(this.#db);
  }

  async requeue(reference: string, actor: string): Promise<void> {
    const meta = await this.#requireMeta();
    const row = this.#docRow(reference);
    if (!row) throw new Error(`No document "${reference}" on this matter.`);
    this.#sql("DELETE FROM facts_fts WHERE id IN (SELECT id FROM facts WHERE document_id = ?)", row.id);
    this.#sql("DELETE FROM facts WHERE document_id = ?", row.id);
    this.#sql("UPDATE documents SET status = 'queued', attempts = 0, note = NULL, updated_at = ? WHERE id = ?", now(), row.id);
    this.#log(actor, `Asked the firm to re-read "${row.display_title ?? row.filename}".`);
    await this.env.INGEST_QUEUE.send({ matterId: meta.id, documentId: row.id as string });
  }

  /** Remove a document and its earlier versions; its facts and the claims resting only on them retire. */
  async removeDocument(documentId: string, actor: string): Promise<{ factIds: string[] }> {
    const row = this.#docRow(documentId);
    if (!row) throw new Error("No such document on this matter.");
    const ids = [row.id as string, ...this.#sql<{ id: string }>("SELECT id FROM documents WHERE superseded_by = ?", row.id).map(r => r.id)];
    const retired = K.retireDocumentClaims(this.#db, row.id as string);
    const factIds: string[] = [];
    for (const id of ids) {
      const r = this.#sql("SELECT r2_key, text_key FROM documents WHERE id = ?", id)[0];
      factIds.push(...this.#sql<{ id: string }>("SELECT id FROM facts WHERE document_id = ?", id).map(f => f.id));
      this.#sql("DELETE FROM facts_fts WHERE id IN (SELECT id FROM facts WHERE document_id = ?)", id);
      this.#sql("DELETE FROM facts WHERE document_id = ?", id);
      this.#sql("DELETE FROM documents WHERE id = ?", id);
      const keys = [r?.r2_key, r?.text_key].filter((k): k is string => typeof k === "string");
      if (keys.length) await this.env.MATTER_FILES.delete(keys);
    }
    this.#sql("DELETE FROM claim_facts WHERE fact_id NOT IN (SELECT id FROM facts)");
    this.#log(actor, `Removed "${row.display_title ?? row.filename}"${ids.length > 1 ? ` and ${ids.length - 1} earlier version${ids.length > 2 ? "s" : ""}` : ""} from the record; ${retired} claim${retired === 1 ? "" : "s"} retired with it.`);
    return { factIds };
  }

  /** The firm's read of one document: filed as, evidence for, how it is used, what it says, its versions. */
  async dossier(documentId: string): Promise<{ filedAs: string | null; evidenceFor: string[]; roleInCase: string | null; summary: string | null;
    versions: { id: string; version: number; filename: string; uploadedAt: string; current: boolean }[] } | null> {
    const row = this.#docRow(documentId);
    if (!row) return null;
    const facts = this.#sql<{ significance: string | null; statement: string }>("SELECT significance, statement FROM facts WHERE document_id = ? ORDER BY confidence DESC LIMIT 6", row.id);
    const older = this.#sql("SELECT id, filename, uploaded_at FROM documents WHERE superseded_by = ? ORDER BY uploaded_at", row.id);
    const versions = [...older.map((o, i) => ({ id: o.id as string, version: i + 1, filename: o.filename as string, uploadedAt: o.uploaded_at as string, current: false })),
      { id: row.id as string, version: older.length + 1, filename: row.filename as string, uploadedAt: row.uploaded_at as string, current: true }];
    return {
      filedAs: (row.doc_type as string | null) ?? null,
      evidenceFor: K.documentSupports(this.#db, row.id as string),
      roleInCase: facts.length ? [...new Set(facts.map(f => f.significance).filter(Boolean))].slice(0, 3).join("; ") || null : null,
      summary: facts.length ? facts.map(f => f.statement).join(" ") : null,
      versions,
    };
  }

  async setSupports(documentId: string, criteria: string[], actor: string): Promise<void> {
    const row = this.#docRow(documentId);
    if (!row) throw new Error("No such document on this matter.");
    const n = K.setDocumentSupports(this.#db, row.id as string, criteria);
    this.#log(actor, `Pinned "${row.display_title ?? row.filename}" to ${criteria.join(", ") || "no section"}; ${n} claim${n === 1 ? "" : "s"} refiled.`);
  }

  // ---- ingest transitions (called only by ingest.ts) -------------------------------------------

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
        `INSERT INTO facts(id, document_id, page, statement, quote, occurred_on, date_ambiguous, significance, confidence, extraction_v, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, documentId, f.page, f.statement, f.quote, f.occurredOn, f.dateAmbiguous ? 1 : 0, f.significance, Math.max(0, Math.min(1, f.confidence)), EXTRACTION_VERSION, ts);
      this.#sql("INSERT INTO facts_fts(id, statement, quote) VALUES(?, ?, ?)", id, f.statement, f.quote);
      stored.push({ id, statement: f.statement, quote: f.quote });
    }
    const status: IngestStatus = u.facts.length > 0 ? "ready" : "empty";
    this.#sql("UPDATE documents SET status = ?, doc_type = ?, display_title = ?, note = NULL, updated_at = ? WHERE id = ?", status, u.docType, u.displayTitle, ts, documentId);
    const title = u.displayTitle ?? (row.filename as string);
    this.#log("system", status === "ready" ? `Read "${title}" (${u.docType ?? "document"}): ${u.facts.length} facts recorded.` : `Read "${title}" but found nothing the firm can rely on.`);
    return stored;
  }

  async recordFailure(documentId: string, note: string, retryable: boolean): Promise<"requeued" | "failed"> {
    const row = this.#docRow(documentId);
    if (!row) return "failed";
    if (retryable && (row.attempts as number) < MAX_READ_ATTEMPTS) {
      this.#sql("UPDATE documents SET status = 'queued', note = ?, updated_at = ? WHERE id = ?", note, now(), documentId);
      return "requeued";
    }
    this.#sql("UPDATE documents SET status = 'failed', note = ?, updated_at = ? WHERE id = ?", note, now(), documentId);
    this.#log("system", `Could not read "${row.display_title ?? row.filename}": ${note}`);
    return "failed";
  }

  async supersedeOlderVersions(documentId: string, textLength: number): Promise<number> {
    const row = this.#docRow(documentId);
    if (!row) return 0;
    const family = filenameFamily(row.filename as string);
    let n = 0;
    for (const other of this.#sql("SELECT * FROM documents WHERE id != ? AND status IN ('ready','empty') AND uploaded_at < ?", documentId, row.uploaded_at)) {
      if (filenameFamily(other.filename as string) !== family) continue;
      const otherLen = (other.text_length as number | null) ?? null;
      if (otherLen !== null && Math.abs(otherLen - textLength) / Math.max(1, textLength) > 0.08) continue;
      this.#sql("UPDATE documents SET status = 'superseded', superseded_by = ?, note = ?, updated_at = ? WHERE id = ?", documentId, `Older copy of "${row.filename}".`, now(), other.id);
      n++;
    }
    if (n) this.#log("system", `${n} older ${n === 1 ? "copy" : "copies"} of "${row.filename}" set aside; the newest stays on the record.`);
    return n;
  }

  /** True when no document is queued or reading. Settling once per drain queues the knowledge build and the wake. */
  async settleIfDrained(): Promise<{ settled: boolean; summary: string | null }> {
    const pending = this.#sql<{ n: number }>("SELECT COUNT(*) AS n FROM documents WHERE status IN ('queued','reading')")[0]?.n ?? 0;
    if (pending > 0) return { settled: false, summary: null };
    const head = this.#sql<{ seq: number }>("SELECT MAX(seq) AS seq FROM activity")[0]?.seq ?? 0;
    if (head <= Number(this.#db.metaGet("settled_at_seq") ?? "0")) return { settled: false, summary: null };
    const o = await this.overview();
    const summary = `The record settled: ${o.record.ready} documents read, ${o.record.empty} empty, ${o.record.failed} unreadable, ${o.record.superseded} older copies set aside, ${o.record.facts} facts on file.`;
    this.#log("system", summary);
    this.#db.metaSet("settled_at_seq", String(this.#sql<{ seq: number }>("SELECT MAX(seq) AS seq FROM activity")[0]?.seq ?? 0));
    if (o.record.facts > 0) await this.requestRebuild("system");
    this.#wake("record settled");
    return { settled: true, summary };
  }

  // ---- text ------------------------------------------------------------------------------------

  async #loadText(row: Row): Promise<string> {
    const key = row.text_key as string | null;
    if (!key) throw new Error(`"${row.filename}" has not been read yet (status: ${row.status}).`);
    const obj = await this.env.MATTER_FILES.get(key);
    if (!obj) throw new Error(`The text of "${row.filename}" is missing from storage.`);
    return await obj.text();
  }

  async #textOf(documentId: string): Promise<string | undefined> {
    const row = this.#docRow(documentId);
    if (!row) return undefined;
    try { return await this.#loadText(row); } catch { return undefined; }
  }

  async documentText(reference: string): Promise<DocumentText> {
    const row = this.#docRow(reference);
    if (!row) throw new Error(`No document "${reference}" on this matter.`);
    return { id: row.id as string, displayTitle: (row.display_title as string | null) ?? null, text: await this.#loadText(row), pageCount: (row.page_count as number | null) ?? null };
  }

  async findInDocument(reference: string, query: string, maxResults = 8): Promise<TextHit[]> {
    const row = this.#docRow(reference);
    if (!row) throw new Error(`No document "${reference}" on this matter.`);
    const folded = foldText(await this.#loadText(row));
    const needle = foldText(query);
    if (!needle) return [];
    const hits: TextHit[] = [];
    let from = 0;
    while (hits.length < maxResults) {
      const at = folded.indexOf(needle, from);
      if (at < 0) break;
      const pageMarks = folded.slice(0, at).match(/=== page (\d+) ===/g);
      const page = pageMarks ? Number(pageMarks[pageMarks.length - 1].match(/\d+/)![0]) : null;
      hits.push({ page, snippet: folded.slice(Math.max(0, at - FIND_WINDOW), Math.min(folded.length, at + needle.length + FIND_WINDOW)) });
      from = at + needle.length;
    }
    return hits;
  }

  // ---- facts -----------------------------------------------------------------------------------

  #toFact(r: Row): Fact {
    return {
      id: r.id as string, documentId: r.document_id as string, documentTitle: (r.document_title as string | null) ?? (r.filename as string),
      page: (r.page as number | null) ?? null, statement: r.statement as string, quote: r.quote as string,
      occurredOn: (r.occurred_on as string | null) ?? null, dateAmbiguous: Boolean(r.date_ambiguous),
      significance: (r.significance as string | null) ?? null, confidence: r.confidence as number, verifiedBy: (r.verified_by as string | null) ?? null,
    };
  }

  #factSelect(): string {
    return `SELECT f.*, d.display_title AS document_title, d.filename FROM facts f JOIN documents d ON d.id = f.document_id WHERE d.status != 'superseded' AND d.relevance != 'excluded'`;
  }

  async facts(filter: FactFilter = {}): Promise<Fact[]> {
    const where: string[] = []; const params: unknown[] = [];
    if (filter.documentId) { where.push("f.document_id = ?"); params.push(filter.documentId); }
    if (filter.mentions) { where.push("(LOWER(f.statement) LIKE ? OR LOWER(f.quote) LIKE ?)"); const like = `%${filter.mentions.toLowerCase()}%`; params.push(like, like); }
    if (filter.minConfidence !== undefined) { where.push("f.confidence >= ?"); params.push(filter.minConfidence); }
    const rows = this.#sql(`${this.#factSelect()} ${where.length ? "AND " + where.join(" AND ") : ""} ORDER BY f.confidence DESC, f.created_at ASC LIMIT ? OFFSET ?`,
      ...params, Math.min(filter.limit ?? 200, 1000), filter.offset ?? 0);
    return rows.map(r => this.#toFact(r));
  }

  async factsByIds(ids: string[]): Promise<Fact[]> {
    if (ids.length === 0) return [];
    return this.#sql(`${this.#factSelect()} AND f.id IN (${ids.map(() => "?").join(",")})`, ...ids).map(r => this.#toFact(r));
  }

  async searchExact(query: string, limit = 20, documentId?: string): Promise<{ id: string; rank: number }[]> {
    const terms = query.split(/\s+/).map(t => t.replace(/[^\p{L}\p{N}]/gu, "")).filter(t => t.length > 1);
    if (terms.length === 0) return [];
    const rows = this.#sql<{ id: string; rank: number }>(
      `SELECT x.id, x.rank FROM facts_fts x JOIN facts f ON f.id = x.id WHERE facts_fts MATCH ? ${documentId ? "AND f.document_id = ?" : ""} ORDER BY x.rank LIMIT ?`,
      terms.map(t => `"${t}"`).join(" OR "), ...(documentId ? [documentId] : []), limit);
    return rows.map(r => ({ id: r.id, rank: r.rank }));
  }

  async verifyFact(factId: string, by: string): Promise<void> { this.#sql("UPDATE facts SET verified_by = ?, verified_at = ? WHERE id = ?", by, now(), factId); }

  // ---- desk and decisions ----------------------------------------------------------------------

  async deskList(): Promise<DeskFile[]> { return D.deskList(this.#db); }
  async deskRead(path: string): Promise<{ content: string; rev: number } | null> { return D.deskRead(this.#db, path); }
  async deskWrite(path: string, content: string, by: string, baseRev?: number): Promise<{ rev: number }> { return D.deskWrite(this.#db, path, content, by, baseRev); }
  async deskDelete(path: string): Promise<void> { D.deskDelete(this.#db, path); }

  async raiseDecision(question: string, options: string[], extras?: { detail?: string | null; recommendation?: string | null }): Promise<{ id: string }> {
    const r = D.raiseDecision(this.#db, { question, options, kind: "decision", ...extras });
    this.#wake("decision raised");
    return r;
  }

  async answerDecision(id: string, answer: string, by: string): Promise<void> {
    const row = D.answerDecision(this.#db, id, answer, by);
    if (!row) throw new Error("This decision is no longer open.");
    const declined = /^(not now|decline|deny|hold|reject|no\b)/i.test(answer.trim());
    if (row.kind === "plan") this.#db.metaSet("plan_approved", declined ? "0" : "1");
    if (row.kind === "outreach" && row.message_id) {
      if (declined) C.deleteMessage(this.#db, row.message_id as string);
      else C.markMessageSent(this.#db, row.message_id as string);
    }
    this.#wake("decision answered");
  }

  async listDecisions(): Promise<Decision[]> { return D.listDecisions(this.#db); }
  async needsYouItems(): Promise<NeedsYouItem[]> { return D.needsYouItems(this.#db); }

  async proposePlan(summary: string): Promise<{ id: string }> {
    if (!D.deskRead(this.#db, "plan.md")) throw new Error("Write plan.md on the desk before proposing the plan.");
    for (const open of this.#sql<{ id: string }>("SELECT id FROM decisions WHERE kind = 'plan' AND status = 'open'")) {
      this.#sql("UPDATE decisions SET status = 'answered', answer = 'Superseded by a newer plan', answered_at = ? WHERE id = ?", now(), open.id);
    }
    this.#db.metaSet("plan_approved", "0");
    return D.raiseDecision(this.#db, {
      question: "Approve the plan for this matter", options: ["Approve the plan — execute it", "Not now"], kind: "plan", detail: summary,
    });
  }

  async planApproved(): Promise<boolean> { return this.#db.metaGet("plan_approved") === "1"; }

  // ---- case knowledge --------------------------------------------------------------------------

  async caseMap(): Promise<CaseMap> { return K.listMap(this.#db); }
  async addClaim(input: Parameters<typeof K.addClaim>[1], source: "firm" | "attorney"): Promise<{ id: string } | null> {
    const r = K.addClaim(this.#db, input, source);
    if (r) K.recomputeSalience(this.#db);
    return r;
  }
  async retagClaim(id: string, criteria: string[], by: "attorney" | "firm"): Promise<void> { K.retagClaim(this.#db, id, criteria, by); K.recomputeSalience(this.#db); }
  async setClaimRemoved(id: string, removed: boolean, by: "attorney" | "firm"): Promise<void> { K.setClaimRemoved(this.#db, id, removed, by); K.recomputeSalience(this.#db); }
  async renameEntity(id: string, name: string, by: "attorney" | "firm"): Promise<void> { K.renameEntity(this.#db, id, name, by); }
  async describeEntity(id: string, description: string): Promise<void> { K.describeEntity(this.#db, id, description); }
  async mergeEntities(keepId: string, mergeId: string, reason: string, by: "attorney" | "firm"): Promise<void> { K.mergeEntities(this.#db, keepId, mergeId, reason, by); K.recomputeSalience(this.#db); }
  async revertOverride(id: string): Promise<void> { K.revertOverride(this.#db, id); }
  async pinEntity(id: string): Promise<void> { K.pinEntity(this.#db, id); }

  async readiness(): Promise<Readiness> {
    const meta = await this.#requireMeta();
    const spec = this.#spec(meta);
    // The client ask says what the FIRM's playbook says proves each criterion (firm-library.ts).
    return computeReadiness(spec, K.readinessInputs(this.#db), now(), await firmGuidance(this.env, spec));
  }

  async caseTypes(): Promise<CaseTypeSpec[]> { return CASE_TYPES; }

  /** Queue a rebuild of the case knowledge. The consumer (knowledge.ts) does the work. */
  async requestRebuild(actor: string): Promise<void> {
    const meta = await this.#requireMeta();
    if (this.#db.metaGet("knowledge_building") === "1") return;
    this.#db.metaSet("knowledge_building", "1");
    if (actor !== "system") this.#log(actor, "Asked the firm to rebuild the case knowledge from the record.");
    await this.env.INGEST_QUEUE.send({ type: "knowledge", matterId: meta.id });
  }

  /** The consumer's hooks around a build. */
  async knowledgeBuildBegin(): Promise<void> { this.#db.metaSet("knowledge_building", "1"); K.clearForRebuild(this.#db); }
  async knowledgeBuildEnd(fromDocuments: number, note: string | null): Promise<void> {
    K.reapplyOverrides(this.#db);
    this.#db.metaSet("knowledge_building", "0");
    this.#db.metaSet("knowledge_built_at", now());
    this.#db.metaSet("knowledge_from_documents", String(fromDocuments));
    const map = K.listMap(this.#db);
    const summary = note ?? `Built the case knowledge: ${map.entities.length} entities bound by ${map.claims.filter(c => !c.removed).length} claims, from ${fromDocuments} documents.`;
    this.#db.metaSet("knowledge_note", summary);
    this.#log("system", summary);
    this.#wake("knowledge built");
  }

  // ---- the petition ----------------------------------------------------------------------------

  async #docsLite(): Promise<P.DocumentLite[]> {
    return this.#sql("SELECT id, filename, display_title, exhibit_no, status, relevance FROM documents").map(r => ({
      id: r.id as string, title: (r.display_title as string | null) ?? (r.filename as string), exhibitNo: (r.exhibit_no as number | null) ?? null,
      live: r.status !== "superseded" && r.relevance !== "excluded",
    }));
  }

  #factDocs(): Map<string, string> {
    return new Map(this.#sql<{ id: string; document_id: string }>("SELECT id, document_id FROM facts").map(r => [r.id, r.document_id]));
  }

  async petition(): Promise<Petition> {
    const meta = await this.#requireMeta();
    const readiness = await this.readiness();
    const spec = this.#spec(meta);
    const evidence = new Map(readiness.sections.map(s => [s.key, s.evidence]));
    // The style guide's order when it defines one; the strongest criteria first, as the guide says.
    const rank = (key: string) => ({ sufficient: 0, thin: 1, none: 2 })[evidence.get(key) ?? "none"];
    const ordered = spec ? orderSections(spec, await firmSectionPlan(this.env, spec), rank) : undefined;
    return P.petitionView(this.#db, spec, await this.#docsLite(), this.#factDocs(), evidence, ordered);
  }

  async section(key: string): Promise<PetitionSection | null> { return (await this.petition()).sections.find(s => s.key === key) ?? null; }

  #sectionTitle(meta: MatterMeta, key: string): string {
    const s = this.#spec(meta)?.sections.find(x => x.key === key);
    if (!s) throw new Error(`No section "${key}" in the ${meta.caseType ?? "untyped"} petition. Set the case type first, then use the keys from knowledge().caseTypes().`);
    return s.title;
  }

  async beginSection(key: string): Promise<void> { const meta = await this.#requireMeta(); this.#sectionTitle(meta, key); P.beginSection(this.#db, key); }
  async writeSection(key: string, body: string, citedFactIds: string[]): Promise<{ version: number; unverifiedQuotes: number }> {
    const meta = await this.#requireMeta();
    if (!body.trim()) throw new Error("A section needs a body.");
    const r = await writeWithVerification(this.#db, key, this.#sectionTitle(meta, key), body, citedFactIds, id => this.#textOf(id));
    this.#db.metaDelete("rfe_cache");
    return r;
  }
  async holdSection(key: string, reasons: string[]): Promise<void> { const meta = await this.#requireMeta(); P.holdSection(this.#db, key, reasons, this.#sectionTitle(meta, key)); }
  async reviewSection(key: string, score: number, weaknesses: Parameters<typeof P.reviewSection>[3]): Promise<void> { P.reviewSection(this.#db, key, score, weaknesses); }
  async setGuidance(key: string, guidance: string | null): Promise<void> { P.setGuidance(this.#db, key, guidance); }
  async sectionVersions(key: string): Promise<{ version: number; body: string; at: string }[]> { return P.sectionVersions(this.#db, key); }
  async assignExhibits(documentIds: string[]): Promise<void> { P.assignExhibits(this.#db, documentIds); }
  async directive(): Promise<Petition["directive"]> { return (await this.petition()).directive; }
  async setDirective(directive: Petition["directive"], actor: string): Promise<void> {
    P.setDirective(this.#db, directive);
    this.#log(actor, directive ? `Set a standing directive for the letter${directive.targetPages ? ` (target ≈ ${directive.targetPages} pages)` : ""}.` : "Cleared the standing directive for the letter.");
  }
  async recordCoherence(findings: Parameters<typeof P.recordCoherence>[1]): Promise<void> { P.recordCoherence(this.#db, findings); }
  async savePetitionVersion(reason: string): Promise<{ id: string }> { return P.saveVersion(this.#db, reason); }
  async queueInstruction(sectionKey: string | null, instruction: string, remember: boolean, actor: string): Promise<{ id: string }> {
    const r = P.queueInstruction(this.#db, sectionKey, instruction, remember);
    this.#log(actor, sectionKey ? `Asked the firm to redraft a section: ${instruction.slice(0, 160)}` : `Asked the firm to reshape the letter: ${instruction.slice(0, 160)}`);
    // "Remember for all EB-1A": the rule lands in the firm's method now, from the lawyer's own
    // screen, and every later matter of the type reads it. The redraft still rides the instruction.
    if (remember && actor === "lawyer") {
      const meta = await this.#requireMeta();
      const title = sectionKey ? this.#spec(meta)?.sections.find(s => s.key === sectionKey)?.title : null;
      const scope = meta.caseType ?? "general";
      const landed = await firmRemember(this.env, scope, instruction, title ? `Attorney guidance on the '${title}' section` : "Attorney guidance on the whole letter", "lawyer");
      if (sectionKey) P.setGuidance(this.#db, sectionKey, instruction);
      this.#log("system", landed ? `Recorded a standing rule for every ${scope} matter in ${landed.slug}.` : "Could not reach the firm's playbook to record the rule; it stays on this matter only.");
    }
    this.#wake("instruction queued");
    return r;
  }
  async pendingInstructions(): Promise<ReturnType<typeof P.pendingInstructions>> { return P.pendingInstructions(this.#db); }
  async resolveInstruction(id: string): Promise<void> { P.resolveInstruction(this.#db, id); }

  async exportLetter(): Promise<{ markdown: string; versionId: string }> {
    const meta = await this.#requireMeta();
    const markdown = letterMarkdown(this.#db, this.#spec(meta), meta.clientName, now().slice(0, 10));
    const { id } = P.saveVersion(this.#db, "exported");
    this.#log("lawyer", "Exported the letter.");
    return { markdown, versionId: id };
  }

  async simulateRfe(): ReturnType<typeof simulateRfe> {
    const meta = await this.#requireMeta();
    return simulateRfe(this.#db, this.env, this.#spec(meta), letterMarkdown(this.#db, this.#spec(meta), meta.clientName, now().slice(0, 10)));
  }

  async forms(): Promise<GovernmentForm[]> { const meta = await this.#requireMeta(); return P.listForms(this.#db, this.#spec(meta)); }
  async prepareForm(code: string, actor: string): Promise<void> { P.prepareForm(this.#db, code); this.#log(actor, `Opened form ${code}.`); if (actor === "lawyer") this.#wake("form requested"); }
  async fillForm(code: string, values: Parameters<typeof P.fillForm>[2]): Promise<void> { P.fillForm(this.#db, code, values); this.#log("agent", `Filled ${values.length} field${values.length === 1 ? "" : "s"} on form ${code} from the evidence.`); }
  async acceptFormField(code: string, name: string, value: string): Promise<void> { P.acceptFormField(this.#db, code, name, value); }
  async approveForm(code: string): Promise<void> { P.approveForm(this.#db, code); this.#log("lawyer", `Approved form ${code} for the packet.`); }

  // ---- the client, messages, the portal, the docket ---------------------------------------------

  async client(): Promise<ClientRecord> { const meta = await this.#requireMeta(); return C.clientRecord(this.#db, meta.clientName, t => this.#portalUrl(meta.id, t)); }
  async setClient(input: Parameters<typeof C.setClient>[2]): Promise<ClientRecord> { const meta = await this.#requireMeta(); C.setClient(this.#db, meta.clientName, input); return this.client(); }
  async invitePortal(): Promise<{ url: string }> { const meta = await this.#requireMeta(); return { url: this.#portalUrl(meta.id, C.mintPortalToken(this.#db, meta.clientName)) }; }
  async portalTokenValid(token: string): Promise<boolean> { const meta = await this.meta(); return !!meta && C.portalToken(this.#db, meta.clientName) === token; }
  async messages(): Promise<ClientMessage[]> { return C.listMessages(this.#db); }
  async sendMessage(body: string, subject: string | null, source: "lawyer" | "client"): Promise<ClientMessage> {
    const text = body.trim();
    if (!text) throw new Error("A message needs words.");
    const m = C.addMessage(this.#db, { direction: source === "client" ? "inbound" : "outbound", subject, body: text, sent: true, source });
    this.#log(source === "client" ? "client" : "lawyer", source === "client" ? "The client replied through the portal." : "Wrote to the client.");
    if (source === "client") this.#wake("client replied");
    return m;
  }
  /** The agent's draft: recorded unsent and put on the attorney's desk as an outreach to release. */
  async draftOutreach(subject: string, body: string): Promise<{ itemId: string }> {
    const text = body.trim();
    if (!text) throw new Error("A message needs words.");
    const m = C.addMessage(this.#db, { direction: "outbound", subject: subject.trim() || null, body: text, sent: false, source: "agent" });
    const r = D.raiseDecision(this.#db, { question: "Client outreach — awaiting your release", options: ["Release & send", "Not now"], kind: "outreach", detail: text, messageId: m.id });
    return { itemId: r.id };
  }
  async releaseOutreach(itemId: string): Promise<void> {
    const row = D.decisionRow(this.#db, itemId);
    if (!row || row.kind !== "outreach") throw new Error("That is not an outreach waiting for release.");
    await this.answerDecision(itemId, "Release & send", "lawyer");
  }
  async declineItem(itemId: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error("Tell the firm why; it re-plans from your words.");
    await this.answerDecision(itemId, `Declined: ${reason.trim()}`, "lawyer");
  }
  async submissions(): Promise<{ id: string; at: string; text: string }[]> { return C.listSubmissions(this.#db); }
  async addSubmission(text: string): Promise<{ id: string }> {
    const t = text.trim();
    if (!t) throw new Error("Nothing to share.");
    const r = C.addSubmission(this.#db, t);
    this.#wake("client submission");
    return r;
  }
  async touchPortal(): Promise<void> { const meta = await this.#requireMeta(); C.touchPortal(this.#db, meta.clientName); }

  /** What the client sees. No internal ids, statuses, scores or tool names. */
  async portalView(): Promise<PortalView> {
    const meta = await this.#requireMeta();
    const o = await this.overview();
    const readiness = await this.readiness();
    const spec = this.#spec(meta);
    const docs = this.#sql("SELECT id, filename, display_title, doc_type, status FROM documents WHERE uploaded_by = 'client' AND status != 'superseded' ORDER BY uploaded_at DESC");
    const stillNeeded = readiness.stillNeeded.map(s => s.split(":")[0].trim());
    const requests = C.sentOutbound(this.#db);
    return {
      clientFirstName: firstNameOf(meta.clientName),
      caseTypeTitle: spec?.title ?? null,
      attorney: null,
      status: { line: portalStatusLine(o.statusLine.phase, spec?.title ?? null), needsClient: stillNeeded.length > 0 || requests.length > 0 },
      requests: requests.map(r => ({ id: r.id, body: r.body, at: r.at })),
      stillNeeded,
      received: docs.map(d => {
        const st = portalDocumentState(d.status as string);
        return { id: d.id as string, name: d.filename as string, state: st.state, label: st.state === "read" ? ((d.doc_type as string | null)?.replace(/_/g, " ") ?? null) : st.label };
      }),
    };
  }

  async deadlines(): Promise<Deadline[]> { return C.listDeadlines(this.#db, now().slice(0, 10)); }
  async addDeadline(input: Parameters<typeof C.addDeadline>[1], source: string): Promise<Deadline> { return C.addDeadline(this.#db, input, source, now().slice(0, 10)); }
  async markDeadlineMet(id: string, actor: string): Promise<void> { C.markDeadlineMet(this.#db, id, actor); }
}
