// Case intelligence, the deterministic half: chronology from dated facts, candidate pairs for the
// firm's reviews, blast radius of a document, paths between entities, the grounding score, the
// record inventory, exhibit ordering, and the parsers for what the model answers. No runtime
// imports, so every rule here runs under plain node in tests. Judgment (which candidates are real
// contradictions, which pairs are one entity, what an officer would seize on) is the model's job in
// knowledge.ts; this file decides what to ask and what to keep.

import type {
  BlastRadius, CaseClaim, CaseEntity, Chronology, ChronologyEntry, Contradiction, ContradictionSide, CriteriaFinding,
  CriterionSpec, EntityPath, GapItem, Grounding, RecordInventory, ReviewPair,
} from "@gadgets/workshop-shared/legal";
import type { Fact } from "./types.js";
import { normalizeEntityName } from "./rules.js";

// ---- chronology --------------------------------------------------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SEASONS: Record<string, number> = { winter: 1, spring: 4, summer: 7, fall: 10, autumn: 10 };

export type ParsedWhen = { year: number | null; month: number | null; day: number | null; ambiguous: boolean };

/** "14 January 2019", "March 2021", "2019", "2021-03-05", "FY2023", "Spring 2020", "2019-2021", "since 2020". */
export function parseWhen(raw: string | null | undefined): ParsedWhen {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return { year: null, month: null, day: null, ambiguous: true };
  const vague = /\b(circa|about|around|approximately|early|late|mid|since|recent|last|next|ago|~)\b/.test(s) || s.includes("?");
  const iso = s.match(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/);
  if (iso) return { year: +iso[1], month: +iso[2], day: iso[3] ? +iso[3] : null, ambiguous: vague };
  const years = [...s.matchAll(/\b(19|20)\d{2}\b/g)].map(m => +m[0]);
  if (years.length === 0) return { year: null, month: null, day: null, ambiguous: true };
  const year = years[0];
  const range = years.length > 1 && years[1] !== year;
  const fy = /\bfy\s?\d{4}\b/.test(s);
  const monthIdx = MONTHS.findIndex(m => new RegExp(`\\b${m.slice(0, 3)}[a-z]*\\b`).test(s));
  const season = Object.keys(SEASONS).find(k => new RegExp(`\\b${k}\\b`).test(s));
  const dayMatch = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b(?=[^\d]*(?:\d{4}))/);
  const month = monthIdx >= 0 ? monthIdx + 1 : season ? SEASONS[season] : null;
  const day = monthIdx >= 0 && dayMatch && +dayMatch[1] >= 1 && +dayMatch[1] <= 31 ? +dayMatch[1] : null;
  return { year, month, day, ambiguous: vague || range || fy || !!season };
}

function sortKey(p: ParsedWhen): string {
  const y = p.year === null ? "0000" : String(p.year).padStart(4, "0");
  return `${y}-${String(p.month ?? 0).padStart(2, "0")}-${String(p.day ?? 0).padStart(2, "0")}`;
}

/** Facts with dates, ordered and grouped by year; undated facts are counted, never invented into the timeline. */
export function buildChronology(facts: Fact[], computedAt: string): Chronology {
  const entries: ChronologyEntry[] = [];
  let undated = 0;
  for (const f of facts) {
    const p = parseWhen(f.occurredOn);
    if (p.year === null) { undated += 1; continue; }
    entries.push({
      factId: f.id, documentId: f.documentId, documentTitle: f.documentTitle, page: f.page, when: f.occurredOn ?? "", year: p.year,
      sortKey: sortKey(p), ambiguous: p.ambiguous || f.dateAmbiguous, statement: f.statement, quote: f.quote, significance: f.significance,
    });
  }
  entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.statement.localeCompare(b.statement));
  const years = new Map<number, ChronologyEntry[]>();
  for (const e of entries) years.set(e.year!, [...(years.get(e.year!) ?? []), e]);
  return {
    years: [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, es]) => ({ year, entries: es })),
    dated: entries.length, undated, computedAt,
  };
}

