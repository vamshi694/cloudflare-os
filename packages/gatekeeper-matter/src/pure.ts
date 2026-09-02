// Runtime-free helpers shared by the store, the session and the reader. No cloudflare:workers
// import here, so these run under plain node in tests.

import type { Understanding, UnderstoodFact } from "./store.js";

/** Fold whitespace, case and common typography so exact search survives OCR and smart quotes. */
export function foldText(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** The filename family: "resume_final (1).pdf" and "resume.pdf" are the same family. */
export function filenameFamily(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[-_ ]?(copy|final|v\d+|draft|new|updated|rev\d*)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}


export function parseMatterUrl(url: string): string {
  const m = /^legal:\/\/matter\/([0-9a-f]{32})\/?$/i.exec(url);
  if (!m) throw new Error(`Not a matter URL: ${url}`);
  return m[1].toLowerCase();
}


export function normalizePath(path: string): string {
  const parts = path.split("/").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some(p => p === "." || p === ".." || !/^[A-Za-z0-9]/.test(p))) {
    throw new Error(`Invalid desk path "${path}": segments must start with a letter or digit.`);
  }
  return parts.join("/");
}


export class ReadError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}


type RawFact = {
  statement?: unknown; quote?: unknown; page?: unknown; occurred_on?: unknown;
  date_ambiguous?: unknown; significance?: unknown; confidence?: unknown;
};

export function parseUnderstanding(raw: string, windowText: string): Understanding {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ReadError("The reader returned no JSON.", true);
  let parsed: { doc_type?: unknown; display_title?: unknown; facts?: unknown };
  try { parsed = JSON.parse(raw.slice(start, end + 1)); }
  catch { throw new ReadError("The reader returned malformed JSON.", true); }
  const folded = windowText.replace(/\s+/g, " ").toLowerCase();
  const facts: UnderstoodFact[] = [];
  for (const f of (Array.isArray(parsed.facts) ? parsed.facts : []) as RawFact[]) {
    if (typeof f.statement !== "string" || typeof f.quote !== "string") continue;
    const quote = f.quote.trim();
    if (quote.length < 3) continue;
    // Bind the quote to the bytes the model was shown. A quote absent from the text is kept but
    // marked low-confidence rather than dropped: flag, never silently discard.
    const bound = folded.includes(quote.replace(/\s+/g, " ").toLowerCase());
    const confidence = typeof f.confidence === "number" ? f.confidence : 0.5;
    facts.push({
      statement: f.statement.trim(),
      quote,
      page: typeof f.page === "number" ? f.page : null,
      occurredOn: typeof f.occurred_on === "string" && f.occurred_on.trim() ? f.occurred_on.trim() : null,
      dateAmbiguous: Boolean(f.date_ambiguous),
      significance: typeof f.significance === "string" ? f.significance : null,
      confidence: bound ? confidence : Math.min(confidence, 0.4),
    });
  }
  return {
    docType: typeof parsed.doc_type === "string" ? parsed.doc_type : null,
    displayTitle: typeof parsed.display_title === "string" ? parsed.display_title : null,
    facts,
  };
}



// ---- pages ---------------------------------------------------------------------------------------

export const PAGE_MARK = /=== page (\d+) ===/g;

/** Join per-page text under the record's page markers, so quotes and find() can name a page. */
export function pagesToText(pages: string[]): string {
  return pages.map((p, i) => `=== page ${i + 1} ===\n${p.replace(/[ \t]+\n/g, "\n").trim()}`).join("\n\n");
}

/**
 * Does this PDF carry a usable text layer? A scan yields nothing or a few stray glyphs per page;
 * a born-digital document yields sentences. The threshold is per page, so a 40-page scan with one
 * typed cover sheet still goes to the OCR lane.
 */
export function hasTextLayer(pages: string[]): boolean {
  if (pages.length === 0) return false;
  const words = pages.reduce((n, p) => n + (p.match(/[A-Za-z]{3,}/g)?.length ?? 0), 0);
  return words >= Math.max(20, 8 * pages.length);
}

/** The 1-based page an offset in marked text falls on, or null when the text has no markers. */
export function pageAt(text: string, offset: number): number | null {
  const marks = text.slice(0, offset).match(PAGE_MARK);
  return marks ? Number(marks[marks.length - 1].match(/\d+/)![0]) : null;
}

// ---- the firm's evidence vocabulary ------------------------------------------------------------

const BASE_DOC_TYPES = [
  "attorney_work_product", "cv", "award_certificate", "award_letter", "expert_letter", "employment_letter",
  "offer_letter", "publication", "citation_report", "judging_invitation", "judging_confirmation", "press_article",
  "membership_certificate", "patent", "salary_evidence", "degree", "transcript", "passport", "visa_record",
  "government_form", "contract", "email", "presentation",
];

const CASE_DOC_TYPES: Record<string, string[]> = {
  "EB1A": ["exhibition_record", "leadership_evidence", "media_circulation_evidence", "selection_criteria"],
  "EB2-NIW": ["proposed_endeavor_statement", "business_plan", "grant_notice", "funding_award", "letter_of_intent", "policy_evidence"],
  "O1A": ["consultation_letter", "itinerary", "agent_agreement", "deal_memo", "event_program"],
  "H1B": ["lca", "credential_evaluation", "job_description", "support_letter", "org_chart", "pay_stub", "beneficiary_cv"],
};

/**
 * The document types the reader may file a document under, in the firm's language for this case
 * type. A doc filed in the firm's vocabulary sorts itself into the petition; "other" is the last
 * resort and stays available.
 */
export function evidenceVocabulary(caseType: string | null | undefined): string[] {
  const key = (caseType ?? "").toUpperCase().replace(/\s+/g, "-");
  return [...BASE_DOC_TYPES, ...(CASE_DOC_TYPES[key] ?? []), "other"];
}
