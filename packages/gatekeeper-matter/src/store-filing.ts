// The filing tables: recommenders and their letters of recommendation, and the packets that were
// bound (one row per petition version that produced a binder). Deliverables stay desk files under
// deliverables/; this module only reads them for the workspace shelf. Pure SQL over the shared Db,
// plus the two model passes (suggesting recommenders, writing a letter) that take `env`.

import type { Deliverable, Filing, RecommendationLetter, Recommender } from "@gadgets/workshop-shared/legal";
import type { Fact } from "./types.js";
import { verifyQuotes, wordCount, type QuoteCheck } from "./rules.js";
import { parseJson, type Db, type Row } from "./store-db.js";

export const FILING_SCHEMA = `
CREATE TABLE IF NOT EXISTS recommenders (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, norm TEXT NOT NULL, title TEXT, organization TEXT, relationship TEXT, basis TEXT,
  status TEXT NOT NULL DEFAULT 'suggested', source TEXT NOT NULL DEFAULT 'firm', entity_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS letters (
  id TEXT PRIMARY KEY, recommender_id TEXT NOT NULL REFERENCES recommenders(id) ON DELETE CASCADE, body TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'drafted', unverified TEXT NOT NULL DEFAULT '[]',
  cited_facts TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS letter_versions (id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (id, version));
CREATE TABLE IF NOT EXISTS filings (
  version_id TEXT PRIMARY KEY, at TEXT NOT NULL, pages INTEGER NOT NULL, exhibits INTEGER NOT NULL, forms TEXT NOT NULL DEFAULT '[]',
  draft INTEGER NOT NULL DEFAULT 0, packet_sha256 TEXT NOT NULL, packet_key TEXT NOT NULL, manifest_key TEXT NOT NULL, docx_key TEXT);
`;

