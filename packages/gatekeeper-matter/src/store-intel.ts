// The case intelligence tables: contradictions the firm found and the attorney ruled on, the
// review pairs (duplicates, conflicts) with their verdicts, the per-section findings, the gap
// audit, and the organize proposal. Pass state (running, note, when) lives in meta under intel:*.

import type {
  Contradiction, CriteriaFinding, GapItem, IntelRun, OrganizeProposal, ReviewPair, ReviewState,
} from "@gadgets/workshop-shared/legal";
import { parseJson, type Db, type Row } from "./store-db.js";

export const INTEL_SCHEMA = `
CREATE TABLE IF NOT EXISTS contradictions (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL,
  explanation TEXT NOT NULL, recommendation TEXT, severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT, found_at TEXT NOT NULL, decision_id TEXT, pair_key TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_contradictions_pair ON contradictions(pair_key);
CREATE TABLE IF NOT EXISTS review_pairs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, a_id TEXT NOT NULL, a_name TEXT NOT NULL, b_id TEXT NOT NULL, b_name TEXT NOT NULL,
  reason TEXT NOT NULL, verdict TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, override_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS findings (
  key TEXT PRIMARY KEY, title TEXT NOT NULL, verdict TEXT NOT NULL, strongest TEXT NOT NULL, seize TEXT NOT NULL,
  note TEXT NOT NULL, assessed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gap_items (
  id TEXT PRIMARY KEY, key TEXT NOT NULL, title TEXT NOT NULL, priority INTEGER NOT NULL, missing TEXT NOT NULL,
  ask TEXT NOT NULL, audited_at TEXT NOT NULL);
`;

export const INTEL_RUNS: IntelRun[] = ["contradictions", "duplicate", "conflict", "findings", "gaps", "strategy", "organize"];

// ---- pass state --------------------------------------------------------------------------------

export function runBegin(db: Db, run: IntelRun): boolean {
  if (db.metaGet(`intel:running:${run}`) === "1") return false;
  db.metaSet(`intel:running:${run}`, "1");
  db.metaDelete(`intel:note:${run}`);
  return true;
}

export function runEnd(db: Db, run: IntelRun, note: string | null): void {
  db.metaSet(`intel:running:${run}`, "0");
  db.metaSet(`intel:at:${run}`, db.now());
  if (note) db.metaSet(`intel:note:${run}`, note); else db.metaDelete(`intel:note:${run}`);
}

export function runState(db: Db, run: IntelRun): { running: boolean; at: string | null; note: string | null } {
  return { running: db.metaGet(`intel:running:${run}`) === "1", at: db.metaGet(`intel:at:${run}`), note: db.metaGet(`intel:note:${run}`) };
}

export function runningMap(db: Db): Record<IntelRun, boolean> {
  return Object.fromEntries(INTEL_RUNS.map(r => [r, db.metaGet(`intel:running:${r}`) === "1"])) as Record<IntelRun, boolean>;
}

// ---- contradictions ----------------------------------------------------------------------------

function pairKey(a: string, b: string): string { return [a, b].sort().join("|"); }

function toContradiction(r: Row): Contradiction {
  return {
    id: r.id as string, kind: r.kind as Contradiction["kind"], subject: r.subject as string,
    a: parseJson(r.a, {} as Contradiction["a"]), b: parseJson(r.b, {} as Contradiction["b"]),
    explanation: r.explanation as string, recommendation: (r.recommendation as string | null) ?? null, severity: r.severity as Contradiction["severity"],
    status: r.status as Contradiction["status"], resolution: (r.resolution as string | null) ?? null, foundAt: r.found_at as string,
  };
}

export function listContradictions(db: Db): Contradiction[] {
  return db.sql("SELECT * FROM contradictions ORDER BY (status = 'open') DESC, CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, found_at DESC").map(toContradiction);
}

/** Keep only new pairs: a pair already on file (open, resolved or dismissed) is never raised twice. */
export function recordContradictions(db: Db, found: Contradiction[]): Contradiction[] {
  const fresh: Contradiction[] = [];
  for (const c of found) {
    const key = pairKey(c.a.factId, c.b.factId);
    if (db.sql("SELECT 1 FROM contradictions WHERE pair_key = ?", key).length) continue;
    db.sql("INSERT INTO contradictions(id, kind, subject, a, b, explanation, recommendation, severity, status, found_at, pair_key) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)",
      c.id, c.kind, c.subject, JSON.stringify(c.a), JSON.stringify(c.b), c.explanation, c.recommendation, c.severity, c.foundAt, key);
    fresh.push(c);
  }
  return fresh;
}

export function attachDecision(db: Db, contradictionId: string, decisionId: string): void {
  db.sql("UPDATE contradictions SET decision_id = ? WHERE id = ?", decisionId, contradictionId);
}

export function resolveContradiction(db: Db, id: string, outcome: "resolved" | "dismissed", note: string, by: string): void {
  const row = db.sql("SELECT subject, decision_id FROM contradictions WHERE id = ?", id)[0];
  if (!row) throw new Error("That contradiction is not on file.");
  db.sql("UPDATE contradictions SET status = ?, resolution = ? WHERE id = ?", outcome, note.trim() || null, id);
  if (row.decision_id) db.sql("UPDATE decisions SET status = 'answered', answer = COALESCE(answer, ?), answered_at = COALESCE(answered_at, ?) WHERE id = ? AND status = 'open'",
    outcome === "resolved" ? `Resolved: ${note.trim()}` : `Dismissed: ${note.trim()}`, db.now(), row.decision_id);
  db.log(by, `${outcome === "resolved" ? "Resolved" : "Dismissed"} the contradiction about ${row.subject as string}${note.trim() ? `: ${note.trim()}` : "."}`);
}

