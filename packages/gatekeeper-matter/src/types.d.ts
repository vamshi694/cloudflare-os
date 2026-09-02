// The agent-facing API of one immigration matter. This file is the agent's only documentation for
// the binding, so every comment says what a method does, what it takes, and what comes back.
//
// A matter is the whole case file for one client and one filing: the documents the client and the
// firm put on the record, the facts read out of them with their verbatim source quotes, the case
// knowledge built from those facts, the questions waiting on the attorney, and the firm's own working
// files. Everything an answer rests on must trace back to a document and a page.

/** How a document is progressing through the firm's reading pipeline. */
export type IngestStatus =
  | "queued"     // uploaded, not yet read
  | "reading"    // text extraction and understanding in progress
  | "ready"      // read; facts recorded
  | "empty"      // read successfully but the document states no usable facts
  | "failed"     // the firm could not read it after retries; surfaced to the attorney
  | "superseded";// an older copy of another document on the record; hidden from lists by default

/** Who put a document on the record. */
export type Uploader = "client" | "lawyer" | "agent";

export interface DocumentSummary {
  id: string;
  /** Original filename as uploaded. */
  filename: string;
  /** A human title the firm gave it after reading ("2019 Nature paper, cited 412 times"). */
  displayTitle: string | null;
  /** What the document is, in the firm's vocabulary (award_certificate, expert_letter, cv, ...). */
  docType: string | null;
  mime: string;
  bytes: number;
  pageCount: number | null;
  status: IngestStatus;
  uploadedBy: Uploader;
  /** included: on the record. excluded: set aside by the attorney. check: flagged for the attorney. */
  relevance: "included" | "excluded" | "check";
  /** Number of facts read from this document. */
  factCount: number;
  /** Exhibit number once the petition assigns one; null before. */
  exhibitNo: number | null;
  /** Why the document failed or was set aside, when it did. */
  note: string | null;
  uploadedAt: string;
}

export interface DocumentText {
  id: string;
  displayTitle: string | null;
  /** The full extracted text. Page breaks are marked as lines reading "=== page N ===". */
  text: string;
  pageCount: number | null;
}

export interface TextHit {
  /** 1-based page the hit is on, when the document has pages. */
  page: number | null;
  /** The verbatim passage around the match, about 300 characters. */
  snippet: string;
}

export interface Fact {
  id: string;
  documentId: string;
  /** The document's display title, for citing without a second lookup. */
  documentTitle: string;
  /** 1-based page the quote is on, when the document has pages. */
  page: number | null;
  /** The fact in one sentence, as the firm would state it. */
  statement: string;
  /** The verbatim words from the document the statement rests on. Cite these, never paraphrase them as a quote. */
  quote: string;
  /** When the fact occurred, as the document states it ("2019", "March 2021", "FY2023"). Null when undated. */
  occurredOn: string | null;
  /** True when the date is inferred or vague ("recently", "last year"). */
  dateAmbiguous: boolean;
  /** Why it matters for an immigration petition, in a phrase. */
  significance: string | null;
  /** 0 to 1. Below 0.6 means the reader was unsure the document says this. */
  confidence: number;
  /** "attorney" once the attorney has confirmed the fact; null otherwise. */
  verifiedBy: string | null;
}

export interface FactFilter {
  /** Only facts from this document. */
  documentId?: string;
  /** Only facts whose statement or quote mentions this text (case-insensitive substring). */
  mentions?: string;
  /** Only facts at or above this confidence. */
  minConfidence?: number;
  /** Maximum facts to return. Default 200. The whole record is always available by paging with `offset`. */
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  fact: Fact;
  /** How the hit was found: exact text match, semantic similarity, or both. */
  via: "exact" | "semantic" | "both";
  score: number;
}

export interface MatterOverview {
  id: string;
  title: string;
  /** The visa or filing type (EB1A, EB2-NIW, O1A, H1B) or null while the firm has not decided. */
  caseType: string | null;
  clientName: string;
  /** open, paused, closed. Paused means the attorney stopped all autonomous work. */
  status: "open" | "paused" | "closed";
  /** Where the record stands, derived from the documents, never from memory. */
  record: {
    documents: number;
    reading: number;
    ready: number;
    empty: number;
    failed: number;
    superseded: number;
    facts: number;
    /** True while any document is still queued or reading. Do not judge the record while true. */
    stillArriving: boolean;
  };
  /** What waits on the attorney right now. */
  needsYou: {
    openDecisions: number;
    unreadableDocuments: number;
  };
  /** The first lines of the matter plan (desk file "plan.md"), or null when no plan exists yet. */
  planHead: string | null;
  /** Today's date in the firm's timezone, ISO. Use this for every date computation. */
  today: string;
}

