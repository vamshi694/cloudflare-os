// The petition tables: sections and their versions, exhibits, the letter's versions, the
// attorney's queued instructions, the coherence findings, and the government forms.

import type {
  CaseTypeSpec, GovernmentForm, Petition, PetitionSection, PetitionVersion, ReviewWeakness, SectionEvidence,
} from "@gadgets/workshop-shared/legal";
import { FORM_FIELDS, petitionTitleFor } from "./case-types.js";
import { citedExhibitNumbers, nextExhibitNumbers, wordCount, type QuoteCheck } from "./rules.js";
import { parseJson, type Db, type Row } from "./store-db.js";

export const PETITION_SCHEMA = `
CREATE TABLE IF NOT EXISTS sections (
  key TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'not_drafted', body TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
  held_reasons TEXT NOT NULL DEFAULT '[]', review TEXT, cited_facts TEXT NOT NULL DEFAULT '[]', unverified TEXT NOT NULL DEFAULT '[]',
  guidance TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS section_versions (
  key TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (key, version));
CREATE TABLE IF NOT EXISTS petition_versions (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, reason TEXT NOT NULL, sections INTEGER NOT NULL, words INTEGER NOT NULL, snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS instructions (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, section_key TEXT, instruction TEXT NOT NULL, remember INTEGER NOT NULL DEFAULT 0, resolved_at TEXT);
CREATE TABLE IF NOT EXISTS coherence (
  id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT NOT NULL, b TEXT NOT NULL, issue TEXT NOT NULL, fix TEXT NOT NULL, severity TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS forms (
  code TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'not_started', fields TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
`;

type StoredReview = { score: number; weaknesses: ReviewWeakness[]; reviewedAt: string };
type StoredField = { name: string; label: string; value: string | null; sourceFactId: string | null; acceptedBy: "attorney" | null };

export type DocumentLite = { id: string; title: string; exhibitNo: number | null; live: boolean };

/** Make sure every section of the case type has a row, so the workbench lists the whole letter. */
export function ensureSections(db: Db, spec: CaseTypeSpec | null): void {
  if (!spec) return;
  for (const s of spec.sections) db.sql("INSERT OR IGNORE INTO sections(key) VALUES(?)", s.key);
}

function sectionRows(db: Db): Map<string, Row> {
  return new Map(db.sql("SELECT * FROM sections").map(r => [r.key as string, r]));
}

function buildSection(spec: CaseTypeSpec["sections"][number], r: Row | undefined, evidence: SectionEvidence,
                      docs: DocumentLite[], factDocs: Map<string, string>, factsById: Map<string, string[]>): PetitionSection {
  const body = (r?.body as string) ?? "";
  const cited = parseJson<string[]>(r?.cited_facts, []);
  const perDoc = new Map<string, number>();
  for (const f of cited) { const d = factDocs.get(f); if (d) perDoc.set(d, (perDoc.get(d) ?? 0) + 1); }
  const docsById = new Map(docs.map(d => [d.id, d]));
  const citedNos = new Set(citedExhibitNumbers(body));
  const routed = [...new Set([...perDoc.keys()].map(id => docsById.get(id)?.exhibitNo).filter((n): n is number => n !== null && n !== undefined))];
  const review = parseJson<StoredReview | null>(r?.review, null);
  void factsById;
  return {
    key: spec.key, title: spec.title, criterion: spec.criterion, purpose: spec.purpose,
    status: ((r?.status as PetitionSection["status"]) ?? "not_drafted"),
    body, words: wordCount(body), version: (r?.version as number) ?? 0,
    heldReasons: parseJson<string[]>(r?.held_reasons, []),
    evidence, review,
    builtFrom: [...perDoc.entries()].map(([id, n]) => ({ documentId: id, title: docsById.get(id)?.title ?? id, citedFacts: n })),
    uncitedExhibits: routed.filter(n => !citedNos.has(n)).sort((a, b) => a - b),
    unverifiedQuotes: parseJson<PetitionSection["unverifiedQuotes"]>(r?.unverified, []),
    guidance: (r?.guidance as string | null) ?? null,
    updatedAt: (r?.updated_at as string | null) ?? null,
  };
}

