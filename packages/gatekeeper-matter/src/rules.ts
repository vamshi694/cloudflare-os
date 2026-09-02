// The deterministic rules of the matter, runtime-free so they run under plain node in tests:
// readiness tiers and the gate, phase derivation, deadline urgency, the quote verifier, exhibit
// numbering, entity name normalization, and the portal's client-facing wording.

import type {
  CaseTypeSpec, Deadline, MatterPhase, Readiness, SectionEvidence, SectionReadiness,
} from "@gadgets/workshop-shared/legal";
import { foldText } from "./pure.js";

// ---- readiness ---------------------------------------------------------------------------------

export type ClaimForReadiness = { criteria: string[]; removed: boolean; documentIds: string[]; maxConfidence: number };

export function sectionEvidence(claims: ClaimForReadiness[]): { evidence: SectionEvidence; claims: number; documents: number } {
  const live = claims.filter(c => !c.removed);
  const docs = new Set(live.flatMap(c => c.documentIds));
  if (live.length === 0) return { evidence: "none", claims: 0, documents: 0 };
  const confident = live.some(c => c.maxConfidence >= 0.6);
  if (docs.size < 2 || !confident || live.length < 2) return { evidence: "thin", claims: live.length, documents: docs.size };
  return { evidence: "sufficient", claims: live.length, documents: docs.size };
}

export function computeReadiness(spec: CaseTypeSpec | null, claims: ClaimForReadiness[], computedAt: string): Readiness {
  if (!spec) {
    return { caseType: null, sections: [], sufficient: 0, required: 0, gate: "undecided", stillNeeded: [], computedAt };
  }
  const sections: SectionReadiness[] = spec.sections.filter(s => s.evidentiary).map(s => {
    const own = claims.filter(c => c.criteria.includes(s.key));
    const { evidence, claims: n, documents } = sectionEvidence(own);
    const stillNeeded = evidence === "sufficient" ? []
      : evidence === "none" ? [`${s.title}: ${s.purpose}`]
      : [`More independent evidence for ${s.title.toLowerCase()} (currently ${documents} document${documents === 1 ? "" : "s"}): ${s.purpose}`];
    return { key: s.key, title: s.title, evidence, supportingClaims: n, supportingDocuments: documents, stillNeeded };
  });
  const sufficient = sections.filter(s => s.evidence === "sufficient").length;
  const thin = sections.filter(s => s.evidence === "thin").length;
  const required = spec.required;
  const gate: Readiness["gate"] = sufficient >= required ? "build"
    : sufficient >= 1 && (sufficient + thin) / Math.max(1, required) >= 0.5 ? "build_with_gaps"
    : "gather";
  // What the client should send: sections with nothing first, then the thin ones. Sufficient ones
  // never appear; the lawyer reads only what needs them.
  const stillNeeded = [...new Set([
    ...sections.filter(s => s.evidence === "none").flatMap(s => s.stillNeeded),
    ...sections.filter(s => s.evidence === "thin").flatMap(s => s.stillNeeded),
  ])];
  return { caseType: spec.key, sections, sufficient, required, gate, stillNeeded, computedAt };
}

// ---- phase -------------------------------------------------------------------------------------

export type PhaseInputs = {
  paused: boolean;
  documents: number;
  reading: number;
  ready: number;
  failed: number;
  building: boolean;
  planProposed: boolean;
  planApproved: boolean;
  writing: boolean;
  drafted: number;
  pendingInstructions: number;
};

export function derivePhase(i: PhaseInputs): MatterPhase {
  if (i.paused) return "paused";
  if (i.reading > 0) return "reading";
  if (i.failed > 0 && i.ready === 0 && !i.building) return "not_understood";
  if (i.building) return "knowledge";
  if (i.writing) return "building";
  if (i.documents > 0 && !i.planProposed) return "analysis";
  if (i.planProposed && !i.planApproved) return "clearance";
  if (i.drafted > 0 && i.pendingInstructions === 0) return "review";
  return "idle";
}

// ---- deadlines ---------------------------------------------------------------------------------

