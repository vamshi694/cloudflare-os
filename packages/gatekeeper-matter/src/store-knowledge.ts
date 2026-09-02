// The case knowledge tables: entities, claims, the facts and entities each claim binds, and the
// ledger of overrides. Attorney edits are pinned: a rebuild replaces only what the firm wrote and
// nobody touched, then re-applies renames and merges by normalized name.

import type { CaseClaim, CaseEntity, CaseMap, CaseOverride, EntityKind } from "@gadgets/workshop-shared/legal";
import { normalizeEntityName } from "./rules.js";
import type { ClaimForReadiness } from "./rules.js";
import { parseJson, type Db, type Row } from "./store-db.js";

export const KNOWLEDGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, norm_name TEXT NOT NULL, kind TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', locked INTEGER NOT NULL DEFAULT 0, salience REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_entities_norm ON entities(norm_name);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY, statement TEXT NOT NULL, criteria TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0,
  edited_by TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS claim_facts (claim_id TEXT NOT NULL, fact_id TEXT NOT NULL, PRIMARY KEY (claim_id, fact_id));
CREATE TABLE IF NOT EXISTS claim_entities (claim_id TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY (claim_id, entity_id));
CREATE TABLE IF NOT EXISTS overrides (
  id TEXT PRIMARY KEY, by TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, at TEXT NOT NULL,
  reverted INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL);