export function normName(s: string): string {
  return s.toLowerCase().replace(/\b(dr|prof|professor|mr|mrs|ms|phd|md)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// ---- recommenders ------------------------------------------------------------------------------

function toRecommender(r: Row): Recommender {
  return {
    id: r.id as string, name: r.name as string, title: (r.title as string | null) ?? null, organization: (r.organization as string | null) ?? null,
    relationship: (r.relationship as string | null) ?? null, basis: (r.basis as string | null) ?? null,
    status: r.status as Recommender["status"], source: r.source as Recommender["source"],
    entityId: (r.entity_id as string | null) ?? null, updatedAt: r.updated_at as string,
  };
}

export function listRecommenders(db: Db): Recommender[] {
  return db.sql("SELECT * FROM recommenders ORDER BY CASE status WHEN 'confirmed' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END, name").map(toRecommender);
}

export type RecommenderInput = { name: string; title?: string | null; organization?: string | null; relationship?: string | null; basis?: string | null; entityId?: string | null };

/** Insert or refresh by normalized name. A suggestion never overwrites what the attorney confirmed. */
export function upsertRecommender(db: Db, input: RecommenderInput, source: Recommender["source"], status: Recommender["status"]): Recommender {
  const name = input.name.trim();
  if (!name) throw new Error("A recommender needs a name.");
  const norm = normName(name);
  const existing = db.sql("SELECT * FROM recommenders WHERE norm = ?", norm)[0];
  const ts = db.now();
  if (existing) {
    const keepStatus = existing.status === "confirmed" || existing.status === "declined" ? existing.status as Recommender["status"] : status;
    db.sql(`UPDATE recommenders SET title = COALESCE(?, title), organization = COALESCE(?, organization), relationship = COALESCE(?, relationship),
            basis = COALESCE(?, basis), entity_id = COALESCE(?, entity_id), status = ?, updated_at = ? WHERE id = ?`,
      input.title ?? null, input.organization ?? null, input.relationship ?? null, input.basis ?? null, input.entityId ?? null, keepStatus, ts, existing.id);
    return toRecommender(db.sql("SELECT * FROM recommenders WHERE id = ?", existing.id)[0]);
  }
  const id = db.id();
  db.sql(`INSERT INTO recommenders(id, name, norm, title, organization, relationship, basis, status, source, entity_id, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, name, norm, input.title ?? null, input.organization ?? null, input.relationship ?? null, input.basis ?? null, status, source, input.entityId ?? null, ts, ts);
  return toRecommender(db.sql("SELECT * FROM recommenders WHERE id = ?", id)[0]);
}

export function updateRecommender(db: Db, id: string, patch: Partial<RecommenderInput> & { status?: Recommender["status"] }): Recommender {
  const r = db.sql("SELECT * FROM recommenders WHERE id = ?", id)[0];
  if (!r) throw new Error("That recommender is no longer on the matter.");
  const name = patch.name?.trim() || (r.name as string);
  db.sql(`UPDATE recommenders SET name = ?, norm = ?, title = ?, organization = ?, relationship = ?, basis = ?, status = ?, updated_at = ? WHERE id = ?`,
    name, normName(name), patch.title === undefined ? r.title : patch.title, patch.organization === undefined ? r.organization : patch.organization,
    patch.relationship === undefined ? r.relationship : patch.relationship, patch.basis === undefined ? r.basis : patch.basis,
    patch.status ?? r.status, db.now(), id);
  return toRecommender(db.sql("SELECT * FROM recommenders WHERE id = ?", id)[0]);
}

export function removeRecommender(db: Db, id: string): void {
  db.sql("DELETE FROM letters WHERE recommender_id = ?", id);
  db.sql("DELETE FROM recommenders WHERE id = ?", id);
}

/**
 * Reconcile against the attorney's own list: every name they give is confirmed (added when new,
 * attributed to the attorney); suggestions they left out are declined, never deleted, so the
 * firm's reasoning stays on file.
 */
export function reconcileRecommenders(db: Db, names: string[]): { confirmed: number; added: number; declined: number } {
  const wanted = names.map(n => n.trim()).filter(Boolean);
  const wantedNorm = new Set(wanted.map(normName));
  let confirmed = 0, added = 0, declined = 0;
  for (const n of wanted) {
    const existing = db.sql("SELECT id FROM recommenders WHERE norm = ?", normName(n))[0];
    if (existing) { updateRecommender(db, existing.id as string, { status: "confirmed" }); confirmed++; }
    else { upsertRecommender(db, { name: n }, "attorney", "confirmed"); added++; }
  }
  for (const r of db.sql("SELECT id, norm FROM recommenders WHERE status = 'suggested'")) {
    if (!wantedNorm.has(r.norm as string)) { updateRecommender(db, r.id as string, { status: "declined" }); declined++; }
  }
  return { confirmed, added, declined };
}

// ---- letters of recommendation ------------------------------------------------------------------

function toLetter(r: Row, name: string): RecommendationLetter {
  const body = r.body as string;
  return {
    id: r.id as string, recommenderId: r.recommender_id as string, recommenderName: name, body, words: wordCount(body),
    version: r.version as number, status: r.status as RecommendationLetter["status"],
    unverifiedQuotes: parseJson<QuoteCheck[]>(r.unverified, []), citedFacts: parseJson<string[]>(r.cited_facts, []).length,
    updatedAt: r.updated_at as string,
  };
}

export function listLetters(db: Db): RecommendationLetter[] {
  return db.sql("SELECT l.*, r.name AS rname FROM letters l JOIN recommenders r ON r.id = l.recommender_id ORDER BY r.name").map(r => toLetter(r, r.rname as string));
}

/** Land a letter: the same quote discipline as a petition section, checked against the cited facts. */
export function writeLetter(db: Db, recommenderId: string, body: string, citedFactIds: string[]): RecommendationLetter {
  const rec = db.sql("SELECT * FROM recommenders WHERE id = ?", recommenderId)[0];
  if (!rec) throw new Error("That recommender is no longer on the matter.");
  const ids = [...new Set(citedFactIds)];
  const quotes = ids.length ? db.sql<{ quote: string }>(`SELECT quote FROM facts WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids).map(f => f.quote) : [];
  const unverified = verifyQuotes(body, quotes, new Map(), []);
  const existing = db.sql("SELECT * FROM letters WHERE recommender_id = ?", recommenderId)[0];
  const id = (existing?.id as string | undefined) ?? db.id();
  const version = ((existing?.version as number | undefined) ?? 0) + 1;
  const ts = db.now();
  db.sql(`INSERT INTO letters(id, recommender_id, body, version, status, unverified, cited_facts, updated_at) VALUES(?, ?, ?, ?, 'drafted', ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET body = excluded.body, version = excluded.version, status = 'drafted', unverified = excluded.unverified,
          cited_facts = excluded.cited_facts, updated_at = excluded.updated_at`,
    id, recommenderId, body, version, JSON.stringify(unverified), JSON.stringify(ids), ts);
  db.sql("INSERT OR REPLACE INTO letter_versions(id, version, body, at) VALUES(?, ?, ?, ?)", id, version, body, ts);
  db.log("agent", unverified.length
    ? `Drafted a letter of recommendation for ${rec.name} (version ${version}); ${unverified.length} quote${unverified.length === 1 ? "" : "s"} could not be verified against the record.`
    : `Drafted a letter of recommendation for ${rec.name} (version ${version}).`);
  return toLetter(db.sql("SELECT * FROM letters WHERE id = ?", id)[0], rec.name as string);
}

export function approveLetter(db: Db, id: string): void {
  const r = db.sql("SELECT l.id, r.name FROM letters l JOIN recommenders r ON r.id = l.recommender_id WHERE l.id = ?", id)[0];
  if (!r) throw new Error("That letter is no longer on the matter.");
  db.sql("UPDATE letters SET status = 'approved', updated_at = ? WHERE id = ?", db.now(), id);
  db.log("lawyer", `Approved the letter of recommendation for ${r.name}.`);
}

// ---- filings -----------------------------------------------------------------------------------

export type FilingRow = Omit<Filing, "packetUrl" | "manifestUrl" | "letterDocxUrl"> & { packetKey: string; manifestKey: string; docxKey: string | null };

export function recordFiling(db: Db, row: FilingRow): void {
  db.sql(`INSERT INTO filings(version_id, at, pages, exhibits, forms, draft, packet_sha256, packet_key, manifest_key, docx_key) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(version_id) DO UPDATE SET pages = excluded.pages, exhibits = excluded.exhibits, forms = excluded.forms, draft = excluded.draft,
          packet_sha256 = excluded.packet_sha256, packet_key = excluded.packet_key, manifest_key = excluded.manifest_key, docx_key = COALESCE(excluded.docx_key, filings.docx_key)`,
    row.versionId, row.at, row.pages, row.exhibits, JSON.stringify(row.forms), row.draft ? 1 : 0, row.packetSha256, row.packetKey, row.manifestKey, row.docxKey);
}

export function setFilingDocx(db: Db, versionId: string, docxKey: string): void {
  db.sql("UPDATE filings SET docx_key = ? WHERE version_id = ?", docxKey, versionId);
}

export function listFilings(db: Db): FilingRow[] {
  return db.sql("SELECT * FROM filings ORDER BY at DESC").map(r => ({
    versionId: r.version_id as string, at: r.at as string, pages: r.pages as number, exhibits: r.exhibits as number,
    forms: parseJson<string[]>(r.forms, []), draft: Boolean(r.draft), packetSha256: r.packet_sha256 as string,
    packetKey: r.packet_key as string, manifestKey: r.manifest_key as string, docxKey: (r.docx_key as string | null) ?? null,
  }));
}

// ---- deliverables (desk files under deliverables/) ----------------------------------------------

export function deliverableTitle(path: string): string {
  return path.replace(/^deliverables\//, "").replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim() || path;
}

export function listDeliverables(db: Db): Deliverable[] {
  return db.sql("SELECT path, content, updated_at, updated_by FROM desk_files WHERE path LIKE 'deliverables/%' ORDER BY updated_at DESC").map(r => ({
    path: r.path as string, title: deliverableTitle(r.path as string), updatedAt: r.updated_at as string, updatedBy: r.updated_by as string,
    words: wordCount(r.content as string),
  }));
}

// ---- model passes -------------------------------------------------------------------------------

type ModelOut = { response?: unknown; choices?: { message?: { content?: unknown } }[] };

function textOf(out: ModelOut): string {
  if (typeof out.response === "string") return out.response;
  if (out.response && typeof out.response === "object") return JSON.stringify(out.response);
  const c = out.choices?.[0]?.message?.content;
  return typeof c === "string" ? c : c && typeof c === "object" ? JSON.stringify(c) : "";
}

async function askJson(env: Cloudflare.Env, system: string, user: string, maxTokens = 4096): Promise<unknown> {
  const models = [...new Set([env.KNOWLEDGE_MODEL || "@cf/meta/llama-4-scout-17b-16e-instruct", env.READER_MODEL].filter((m): m is string => !!m))];
  let problem = "no model configured";
  for (const model of models) {
    try {
      const out = await env.AI.run(model as Parameters<Ai["run"]>[0], {
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens, response_format: { type: "json_object" },
      }) as ModelOut;
      const text = textOf(out);
      const start = text.indexOf("{"), end = text.lastIndexOf("}");
      if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
      problem = `${model} answered without JSON`;
    } catch (error) {
      problem = `${model}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  throw new Error(`The firm's model did not answer (${problem}).`);
}

const SUGGEST_SYSTEM = `You are a senior immigration associate choosing recommenders (expert letter writers) for a petition from the case record. A good recommender is independent, senior in the field, and can speak to specific work; the record must show why. Never invent people.
Return ONLY {"recommenders":[{"name":"<canonical name>","title":"<title or null>","organization":"<org or null>","relationship":"<how they know the beneficiary, or 'independent expert' when the record shows no direct tie>","basis":"<one sentence naming the facts on the record that make them credible>","entity_index":<index of the entity they come from, or null>}]}
At most 8. Prefer people the record names; an organization counts only when a named officer can sign.`;

/** Suggest recommenders from the case map and the facts that mention them; upserts as suggestions. */
export async function suggestRecommenders(db: Db, env: Cloudflare.Env, entities: { id: string; name: string; kind: string; description: string }[], factsFor: (name: string) => Promise<Fact[]>): Promise<Recommender[]> {
  const candidates = entities.filter(e => e.kind === "person" || e.kind === "organization").slice(0, 40);
  if (candidates.length === 0) return listRecommenders(db);
  const lines: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];
    const facts = (await factsFor(e.name)).slice(0, 4);
    lines.push(`${i}: ${e.name} (${e.kind})${e.description ? ` - ${e.description}` : ""}${facts.length ? `\n   facts: ${facts.map(f => `"${f.quote}" (${f.documentTitle})`).join(" | ")}` : ""}`);
  }
  const parsed = await askJson(env, SUGGEST_SYSTEM, `Entities on the record:\n${lines.join("\n")}`) as { recommenders?: unknown };
  const list = Array.isArray(parsed.recommenders) ? parsed.recommenders as Record<string, unknown>[] : [];
  let n = 0;
  for (const r of list.slice(0, 8)) {
    if (typeof r.name !== "string" || !r.name.trim()) continue;
    const idx = typeof r.entity_index === "number" ? candidates[r.entity_index]?.id ?? null : null;
    upsertRecommender(db, {
      name: r.name, title: typeof r.title === "string" ? r.title : null, organization: typeof r.organization === "string" ? r.organization : null,
      relationship: typeof r.relationship === "string" ? r.relationship : null, basis: typeof r.basis === "string" ? r.basis : null, entityId: idx,
    }, "firm", "suggested");
    n++;
  }
  db.log("agent", `Suggested ${n} recommender${n === 1 ? "" : "s"} from the record.`);
  return listRecommenders(db);
}

const LETTER_SYSTEM = `You are ghost-writing a letter of recommendation for an immigration petition, in the recommender's own voice, from the facts the firm read out of the record. Plain, specific, formal English; the recommender introduces themselves, explains how they know the beneficiary's work, and describes concrete contributions with their significance. Quote a document only in the exact words given; every quoted phrase must appear verbatim among the facts. No dates, numbers or names that are not in the facts. About 500 to 700 words. Close with the recommender's name and title.
Return ONLY {"body":"<markdown letter>","cited_fact_indexes":[<int>, ...]}`;

/** Write one letter from the record for a confirmed recommender, then run the quote verifier on it. */
export async function generateLetter(db: Db, env: Cloudflare.Env, recommender: Recommender, beneficiary: string, petitionTitle: string, facts: Fact[]): Promise<RecommendationLetter> {
  if (facts.length === 0) throw new Error(`The record has no facts to write ${recommender.name}'s letter from yet.`);
  const factLines = facts.map((f, i) => `${i}: ${f.statement} - "${f.quote}" (${f.documentTitle}${f.page ? ` p. ${f.page}` : ""})`).join("\n");
  const user = `Petition: ${petitionTitle}. Beneficiary: ${beneficiary}.\nRecommender: ${recommender.name}${recommender.title ? `, ${recommender.title}` : ""}${recommender.organization ? `, ${recommender.organization}` : ""}. Relationship: ${recommender.relationship ?? "not stated"}. Basis: ${recommender.basis ?? "not stated"}.\n\nFacts on the record:\n${factLines}`;
  const parsed = await askJson(env, LETTER_SYSTEM, user, 6144) as { body?: unknown; cited_fact_indexes?: unknown };
  if (typeof parsed.body !== "string" || !parsed.body.trim()) throw new Error("The letter came back empty.");
  const idx = (Array.isArray(parsed.cited_fact_indexes) ? parsed.cited_fact_indexes : []).filter((i): i is number => typeof i === "number" && i >= 0 && i < facts.length);
  const cited = idx.length ? idx.map(i => facts[i].id) : facts.map(f => f.id);
  return writeLetter(db, recommender.id, parsed.body.trim(), cited);
}