/** Days between two ISO dates (due minus today), whole days. */
export function daysBetween(todayIso: string, dueIso: string): number {
  const a = Date.UTC(+todayIso.slice(0, 4), +todayIso.slice(5, 7) - 1, +todayIso.slice(8, 10));
  const b = Date.UTC(+dueIso.slice(0, 4), +dueIso.slice(5, 7) - 1, +dueIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function deadlineUrgency(daysLeft: number, met: boolean): Deadline["urgency"] {
  if (met) return "later";
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 14) return "in_window";
  return "later";
}

// ---- the quote verifier ------------------------------------------------------------------------

export type QuoteCheck = { quote: string; exhibitNo: number | null; reason: "absent" | "wrong_exhibit" | "unverifiable"; foundIn: number | null };

/** Every quoted span of 12+ characters in the prose, in order. */
export function quotedSpans(body: string): string[] {
  const out: string[] = [];
  const re = /["“]([^"“”]{12,}?)["”]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1].trim());
  return out;
}

/** The exhibit number a quote is cited to: the nearest "Exhibit N" within 240 characters after it, else before. */
export function citedExhibitNear(body: string, quote: string): number | null {
  const at = body.indexOf(quote);
  if (at < 0) return null;
  const after = body.slice(at + quote.length, at + quote.length + 240).match(/\bEx(?:hibit|\.)\s*(\d+)/i);
  if (after) return Number(after[1]);
  const before = body.slice(Math.max(0, at - 240), at).match(/\bEx(?:hibit|\.)\s*(\d+)(?![\s\S]*\bEx(?:hibit|\.)\s*\d+)/i);
  return before ? Number(before[1]) : null;
}

/**
 * Verify the prose's quotes. `factQuotes` are the verbatim quotes of the cited facts; `texts` maps
 * an exhibit number to its source text (undefined when the text is missing). A span passes when it
 * appears in a cited fact's quote or in the text of the exhibit it is cited to.
 */
export function verifyQuotes(body: string, factQuotes: string[], texts: Map<number, string | undefined>, citedExhibits: number[]): QuoteCheck[] {
  const folded = factQuotes.map(q => foldText(q));
  const foldedTexts = new Map<number, string | undefined>();
  for (const [n, t] of texts) foldedTexts.set(n, t === undefined ? undefined : foldText(t));
  const out: QuoteCheck[] = [];
  for (const span of quotedSpans(body)) {
    const needle = foldText(span);
    if (folded.some(q => q.includes(needle) || (needle.length >= 40 && needle.includes(q) && q.length >= 20))) continue;
    const exhibitNo = citedExhibitNear(body, span);
    const cited = exhibitNo !== null ? foldedTexts.get(exhibitNo) : undefined;
    if (cited && cited.includes(needle)) continue;
    let foundIn: number | null = null;
    for (const [n, t] of foldedTexts) if (t && t.includes(needle) && n !== exhibitNo) { foundIn = n; break; }
    if (foundIn !== null) { out.push({ quote: span, exhibitNo, reason: "wrong_exhibit", foundIn }); continue; }
    const unverifiable = exhibitNo !== null ? cited === undefined && citedExhibits.includes(exhibitNo) : citedExhibits.some(n => foldedTexts.get(n) === undefined);
    out.push({ quote: span, exhibitNo, reason: unverifiable ? "unverifiable" : "absent", foundIn: null });
  }
  return out;
}

// ---- exhibits ----------------------------------------------------------------------------------

/** Assign the next exhibit numbers to documents that have none, in the order given; existing numbers stay. */
export function nextExhibitNumbers(existing: Map<string, number>, orderedDocumentIds: string[]): Map<string, number> {
  const out = new Map(existing);
  let next = Math.max(0, ...existing.values()) + 1;
  for (const id of orderedDocumentIds) {
    if (out.has(id)) continue;
    out.set(id, next++);
  }
  return out;
}

/** Exhibit numbers cited in a body ("Exhibit 12", "Ex. 8"). */
export function citedExhibitNumbers(body: string): number[] {
  return [...new Set([...body.matchAll(/\bEx(?:hibit|\.)\s*(\d+)/gi)].map(m => Number(m[1])))];
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export const WORDS_PER_PAGE = 450;

// ---- entities ----------------------------------------------------------------------------------

export function normalizeEntityName(name: string): string {
  return name.toLowerCase().replace(/^(dr|prof|professor|mr|ms|mrs)\.?\s+/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// ---- the portal's words ------------------------------------------------------------------------

/** A document's state as the client reads it. Never the firm's status vocabulary. */
export function portalDocumentState(status: string): { state: "reading" | "trouble" | "read"; label: string | null } {
  if (status === "queued" || status === "reading") return { state: "reading", label: "Reading…" };
  if (status === "failed") return { state: "trouble", label: "we had trouble reading this — a clearer copy would help" };
  return { state: "read", label: null };
}

/** "Dr. Anaya Raghunathan" -> "Anaya", never "Dr.". */
export function firstNameOf(full: string): string {
  const words = full.trim().split(/\s+/).filter(w => !/^(dr|prof|professor|mr|ms|mrs|mx)\.?$/i.test(w));
  return words[0] ?? full.trim();
}

export function portalStatusLine(phase: MatterPhase, caseTypeTitle: string | null): string {
  const filing = caseTypeTitle ? `your ${caseTypeTitle} petition` : "your petition";
  switch (phase) {
    case "reading": return `We are reading the documents you sent for ${filing}.`;
    case "not_understood": return `We received your documents and are working through them for ${filing}.`;
    case "knowledge":
    case "analysis": return `Your legal team is reviewing the record for ${filing}.`;
    case "clearance":
    case "building": return `Your legal team is preparing ${filing}.`;
    case "review": return `A draft of ${filing} is with your attorney for review.`;
    case "paused": return `Your legal team has ${filing} on file.`;
    default: return `Your legal team is preparing ${filing}.`;
  }
}