// ---- candidate pairs -------------------------------------------------------------------------

const STOP = new Set(["the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or", "by", "with", "from", "as", "is", "was", "were", "be", "that", "this", "his", "her", "their", "its", "he", "she", "they", "it", "dr", "mr", "ms", "has", "have", "had", "which", "who"]);

export function significantTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(t => t.length > 2 && !STOP.has(t)));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n / Math.max(1, Math.min(a.size, b.size));
}

function numbersIn(text: string): string[] {
  return [...text.matchAll(/\b\d[\d,.]*\b/g)].map(m => m[0].replace(/,/g, "")).filter(n => n !== "" && !/^(19|20)\d{2}$/.test(n));
}

export type FactPair = { a: Fact; b: Fact; why: "date" | "number" | "statement"; subject: string };

/**
 * Facts worth asking the model about: two facts about the same entity (or with strongly
 * overlapping wording) that carry different years or different numbers. Capped, most suspicious
 * first. `factEntities` maps a fact id to the entity names its claims bind.
 */
export function contradictionCandidates(facts: Fact[], factEntities: Map<string, string[]>, cap = 40): FactPair[] {
  const out: FactPair[] = [];
  const tokens = new Map(facts.map(f => [f.id, significantTokens(f.statement)]));
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const a = facts[i], b = facts[j];
      if (a.id === b.id) continue;
      const ea = factEntities.get(a.id) ?? [], eb = factEntities.get(b.id) ?? [];
      const shared = ea.find(n => eb.includes(n));
      const wordOverlap = overlap(tokens.get(a.id)!, tokens.get(b.id)!);
      if (!shared && wordOverlap < 0.5) continue;
      const ya = parseWhen(a.occurredOn).year, yb = parseWhen(b.occurredOn).year;
      const subject = shared ?? [...tokens.get(a.id)!].filter(t => tokens.get(b.id)!.has(t)).slice(0, 3).join(" ");
      if (ya !== null && yb !== null && ya !== yb && wordOverlap >= 0.34) { out.push({ a, b, why: "date", subject }); continue; }
      const na = numbersIn(a.statement), nb = numbersIn(b.statement);
      if (na.length && nb.length && wordOverlap >= 0.34 && !na.some(n => nb.includes(n))) { out.push({ a, b, why: "number", subject }); continue; }
      if (wordOverlap >= 0.7 && a.documentId !== b.documentId && a.statement.toLowerCase() !== b.statement.toLowerCase()) out.push({ a, b, why: "statement", subject });
    }
  }
  const rank = { date: 0, number: 1, statement: 2 };
  return out.sort((x, y) => rank[x.why] - rank[y.why]).slice(0, cap);
}

/** Two normalized names that are probably one entity: one contains the other, or their tokens mostly overlap. */
export function namesLookAlike(a: string, b: string): boolean {
  const na = normalizeEntityName(a), nb = normalizeEntityName(b);
  if (!na || !nb || na === nb) return na === nb && na !== "";
  const ta = new Set(na.split(" ")), tb = new Set(nb.split(" "));
  if (na.includes(nb) || nb.includes(na)) return Math.min(na.length, nb.length) >= 4;
  const acronym = (ts: Set<string>) => [...ts].filter(t => !STOP.has(t)).map(t => t[0]).join("");
  const initialsA = acronym(ta), initialsB = acronym(tb);
  if ((ta.size >= 2 && initialsA === nb.replace(/\s/g, "")) || (tb.size >= 2 && initialsB === na.replace(/\s/g, ""))) return true;
  return overlap(ta, tb) >= 0.67 && Math.min(ta.size, tb.size) >= 2;
}

export type EntityPair = { a: CaseEntity; b: CaseEntity; reason: string };

