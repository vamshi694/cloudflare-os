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