/** The open contradiction a decision answers, so answering the card closes the finding. */
export function contradictionForDecision(db: Db, decisionId: string): string | null {
  return (db.sql<{ id: string }>("SELECT id FROM contradictions WHERE decision_id = ? AND status = 'open'", decisionId)[0]?.id) ?? null;
}

// ---- reviews -----------------------------------------------------------------------------------

function toPair(r: Row): ReviewPair {
  return {
    id: r.id as string, kind: r.kind as ReviewPair["kind"], aId: r.a_id as string, aName: r.a_name as string, bId: r.b_id as string,
    bName: r.b_name as string, reason: r.reason as string, verdict: r.verdict as ReviewPair["verdict"],
    decidedBy: (r.decided_by as ReviewPair["decidedBy"]) ?? null, overrideId: (r.override_id as string | null) ?? null,
  };
}

export function reviewState(db: Db, kind: ReviewPair["kind"]): ReviewState {
  const s = runState(db, kind);
  const pairs = db.sql("SELECT * FROM review_pairs WHERE kind = ? ORDER BY (verdict = 'pending') DESC, created_at DESC", kind).map(toPair);
  return { kind, status: s.running ? "running" : s.at ? "done" : "never", pairs, finishedAt: s.at, note: s.note };
}

/** Replace the pending candidates of a kind with a fresh set; decided pairs stay as the ledger of what was ruled. */
export function replaceCandidates(db: Db, kind: ReviewPair["kind"], pairs: { aId: string; aName: string; bId: string; bName: string; reason: string }[]): ReviewPair[] {
  db.sql("DELETE FROM review_pairs WHERE kind = ? AND verdict = 'pending'", kind);
  const out: ReviewPair[] = [];
  for (const p of pairs) {
    const decided = db.sql("SELECT 1 FROM review_pairs WHERE kind = ? AND ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)) AND verdict != 'pending'", kind, p.aId, p.bId, p.bId, p.aId).length > 0;
    if (decided) continue;
    const id = db.id();
    db.sql("INSERT INTO review_pairs(id, kind, a_id, a_name, b_id, b_name, reason, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)", id, kind, p.aId, p.aName, p.bId, p.bName, p.reason, db.now());
    out.push({ id, kind, aId: p.aId, aName: p.aName, bId: p.bId, bName: p.bName, reason: p.reason, verdict: "pending", decidedBy: null, overrideId: null });
  }
  return out;
}

export function pairRow(db: Db, id: string): ReviewPair | null {
  const r = db.sql("SELECT * FROM review_pairs WHERE id = ?", id)[0];
  return r ? toPair(r) : null;
}

export function recordVerdict(db: Db, id: string, verdict: ReviewPair["verdict"], reason: string | null, by: "firm" | "attorney", overrideId: string | null): void {
  db.sql("UPDATE review_pairs SET verdict = ?, decided_by = ?, override_id = ?, reason = COALESCE(?, reason) WHERE id = ?", verdict, by, overrideId, reason, id);
}

/** The newest override row, to tie a verdict to what the attorney can undo. */
export function latestOverrideId(db: Db): string | null {
  return (db.sql<{ id: string }>("SELECT id FROM overrides ORDER BY at DESC, rowid DESC LIMIT 1")[0]?.id) ?? null;
}

// ---- findings, gaps ----------------------------------------------------------------------------

export function listFindings(db: Db): CriteriaFinding[] {
  return db.sql("SELECT * FROM findings ORDER BY rowid").map(r => ({
    key: r.key as string, title: r.title as string, verdict: r.verdict as CriteriaFinding["verdict"],
    strongest: parseJson(r.strongest, []), officerWouldSeize: parseJson(r.seize, []), note: r.note as string,
  }));
}

export function replaceFindings(db: Db, findings: CriteriaFinding[]): void {
  db.sql("DELETE FROM findings");
  const at = db.now();
  for (const f of findings) {
    db.sql("INSERT INTO findings(key, title, verdict, strongest, seize, note, assessed_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
      f.key, f.title, f.verdict, JSON.stringify(f.strongest), JSON.stringify(f.officerWouldSeize), f.note, at);
  }
}

export function listGaps(db: Db): GapItem[] {
  return db.sql("SELECT * FROM gap_items ORDER BY priority, rowid").map(r => ({
    id: r.id as string, key: r.key as string, title: r.title as string, priority: r.priority as GapItem["priority"],
    missing: r.missing as string, ask: r.ask as string,
  }));
}

export function replaceGaps(db: Db, items: GapItem[]): void {
  db.sql("DELETE FROM gap_items");
  const at = db.now();
  for (const g of items) db.sql("INSERT INTO gap_items(id, key, title, priority, missing, ask, audited_at) VALUES(?, ?, ?, ?, ?, ?, ?)", g.id, g.key, g.title, g.priority, g.missing, g.ask, at);
}

// ---- the organize proposal ---------------------------------------------------------------------

export function readProposal(db: Db): OrganizeProposal | null {
  return parseJson<OrganizeProposal | null>(db.metaGet("intel:organize"), null);
}

export function writeProposal(db: Db, proposal: OrganizeProposal | null): void {
  if (proposal) db.metaSet("intel:organize", JSON.stringify(proposal)); else db.metaDelete("intel:organize");
}