/** Same-kind entities whose names look alike, the firm's duplicate chore. Locked entities are never the one to go. */
export function duplicateCandidates(entities: CaseEntity[], cap = 30): EntityPair[] {
  const out: EntityPair[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i], b = entities[j];
      if (a.kind !== b.kind || !namesLookAlike(a.name, b.name)) continue;
      const [keep, drop] = a.locked || (!b.locked && a.salience >= b.salience) ? [a, b] : [b, a];
      out.push({ a: keep, b: drop, reason: `"${keep.name}" and "${drop.name}" are both ${a.kind.replace("_", " ")}s with names that match.` });
    }
  }
  return out.slice(0, cap);
}

export type ClaimPair = { a: CaseClaim; b: CaseClaim; reason: string };

/** Live claims in the same section, binding a shared entity, that state different numbers or years. */
export function conflictCandidates(claims: CaseClaim[], cap = 30): ClaimPair[] {
  const live = claims.filter(c => !c.removed);
  const out: ClaimPair[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (!a.entityIds.some(e => b.entityIds.includes(e))) continue;
      if (!a.criteria.some(k => b.criteria.includes(k))) continue;
      const ta = significantTokens(a.statement), tb = significantTokens(b.statement);
      if (overlap(ta, tb) < 0.34) continue;
      const years = (s: string) => [...s.matchAll(/\b(19|20)\d{2}\b/g)].map(m => m[0]);
      const ya = years(a.statement), yb = years(b.statement);
      const na = numbersIn(a.statement), nb = numbersIn(b.statement);
      const dateClash = ya.length && yb.length && !ya.some(y => yb.includes(y));
      const numberClash = na.length && nb.length && !na.some(n => nb.includes(n));
      if (dateClash || numberClash) out.push({ a, b, reason: dateClash ? "They date the same matter differently." : "They put different numbers on the same point." });
    }
  }
  return out.slice(0, cap);
}

// ---- blast radius, paths -----------------------------------------------------------------------

export function blastRadiusOf(
  doc: { id: string; title: string },
  facts: Pick<Fact, "id" | "documentId">[],
  claims: CaseClaim[],
  liveDocumentIds: Set<string>,
  sections: Pick<CriterionSpec, "key" | "title">[],
  petition: { key: string; title: string; status: BlastRadius["petitionSections"][number]["status"] }[],
): BlastRadius {
  const docFacts = new Set(facts.filter(f => f.documentId === doc.id).map(f => f.id));
  const factDoc = new Map(facts.map(f => [f.id, f.documentId]));
  const hit = claims.filter(c => !c.removed && c.factIds.some(id => docFacts.has(id)));
  const rows = hit.map(c => ({
    id: c.id, statement: c.statement, criteria: c.criteria,
    onlyHere: !c.factIds.some(id => { const d = factDoc.get(id); return d !== undefined && d !== doc.id && liveDocumentIds.has(d); }),
  }));
  const keys = new Set(rows.flatMap(r => r.criteria));
  return {
    documentId: doc.id, documentTitle: doc.title, facts: docFacts.size, claims: rows,
    sections: sections.filter(s => keys.has(s.key)).map(s => ({ key: s.key, title: s.title })),
    petitionSections: petition.filter(p => keys.has(p.key)),
  };
}

/** Breadth-first over live claims: the shortest chain of claims joining two entities. */
export function pathBetween(entities: CaseEntity[], claims: CaseClaim[], fromId: string, toId: string): EntityPath {
  const names = new Map(entities.map(e => [e.id, e.name]));
  if (!names.has(fromId) || !names.has(toId)) return { found: false, hops: [] };
  if (fromId === toId) return { found: true, hops: [{ entityId: fromId, entityName: names.get(fromId)!, claimId: null, claimStatement: null }] };
  const live = claims.filter(c => !c.removed);
  const prev = new Map<string, { entityId: string; claim: CaseClaim }>();
  const queue = [fromId];
  const seen = new Set([fromId]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const c of live) {
      if (!c.entityIds.includes(cur)) continue;
      for (const next of c.entityIds) {
        if (seen.has(next)) continue;
        seen.add(next);
        prev.set(next, { entityId: cur, claim: c });
        if (next === toId) {
          const hops: EntityPath["hops"] = [];
          let at = toId;
          while (at !== fromId) {
            const p = prev.get(at)!;
            hops.unshift({ entityId: at, entityName: names.get(at) ?? at, claimId: p.claim.id, claimStatement: p.claim.statement });
            at = p.entityId;
          }
          hops.unshift({ entityId: fromId, entityName: names.get(fromId)!, claimId: null, claimStatement: null });
          return { found: true, hops };
        }
        queue.push(next);
      }
    }
  }
  return { found: false, hops: [] };
}