export function petitionView(db: Db, spec: CaseTypeSpec | null, docs: DocumentLite[], factDocs: Map<string, string>,
                             evidenceByKey: Map<string, SectionEvidence>, orderedSections?: CaseTypeSpec["sections"]): Petition {
  ensureSections(db, spec);
  const rows = sectionRows(db);
  // The letter's order comes from the firm's style guide when it defines one (firm-library.ts
  // orderSections); the catalog order is the fallback.
  const sections = (orderedSections ?? spec?.sections ?? []).map(s => buildSection(s, rows.get(s.key), evidenceByKey.get(s.key) ?? "none", docs, factDocs, new Map()));
  const liveExhibits = new Set(docs.filter(d => d.live && d.exhibitNo !== null).map(d => d.exhibitNo as number));
  const directive = parseJson<Petition["directive"]>(db.metaGet("petition_directive"), null);
  return {
    caseType: spec?.key ?? null,
    petitionTitle: petitionTitleFor(spec?.key ?? null),
    sections,
    exhibits: docs.filter(d => d.exhibitNo !== null && d.live).sort((a, b) => (a.exhibitNo! - b.exhibitNo!))
      .map(d => ({ exhibitNo: d.exhibitNo!, documentId: d.id, title: d.title })),
    directive,
    staleSections: sections.filter(s => s.body && citedExhibitNumbers(s.body).some(n => !liveExhibits.has(n))).map(s => s.key),
    coherence: db.sql("SELECT a, b, issue, fix, severity FROM coherence ORDER BY id").map(r => ({
      a: r.a as string, b: r.b as string, issue: r.issue as string, fix: r.fix as string, severity: r.severity as "high" | "medium" | "low",
    })),
    versions: listVersions(db),
    writing: sections.some(s => s.status === "drafting"),
  };
}

export function beginSection(db: Db, key: string): void {
  db.sql("INSERT INTO sections(key, status, updated_at) VALUES(?, 'drafting', ?) ON CONFLICT(key) DO UPDATE SET status = 'drafting', updated_at = excluded.updated_at", key, db.now());
}

export function writeSection(db: Db, key: string, body: string, citedFactIds: string[], unverified: QuoteCheck[], title: string): { version: number } {
  const prev = db.sql<{ version: number }>("SELECT version FROM sections WHERE key = ?", key)[0];
  const version = (prev?.version ?? 0) + 1;
  const ts = db.now();
  db.sql(`INSERT INTO sections(key, status, body, version, held_reasons, cited_facts, unverified, updated_at) VALUES(?, 'drafted', ?, ?, '[]', ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET status = 'drafted', body = excluded.body, version = excluded.version, held_reasons = '[]',
          cited_facts = excluded.cited_facts, unverified = excluded.unverified, review = NULL, updated_at = excluded.updated_at`,
    key, body, version, JSON.stringify([...new Set(citedFactIds)]), JSON.stringify(unverified), ts);
  db.sql("INSERT OR REPLACE INTO section_versions(key, version, body, at) VALUES(?, ?, ?, ?)", key, version, body, ts);
  db.log("agent", unverified.length
    ? `Drafted "${title}" (version ${version}); ${unverified.length} quote${unverified.length === 1 ? "" : "s"} could not be verified against the record.`
    : `Drafted "${title}" (version ${version}).`);
  return { version };
}

export function holdSection(db: Db, key: string, reasons: string[], title: string): void {
  db.sql(`INSERT INTO sections(key, status, held_reasons, updated_at) VALUES(?, 'held', ?, ?)
          ON CONFLICT(key) DO UPDATE SET status = 'held', held_reasons = excluded.held_reasons, updated_at = excluded.updated_at`,
    key, JSON.stringify(reasons), db.now());
  db.log("agent", `Held "${title}": ${reasons.join("; ")}`);
}