export interface DeskFile {
  path: string;
  bytes: number;
  /** Monotonic revision. Pass it back as baseRev when writing so two writers cannot clobber each other. */
  rev: number;
  updatedAt: string;
  updatedBy: string;
}

export interface Decision {
  id: string;
  question: string;
  /** Options offered to the attorney, in order. The first is the recommended one. */
  options: string[];
  status: "open" | "answered";
  /** The attorney's answer once given. */
  answer: string | null;
  raisedAt: string;
  answeredAt: string | null;
}

export interface ActivityEntry {
  at: string;
  /** Who did it: "agent", "lawyer", "client", "system". */
  actor: string;
  /** One line in plain legal English. */
  summary: string;
}

/** The documents on the record. */
export interface MatterFiles {
  /**
   * Every document on the record, newest first. Superseded copies are omitted unless
   * `includeSuperseded` is true; the count of hidden copies is always reported in the overview.
   */
  list(options?: { includeSuperseded?: boolean }): Promise<DocumentSummary[]>;
  /**
   * The full extracted text of one document. `reference` is a document id or a filename. Throws if
   * the document is not on the record or has not been read yet.
   */
  read(reference: string): Promise<DocumentText>;
  /**
   * Exact search inside one document's text, like Ctrl+F. Tolerant of whitespace, case and
   * typography. Zero hits means the exact wording is absent, not that the record lacks the point;
   * search the facts by meaning with `evidence.search` and then find the source's own wording here.
   */
  find(reference: string, query: string, options?: { maxResults?: number }): Promise<TextHit[]>;
  /**
   * Put a document on the record. The firm reads it in the background; it appears as `queued`,
   * then `reading`, then `ready`, `empty` or `failed`. Returns the new document's id.
   */
  upload(filename: string, mime: string, bytes: Uint8Array): Promise<{ id: string }>;
  /**
   * Set aside or restore a document on the attorney's direction. `excluded` documents keep their
   * facts on file but are not used for the petition; `check` asks the attorney to rule.
   */
  setRelevance(reference: string, relevance: "included" | "excluded" | "check", reason: string): Promise<void>;
  /** Re-read a document that came back empty or failed. */
  reread(reference: string): Promise<void>;
}

/** The facts read from the record, each with its verbatim source. */
export interface MatterEvidence {
  /** Facts matching the filter, most confident first. */
  facts(filter?: FactFilter): Promise<Fact[]>;
  /**
   * Find facts by meaning and by exact words together. Use this to answer any question about the
   * record; every hit carries the quote and page to cite.
   */
  search(query: string, options?: { limit?: number; documentId?: string }): Promise<SearchHit[]>;
  /** Mark a fact as confirmed by the attorney. Only do this when the attorney says so. */
  verify(factId: string): Promise<void>;
}

/** The matter's desk: the firm's own working files, read by the attorney on their Desk. */
export interface MatterDesk {
  list(): Promise<DeskFile[]>;
  /** The file's content, or null when it does not exist. */
  read(path: string): Promise<{ content: string; rev: number } | null>;
  /**
   * Write a file. Pass the `rev` you last read as `baseRev`; the write is refused when the file
   * changed since, so re-read and merge. Omit `baseRev` only when creating a file.
   * Write for the supervising attorney: plain legal English, no identifiers, no tool names.
   */
  write(path: string, content: string, options?: { baseRev?: number }): Promise<{ rev: number }>;
  /** Delete a file. "plan.md" cannot be deleted. */
  remove(path: string): Promise<void>;
}

/** Questions only the attorney can answer. */
export interface MatterDecisions {
  /**
   * Put a question on the attorney's desk with the options you recommend, first option first.
   * Do not wait for the answer; keep every other track moving and read `answered()` on the next turn.
   */
  raise(question: string, options: string[]): Promise<{ id: string }>;
  /** Every decision, open ones first. */
  list(): Promise<Decision[]>;
}

/** One immigration matter: the whole case file for one client and one filing. */
export interface MatterSession {
  /** Where the matter stands right now, from the record. Read this at the start of every turn. */
  overview(): Promise<MatterOverview>;
  /** The record's recent activity, newest first. */
  activity(options?: { limit?: number }): Promise<ActivityEntry[]>;
  /** Record what you did or found, in one plain sentence, so the attorney can follow the work. */
  note(summary: string): Promise<void>;
  /** Set the visa or filing type once the firm has decided it. */
  setCaseType(caseType: string): Promise<void>;
  /** The documents on the record. Call as `await env.MATTER.files()` then use the returned object, or chain: `env.MATTER.files().list()`. */
  files(): Promise<MatterFiles>;
  /** The facts read from the record with their verbatim sources. */
  evidence(): Promise<MatterEvidence>;
  /** The firm's working files for this matter (plan.md, notes). */
  desk(): Promise<MatterDesk>;
  /** Questions for the attorney. */
  decisions(): Promise<MatterDecisions>;
}