// ---- grounding, inventory, ordering ------------------------------------------------------------

export function groundingOf(claims: CaseClaim[], facts: Pick<Fact, "id" | "confidence" | "verifiedBy">[]): Grounding {
  const byId = new Map(facts.map(f => [f.id, f]));
  const live = claims.filter(c => !c.removed);
  let grounded = 0, verified = 0;
  for (const c of live) {
    const fs = c.factIds.map(id => byId.get(id)).filter((f): f is NonNullable<typeof f> => !!f);
    if (fs.some(f => f.confidence >= 0.6)) grounded += 1;
    if (fs.some(f => f.verifiedBy)) verified += 1;
  }
  return { score: live.length === 0 ? 0 : Math.round((grounded / live.length) * 100) / 100, claims: live.length, grounded, verified };
}

export function docLabel(docType: string | null): string {
  if (!docType) return "Not yet filed under a kind";
  return docType.split(/[_\s]+/).map(w => w === "cv" ? "CV" : w === "uscis" ? "USCIS" : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function inventoryOf(docs: { id: string; docType: string | null; status: string }[]): RecordInventory {
  const live = docs.filter(d => d.status !== "superseded");
  const groups = new Map<string | null, string[]>();
  for (const d of live) groups.set(d.docType, [...(groups.get(d.docType) ?? []), d.id]);
  const kinds = [...groups.entries()].map(([docType, ids]) => ({ docType, label: docLabel(docType), count: ids.length, documentIds: ids }))
    .sort((a, b) => (a.docType === null ? 1 : 0) - (b.docType === null ? 1 : 0) || b.count - a.count || a.label.localeCompare(b.label));
  return { kinds, documents: live.length, unread: live.filter(d => d.status === "queued" || d.status === "reading" || d.status === "failed").length };
}

/**
 * Exhibit order for the filing: documents grouped by the first petition section their claims
 * argue in (in the case type's section order), then by how many claims they ground, then by title.
 * Documents grounding nothing come last, in upload order. Existing numbers are not kept: this is a
 * proposal the attorney applies deliberately.
 */
export function exhibitOrderOf(
  docs: { id: string; title: string; uploadedAt: string; live: boolean }[],
  facts: Pick<Fact, "id" | "documentId">[],
  claims: CaseClaim[],
  sectionOrder: string[],
): { documentId: string; title: string; exhibitNo: number; firstSection: string | null }[] {
  const factDoc = new Map(facts.map(f => [f.id, f.documentId]));
  const perDoc = new Map<string, { first: number; claims: number }>();
  for (const c of claims) {
    if (c.removed) continue;
    const rank = Math.min(...c.criteria.map(k => { const i = sectionOrder.indexOf(k); return i < 0 ? sectionOrder.length : i; }), sectionOrder.length);
    for (const id of new Set(c.factIds.map(f => factDoc.get(f)).filter((d): d is string => !!d))) {
      const cur = perDoc.get(id) ?? { first: sectionOrder.length, claims: 0 };
      perDoc.set(id, { first: Math.min(cur.first, rank), claims: cur.claims + 1 });
    }
  }
  const ordered = docs.filter(d => d.live).sort((a, b) => {
    const pa = perDoc.get(a.id) ?? { first: sectionOrder.length + 1, claims: 0 };
    const pb = perDoc.get(b.id) ?? { first: sectionOrder.length + 1, claims: 0 };
    return pa.first - pb.first || pb.claims - pa.claims || (pa.claims === 0 && pb.claims === 0 ? a.uploadedAt.localeCompare(b.uploadedAt) : 0) || a.title.localeCompare(b.title);
  });
  return ordered.map((d, i) => {
    const first = perDoc.get(d.id)?.first;
    return { documentId: d.id, title: d.title, exhibitNo: i + 1, firstSection: first !== undefined && first < sectionOrder.length ? sectionOrder[first] : null };
  });
}

// ---- what the model answers --------------------------------------------------------------------

function jsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`The reader returned no JSON (it said: ${raw.replace(/\s+/g, " ").slice(0, 160) || "nothing"}).`);
  try { return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>; } catch { throw new Error("The reader returned malformed JSON."); }
}