`;

const KINDS: EntityKind[] = ["person", "organization", "project", "work_product", "publication", "achievement", "credential", "other"];

export function entityKind(raw: unknown): EntityKind {
  return KINDS.includes(raw as EntityKind) ? raw as EntityKind : "other";
}

function toEntity(r: Row): CaseEntity {
  return {
    id: r.id as string, name: r.name as string, kind: entityKind(r.kind), salience: r.salience as number,
    description: r.description as string, claimCount: (r.claim_count as number | undefined) ?? 0, locked: Boolean(r.locked),
  };
}

function toClaim(r: Row, facts: string[], entities: string[]): CaseClaim {
  return {
    id: r.id as string, statement: r.statement as string, criteria: parseJson<string[]>(r.criteria, []),
    entityIds: entities, factIds: facts, removed: Boolean(r.removed),
    editedBy: (r.edited_by as "attorney" | "firm" | null) ?? null,
  };
}

function links(db: Db, table: "claim_facts" | "claim_entities", column: "fact_id" | "entity_id"): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of db.sql<{ claim_id: string; x: string }>(`SELECT claim_id, ${column} AS x FROM ${table}`)) {
    const arr = out.get(r.claim_id) ?? [];
    arr.push(r.x);
    out.set(r.claim_id, arr);
  }
  return out;
}

export function listMap(db: Db): CaseMap {
  const entities = db.sql(
    `SELECT e.*, (SELECT COUNT(*) FROM claim_entities ce JOIN claims c ON c.id = ce.claim_id WHERE ce.entity_id = e.id AND c.removed = 0) AS claim_count
     FROM entities e ORDER BY e.salience DESC, e.name`).map(toEntity);
  const facts = links(db, "claim_facts", "fact_id");
  const ents = links(db, "claim_entities", "entity_id");
  const claims = db.sql("SELECT * FROM claims ORDER BY created_at").map(r => toClaim(r, facts.get(r.id as string) ?? [], ents.get(r.id as string) ?? []));
  const overrides: CaseOverride[] = db.sql("SELECT * FROM overrides WHERE reverted = 0 ORDER BY at DESC").map(r => ({
    id: r.id as string, by: r.by as "attorney" | "firm", kind: r.kind as CaseOverride["kind"], summary: r.summary as string,
    at: r.at as string, reverted: false,
  }));
  return {
    entities, claims, overrides,
    builtAt: db.metaGet("knowledge_built_at"),
    building: db.metaGet("knowledge_building") === "1",
    fromDocuments: Number(db.metaGet("knowledge_from_documents") ?? "0"),
    note: db.metaGet("knowledge_note"),
  };
}

/** What readiness needs from every live claim: sections, the documents behind it, and its best fact confidence. */
export function readinessInputs(db: Db): ClaimForReadiness[] {
  const rows = db.sql<{ id: string; criteria: string; removed: number; document_id: string | null; confidence: number | null }>(
    `SELECT c.id, c.criteria, c.removed, f.document_id, f.confidence FROM claims c
     LEFT JOIN claim_facts cf ON cf.claim_id = c.id
     LEFT JOIN facts f ON f.id = cf.fact_id
     LEFT JOIN documents d ON d.id = f.document_id
     WHERE d.id IS NULL OR (d.status != 'superseded' AND d.relevance != 'excluded')`);
  const byClaim = new Map<string, ClaimForReadiness>();
  for (const r of rows) {
    const c = byClaim.get(r.id) ?? { criteria: parseJson<string[]>(r.criteria, []), removed: Boolean(r.removed), documentIds: [], maxConfidence: 0 };
    if (r.document_id && !c.documentIds.includes(r.document_id)) c.documentIds.push(r.document_id);
    c.maxConfidence = Math.max(c.maxConfidence, r.confidence ?? 0);
    byClaim.set(r.id, c);
  }
  return [...byClaim.values()];
}

function findOrCreateEntity(db: Db, name: string, kind: EntityKind): string {
  const norm = normalizeEntityName(name);
  const existing = db.sql<{ id: string }>("SELECT id FROM entities WHERE norm_name = ? LIMIT 1", norm)[0];
  if (existing) return existing.id;
  const id = db.id();
  db.sql("INSERT INTO entities(id, name, norm_name, kind, created_at) VALUES(?, ?, ?, ?, ?)", id, name.trim(), norm, kind, db.now());
  return id;
}

export function addClaim(db: Db, input: { statement: string; criteria: string[]; entities: { name: string; kind: EntityKind }[]; factIds: string[] }, source: "firm" | "attorney"): { id: string } | null {
  const statement = input.statement.trim();
  if (!statement) throw new Error("A claim needs a statement.");
  const factIds = [...new Set(input.factIds)].filter(id => db.sql("SELECT 1 FROM facts WHERE id = ?", id).length > 0);
  if (factIds.length === 0) throw new Error("A claim needs at least one fact on the record.");
  // The same statement twice is one claim; a rebuild must not duplicate an attorney-edited claim.
  const dup = db.sql<{ id: string }>("SELECT id FROM claims WHERE LOWER(statement) = LOWER(?) LIMIT 1", statement)[0];
  if (dup) return null;
  const id = db.id();
  db.sql("INSERT INTO claims(id, statement, criteria, source, created_at) VALUES(?, ?, ?, ?, ?)", id, statement, JSON.stringify(input.criteria), source, db.now());
  for (const f of factIds) db.sql("INSERT OR IGNORE INTO claim_facts(claim_id, fact_id) VALUES(?, ?)", id, f);
  for (const e of input.entities) {
    if (!e.name?.trim()) continue;
    db.sql("INSERT OR IGNORE INTO claim_entities(claim_id, entity_id) VALUES(?, ?)", id, findOrCreateEntity(db, e.name, entityKind(e.kind)));
  }
  return { id };
}

function override(db: Db, by: "attorney" | "firm", kind: CaseOverride["kind"], summary: string, payload: unknown): void {
  db.sql("INSERT INTO overrides(id, by, kind, summary, at, payload) VALUES(?, ?, ?, ?, ?, ?)", db.id(), by, kind, summary, db.now(), JSON.stringify(payload));
  db.log(by === "attorney" ? "lawyer" : "agent", summary);
}

export function retagClaim(db: Db, claimId: string, criteria: string[], by: "attorney" | "firm"): void {
  const row = db.sql("SELECT statement, criteria FROM claims WHERE id = ?", claimId)[0];
  if (!row) throw new Error("No such claim on this matter.");
  db.sql("UPDATE claims SET criteria = ?, edited_by = ? WHERE id = ?", JSON.stringify(criteria), by, claimId);
  override(db, by, "retag", `Refiled the claim "${(row.statement as string).slice(0, 80)}" under ${criteria.join(", ") || "no section"}.`,
    { claimId, from: parseJson<string[]>(row.criteria, []) });
}

export function setClaimRemoved(db: Db, claimId: string, removed: boolean, by: "attorney" | "firm"): void {
  const row = db.sql("SELECT statement FROM claims WHERE id = ?", claimId)[0];
  if (!row) throw new Error("No such claim on this matter.");
  db.sql("UPDATE claims SET removed = ?, edited_by = ? WHERE id = ?", removed ? 1 : 0, by, claimId);
  if (removed) override(db, by, "remove", `Set aside the claim "${(row.statement as string).slice(0, 80)}".`, { claimId });
  else db.log(by === "attorney" ? "lawyer" : "agent", `Put the claim "${(row.statement as string).slice(0, 80)}" back into the case.`);
}

export function renameEntity(db: Db, entityId: string, name: string, by: "attorney" | "firm"): void {
  const row = db.sql("SELECT name FROM entities WHERE id = ?", entityId)[0];
  if (!row) throw new Error("No such entity on this matter.");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("An entity needs a name.");
  db.sql("UPDATE entities SET name = ?, norm_name = ?, locked = ? WHERE id = ?", trimmed, normalizeEntityName(trimmed), by === "attorney" ? 1 : 0, entityId);
  override(db, by, "rename", `Renamed "${row.name}" to "${trimmed}".`, { entityId, from: row.name, fromNorm: normalizeEntityName(row.name as string), to: trimmed });
}

export function describeEntity(db: Db, entityId: string, description: string): void {
  db.sql("UPDATE entities SET description = ? WHERE id = ?", description.trim(), entityId);
}

export function mergeEntities(db: Db, keepId: string, mergeId: string, reason: string, by: "attorney" | "firm"): void {
  const keep = db.sql("SELECT * FROM entities WHERE id = ?", keepId)[0];
  const merge = db.sql("SELECT * FROM entities WHERE id = ?", mergeId)[0];
  if (!keep || !merge) throw new Error("Both entities must be on this matter.");
  if (keepId === mergeId) return;
  if (merge.locked && by !== "attorney") throw new Error(`"${merge.name}" was fixed by the attorney and cannot be merged by the firm.`);
  const claimIds = db.sql<{ claim_id: string }>("SELECT claim_id FROM claim_entities WHERE entity_id = ?", mergeId).map(r => r.claim_id);
  for (const c of claimIds) db.sql("INSERT OR IGNORE INTO claim_entities(claim_id, entity_id) VALUES(?, ?)", c, keepId);
  db.sql("DELETE FROM claim_entities WHERE entity_id = ?", mergeId);
  db.sql("DELETE FROM entities WHERE id = ?", mergeId);
  override(db, by, "merge", `Merged "${merge.name}" into "${keep.name}": ${reason}`, {
    keepId, keepNorm: keep.norm_name, mergeNorm: merge.norm_name,
    merged: { id: mergeId, name: merge.name, kind: merge.kind, description: merge.description }, claimIds,
  });
}

export function revertOverride(db: Db, overrideId: string): void {
  const row = db.sql("SELECT * FROM overrides WHERE id = ? AND reverted = 0", overrideId)[0];
  if (!row) throw new Error("That correction is not open.");
  const p = parseJson<Record<string, unknown>>(row.payload, {});
  switch (row.kind as CaseOverride["kind"]) {
    case "rename":
      db.sql("UPDATE entities SET name = ?, norm_name = ?, locked = 0 WHERE id = ?", p.from, p.fromNorm, p.entityId);
      break;
    case "retag":
      db.sql("UPDATE claims SET criteria = ?, edited_by = NULL WHERE id = ?", JSON.stringify(p.from ?? []), p.claimId);
      break;
    case "remove":
      db.sql("UPDATE claims SET removed = 0, edited_by = NULL WHERE id = ?", p.claimId);
      break;
    case "pin":
      db.sql("UPDATE entities SET locked = 0 WHERE id = ?", p.entityId);
      break;
    case "merge": {
      const m = p.merged as { id: string; name: string; kind: string; description: string };
      db.sql("INSERT OR IGNORE INTO entities(id, name, norm_name, kind, description, created_at) VALUES(?, ?, ?, ?, ?, ?)",
        m.id, m.name, normalizeEntityName(m.name), m.kind, m.description ?? "", db.now());
      for (const c of (p.claimIds as string[]) ?? []) {
        db.sql("INSERT OR IGNORE INTO claim_entities(claim_id, entity_id) VALUES(?, ?)", c, m.id);
        db.sql("DELETE FROM claim_entities WHERE claim_id = ? AND entity_id = ?", c, p.keepId);
      }
      break;
    }
  }
  db.sql("UPDATE overrides SET reverted = 1 WHERE id = ?", overrideId);
  db.log("lawyer", `Undid: ${row.summary}`);
  recomputeSalience(db);
}

export function pinEntity(db: Db, entityId: string): void {
  const row = db.sql("SELECT name FROM entities WHERE id = ?", entityId)[0];
  if (!row) throw new Error("No such entity on this matter.");
  db.sql("UPDATE entities SET locked = 1 WHERE id = ?", entityId);
  override(db, "attorney", "pin", `Pinned "${row.name}".`, { entityId });
}

/** Salience: live claims, weighted by how many petition sections each argues in. */
export function recomputeSalience(db: Db): void {
  const rows = db.sql<{ entity_id: string; criteria: string }>(
    "SELECT ce.entity_id, c.criteria FROM claim_entities ce JOIN claims c ON c.id = ce.claim_id WHERE c.removed = 0");
  const weight = new Map<string, number>();
  for (const r of rows) weight.set(r.entity_id, (weight.get(r.entity_id) ?? 0) + 1 + 0.5 * parseJson<string[]>(r.criteria, []).length);
  db.sql("UPDATE entities SET salience = 0");
  for (const [id, v] of weight) db.sql("UPDATE entities SET salience = ? WHERE id = ?", v, id);
}

/** Drop what the firm wrote and nobody touched; keep attorney-edited claims and locked entities. */
export function clearForRebuild(db: Db): void {
  const gone = db.sql<{ id: string }>("SELECT id FROM claims WHERE source = 'firm' AND edited_by IS NULL").map(r => r.id);
  for (const id of gone) {
    db.sql("DELETE FROM claim_facts WHERE claim_id = ?", id);
    db.sql("DELETE FROM claim_entities WHERE claim_id = ?", id);
    db.sql("DELETE FROM claims WHERE id = ?", id);
  }
  db.sql("DELETE FROM entities WHERE locked = 0 AND id NOT IN (SELECT entity_id FROM claim_entities)");
}

/** After a rebuild: re-apply every open rename and merge by normalized name, then re-weigh. */
export function reapplyOverrides(db: Db): void {
  for (const row of db.sql("SELECT * FROM overrides WHERE reverted = 0 ORDER BY at")) {
    const p = parseJson<Record<string, unknown>>(row.payload, {});
    if (row.kind === "rename") {
      const stray = db.sql<{ id: string }>("SELECT id FROM entities WHERE norm_name = ? AND id != ?", p.fromNorm, p.entityId)[0];
      const kept = db.sql<{ id: string }>("SELECT id FROM entities WHERE id = ?", p.entityId)[0];
      if (stray && kept) mergeQuiet(db, kept.id, stray.id);
      else if (stray) db.sql("UPDATE entities SET name = ?, norm_name = ?, locked = 1 WHERE id = ?", p.to, normalizeEntityName(p.to as string), stray.id);
    } else if (row.kind === "merge") {
      const keep = db.sql<{ id: string }>("SELECT id FROM entities WHERE norm_name = ? LIMIT 1", p.keepNorm)[0];
      const merge = db.sql<{ id: string }>("SELECT id FROM entities WHERE norm_name = ? LIMIT 1", p.mergeNorm)[0];
      if (keep && merge && keep.id !== merge.id) mergeQuiet(db, keep.id, merge.id);
    }
  }
  recomputeSalience(db);
}

function mergeQuiet(db: Db, keepId: string, mergeId: string): void {
  for (const r of db.sql<{ claim_id: string }>("SELECT claim_id FROM claim_entities WHERE entity_id = ?", mergeId)) {
    db.sql("INSERT OR IGNORE INTO claim_entities(claim_id, entity_id) VALUES(?, ?)", r.claim_id, keepId);
  }
  db.sql("DELETE FROM claim_entities WHERE entity_id = ?", mergeId);
  db.sql("DELETE FROM entities WHERE id = ?", mergeId);
}

/** The petition sections a document's claims feed (the union), for "the firm's read". */
export function documentSupports(db: Db, documentId: string): string[] {
  const rows = db.sql<{ criteria: string }>(
    `SELECT DISTINCT c.criteria FROM claims c JOIN claim_facts cf ON cf.claim_id = c.id JOIN facts f ON f.id = cf.fact_id
     WHERE f.document_id = ? AND c.removed = 0`, documentId);
  return [...new Set(rows.flatMap(r => parseJson<string[]>(r.criteria, [])))];
}

/** Retag every claim a document grounds to exactly these sections (the attorney's pin). */
export function setDocumentSupports(db: Db, documentId: string, criteria: string[]): number {
  const ids = db.sql<{ id: string }>(
    `SELECT DISTINCT c.id FROM claims c JOIN claim_facts cf ON cf.claim_id = c.id JOIN facts f ON f.id = cf.fact_id WHERE f.document_id = ?`,
    documentId).map(r => r.id);
  for (const id of ids) db.sql("UPDATE claims SET criteria = ?, edited_by = 'attorney' WHERE id = ?", JSON.stringify(criteria), id);
  return ids.length;
}

/** Facts of a document retire with it: the claims that rested only on them are removed. */
export function retireDocumentClaims(db: Db, documentId: string): number {
  const ids = db.sql<{ id: string }>(
    `SELECT c.id FROM claims c WHERE c.removed = 0 AND NOT EXISTS (
       SELECT 1 FROM claim_facts cf JOIN facts f ON f.id = cf.fact_id JOIN documents d ON d.id = f.document_id
       WHERE cf.claim_id = c.id AND d.id != ? AND d.status != 'superseded' AND d.relevance != 'excluded')`, documentId).map(r => r.id);
  for (const id of ids) db.sql("UPDATE claims SET removed = 1 WHERE id = ?", id);
  recomputeSalience(db);
  return ids.length;
}