export function reviewSection(db: Db, key: string, score: number, weaknesses: ReviewWeakness[]): void {
  const review: StoredReview = { score: Math.max(0, Math.min(100, Math.round(score))), weaknesses, reviewedAt: db.now() };
  db.sql("UPDATE sections SET review = ? WHERE key = ?", JSON.stringify(review), key);
}

export function setGuidance(db: Db, key: string, guidance: string | null): void {
  db.sql("INSERT INTO sections(key, guidance) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET guidance = excluded.guidance", key, guidance);
}

export function sectionVersions(db: Db, key: string): { version: number; body: string; at: string }[] {
  return db.sql<{ version: number; body: string; at: string }>("SELECT version, body, at FROM section_versions WHERE key = ? ORDER BY version DESC", key);
}

// ---- exhibits ----------------------------------------------------------------------------------

export function assignExhibits(db: Db, orderedDocumentIds: string[]): Map<string, number> {
  const existing = new Map(db.sql<{ id: string; exhibit_no: number }>("SELECT id, exhibit_no FROM documents WHERE exhibit_no IS NOT NULL").map(r => [r.id, r.exhibit_no]));
  const next = nextExhibitNumbers(existing, orderedDocumentIds);
  for (const [id, n] of next) if (existing.get(id) !== n) db.sql("UPDATE documents SET exhibit_no = ? WHERE id = ?", n, id);
  return next;
}

// ---- directive, coherence, versions, instructions ---------------------------------------------

export function setDirective(db: Db, directive: { targetPages: number | null; text: string } | null): void {
  if (directive) db.metaSet("petition_directive", JSON.stringify(directive));
  else db.metaDelete("petition_directive");
}

export function recordCoherence(db: Db, findings: { a: string; b: string; issue: string; fix: string; severity: "high" | "medium" | "low" }[]): void {
  db.sql("DELETE FROM coherence");
  for (const f of findings) db.sql("INSERT INTO coherence(a, b, issue, fix, severity, at) VALUES(?, ?, ?, ?, ?, ?)", f.a, f.b, f.issue, f.fix, f.severity, db.now());
}

export function listVersions(db: Db): PetitionVersion[] {
  return db.sql("SELECT id, at, reason, sections, words FROM petition_versions ORDER BY at DESC").map(r => ({
    id: r.id as string, at: r.at as string, reason: r.reason as string, sections: r.sections as number, words: r.words as number,
  }));
}

export function saveVersion(db: Db, reason: string): { id: string } {
  const rows = db.sql<{ key: string; body: string }>("SELECT key, body FROM sections WHERE body != ''");
  const id = db.id();
  db.sql("INSERT INTO petition_versions(id, at, reason, sections, words, snapshot) VALUES(?, ?, ?, ?, ?, ?)",
    id, db.now(), reason, rows.length, rows.reduce((n, r) => n + wordCount(r.body), 0), JSON.stringify(rows));
  return { id };
}

export function queueInstruction(db: Db, sectionKey: string | null, instruction: string, remember: boolean): { id: string } {
  const id = db.id();
  db.sql("INSERT INTO instructions(id, at, section_key, instruction, remember) VALUES(?, ?, ?, ?, ?)", id, db.now(), sectionKey, instruction, remember ? 1 : 0);
  return { id };
}

export function pendingInstructions(db: Db): { id: string; key: string | null; instruction: string; at: string; remember: boolean }[] {
  return db.sql("SELECT * FROM instructions WHERE resolved_at IS NULL ORDER BY at").map(r => ({
    id: r.id as string, key: (r.section_key as string | null) ?? null, instruction: r.instruction as string, at: r.at as string, remember: Boolean(r.remember),
  }));
}