const SEVERITIES = new Set(["high", "medium", "low"]);

function side(f: Fact): ContradictionSide {
  return { factId: f.id, statement: f.statement, quote: f.quote, documentId: f.documentId, documentTitle: f.documentTitle, page: f.page };
}

/** The model's verdicts on candidate pairs: only pairs it calls real contradictions survive, with its explanation. */
export function parseContradictions(raw: string, candidates: FactPair[], foundAt: string, id: () => string): Contradiction[] {
  const parsed = jsonObject(raw);
  const rows = Array.isArray(parsed.contradictions) ? parsed.contradictions as { index?: unknown; real?: unknown; explanation?: unknown; recommendation?: unknown; severity?: unknown; kind?: unknown; subject?: unknown }[] : [];
  const out: Contradiction[] = [];
  for (const r of rows) {
    if (typeof r.index !== "number" || !Number.isInteger(r.index) || r.index < 0 || r.index >= candidates.length) continue;
    if (r.real !== true) continue;
    const c = candidates[r.index];
    const kind = r.kind === "date" || r.kind === "number" || r.kind === "statement" ? r.kind : c.why;
    out.push({
      id: id(), kind, subject: typeof r.subject === "string" && r.subject.trim() ? r.subject.trim() : c.subject,
      a: side(c.a), b: side(c.b),
      explanation: typeof r.explanation === "string" && r.explanation.trim() ? r.explanation.trim() : "The two facts cannot both be right as stated.",
      recommendation: typeof r.recommendation === "string" && r.recommendation.trim() ? r.recommendation.trim() : null,
      severity: SEVERITIES.has(String(r.severity)) ? r.severity as Contradiction["severity"] : "medium",
      status: "open", resolution: null, foundAt,
    });
  }
  return out;
}

/** The model's verdicts on review pairs, by index; anything it does not rule on stays pending. */
export function parseReviewVerdicts(raw: string, count: number, allowed: ReviewPair["verdict"][]): Map<number, { verdict: ReviewPair["verdict"]; reason: string }> {
  const parsed = jsonObject(raw);
  const rows = Array.isArray(parsed.verdicts) ? parsed.verdicts as { index?: unknown; verdict?: unknown; reason?: unknown }[] : [];
  const out = new Map<number, { verdict: ReviewPair["verdict"]; reason: string }>();
  for (const r of rows) {
    if (typeof r.index !== "number" || !Number.isInteger(r.index) || r.index < 0 || r.index >= count) continue;
    if (!allowed.includes(r.verdict as ReviewPair["verdict"])) continue;
    out.set(r.index, { verdict: r.verdict as ReviewPair["verdict"], reason: typeof r.reason === "string" ? r.reason.trim() : "" });
  }
  return out;
}

const VERDICTS = new Set(["strong", "arguable", "weak", "absent"]);