export function resolveInstruction(db: Db, id: string): void {
  db.sql("UPDATE instructions SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL", db.now(), id);
}

export function draftedCount(db: Db): number {
  return db.sql<{ n: number }>("SELECT COUNT(*) AS n FROM sections WHERE status = 'drafted'")[0]?.n ?? 0;
}

export function isWriting(db: Db): boolean {
  return (db.sql<{ n: number }>("SELECT COUNT(*) AS n FROM sections WHERE status = 'drafting'")[0]?.n ?? 0) > 0;
}

// ---- forms -------------------------------------------------------------------------------------

function seedFields(code: string): StoredField[] {
  return (FORM_FIELDS[code] ?? []).map(f => ({ ...f, value: null, sourceFactId: null, acceptedBy: null }));
}

export function listForms(db: Db, spec: CaseTypeSpec | null): GovernmentForm[] {
  const stored = new Map(db.sql("SELECT * FROM forms").map(r => [r.code as string, r]));
  return (spec?.forms ?? []).map(f => {
    const r = stored.get(f.code);
    const fields = r ? parseJson<StoredField[]>(r.fields, []) : seedFields(f.code);
    return {
      code: f.code, title: f.title, filedOnline: f.filedOnline,
      status: ((r?.status as GovernmentForm["status"]) ?? "not_started"),
      fields, filled: fields.filter(x => x.value !== null && x.value !== "").length, accepted: fields.filter(x => x.acceptedBy).length,
    };
  });
}

function upsertForm(db: Db, code: string, status: GovernmentForm["status"], fields: StoredField[]): void {
  db.sql(`INSERT INTO forms(code, status, fields, updated_at) VALUES(?, ?, ?, ?)
          ON CONFLICT(code) DO UPDATE SET status = excluded.status, fields = excluded.fields, updated_at = excluded.updated_at`,
    code, status, JSON.stringify(fields), db.now());
}

function formFields(db: Db, code: string): { status: GovernmentForm["status"]; fields: StoredField[] } {
  const r = db.sql("SELECT * FROM forms WHERE code = ?", code)[0];
  return r ? { status: r.status as GovernmentForm["status"], fields: parseJson<StoredField[]>(r.fields, []) } : { status: "not_started", fields: seedFields(code) };
}

export function prepareForm(db: Db, code: string): void {
  const f = formFields(db, code);
  if (f.status === "not_started") upsertForm(db, code, "opened", f.fields);
}

export function fillForm(db: Db, code: string, values: { name: string; value: string | null; sourceFactId: string | null }[]): void {
  const f = formFields(db, code);
  const fields = f.fields.map(x => {
    const v = values.find(y => y.name === x.name);
    return v ? { ...x, value: v.value, sourceFactId: v.sourceFactId, acceptedBy: x.value === v.value ? x.acceptedBy : null } : x;
  });
  for (const v of values) if (!fields.some(x => x.name === v.name)) fields.push({ name: v.name, label: v.name.replace(/_/g, " "), value: v.value, sourceFactId: v.sourceFactId, acceptedBy: null });
  upsertForm(db, code, f.status === "approved" || f.status === "signed" || f.status === "awaiting_signature" ? f.status : "for_review", fields);
}

export function acceptFormField(db: Db, code: string, name: string, value: string): void {
  const f = formFields(db, code);
  const fields = f.fields.map(x => x.name === name ? { ...x, value, acceptedBy: "attorney" as const } : x);
  if (!fields.some(x => x.name === name)) fields.push({ name, label: name.replace(/_/g, " "), value, sourceFactId: null, acceptedBy: "attorney" });
  upsertForm(db, code, f.status === "not_started" || f.status === "opened" ? "for_review" : f.status, fields);
}

export function approveForm(db: Db, code: string): void {
  const f = formFields(db, code);
  upsertForm(db, code, "approved", f.fields);
}