export function parseFindings(raw: string, sections: Pick<CriterionSpec, "key" | "title">[], claimIds: Set<string>): CriteriaFinding[] {
  const parsed = jsonObject(raw);
  const rows = Array.isArray(parsed.findings) ? parsed.findings as { key?: unknown; verdict?: unknown; strongest?: unknown; seize?: unknown; note?: unknown }[] : [];
  const byKey = new Map(rows.filter(r => typeof r.key === "string").map(r => [r.key as string, r]));
  return sections.map(s => {
    const r = byKey.get(s.key);
    const strongest = (Array.isArray(r?.strongest) ? r!.strongest : []) as { claimId?: unknown; statement?: unknown }[];
    return {
      key: s.key, title: s.title,
      verdict: r && VERDICTS.has(String(r.verdict)) ? r.verdict as CriteriaFinding["verdict"] : "absent",
      strongest: strongest.filter(x => typeof x.claimId === "string" && claimIds.has(x.claimId) && typeof x.statement === "string")
        .map(x => ({ claimId: x.claimId as string, statement: (x.statement as string).trim() })).slice(0, 5),
      officerWouldSeize: (Array.isArray(r?.seize) ? r!.seize : []).filter((x): x is string => typeof x === "string" && x.trim() !== "").map(x => x.trim()).slice(0, 5),
      note: typeof r?.note === "string" ? r.note.trim() : r ? "" : "The assessment did not reach this section.",
    };
  });
}

export function parseGapItems(raw: string, sections: Pick<CriterionSpec, "key" | "title">[], id: () => string): GapItem[] {
  const parsed = jsonObject(raw);
  const rows = Array.isArray(parsed.gaps) ? parsed.gaps as { key?: unknown; priority?: unknown; missing?: unknown; ask?: unknown }[] : [];
  const titles = new Map(sections.map(s => [s.key, s.title]));
  const out: GapItem[] = [];
  for (const r of rows) {
    if (typeof r.key !== "string" || !titles.has(r.key)) continue;
    if (typeof r.missing !== "string" || !r.missing.trim()) continue;
    const p = r.priority === 1 || r.priority === 2 || r.priority === 3 ? r.priority : 2;
    out.push({ id: id(), key: r.key, title: titles.get(r.key)!, priority: p, missing: r.missing.trim(), ask: typeof r.ask === "string" && r.ask.trim() ? r.ask.trim() : r.missing.trim() });
  }
  return out.sort((a, b) => a.priority - b.priority);
}

export function parseTitles(raw: string, docs: { id: string; current: string | null }[]): { documentId: string; current: string | null; proposed: string }[] {
  const parsed = jsonObject(raw);
  const rows = Array.isArray(parsed.titles) ? parsed.titles as { documentId?: unknown; title?: unknown }[] : [];
  const cur = new Map(docs.map(d => [d.id, d.current]));
  const out: { documentId: string; current: string | null; proposed: string }[] = [];
  for (const r of rows) {
    if (typeof r.documentId !== "string" || !cur.has(r.documentId) || typeof r.title !== "string") continue;
    const proposed = r.title.replace(/\s+/g, " ").trim().slice(0, 140);
    if (!proposed || proposed === cur.get(r.documentId)) continue;
    out.push({ documentId: r.documentId, current: cur.get(r.documentId) ?? null, proposed });
  }
  return out;
}

/** The strategy memo's fixed frame, filled from readiness, findings and gaps; the model writes the prose. */
export function strategyFrame(input: {
  caseTypeTitle: string; gate: string; sufficient: number; required: number;
  findings: CriteriaFinding[]; gaps: GapItem[]; grounding: Grounding;
}): string {
  const lines = [
    `Case type: ${input.caseTypeTitle}.`,
    `Gate: ${input.gate} (${input.sufficient} of ${input.required} required sections sufficient).`,
    `Grounding: ${Math.round(input.grounding.score * 100)}% of ${input.grounding.claims} claims rest on a confident fact; ${input.grounding.verified} carry an attorney-verified fact.`,
    "",
    "Findings by section:",
    ...input.findings.map(f => `- ${f.title}: ${f.verdict}${f.officerWouldSeize.length ? ` (an officer would seize on: ${f.officerWouldSeize.join("; ")})` : ""}`),
    "",
    "Gaps, by priority:",
    ...input.gaps.map(g => `- [${g.priority}] ${g.title}: ${g.missing}`),
  ];
  return lines.join("\n");
}
