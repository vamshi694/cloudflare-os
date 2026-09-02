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
  /** The most recent reading problem on a document still queued, reading or failed, in plain words. Null when reading is clean. */
  lastReadNote: string | null;
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

// ── Case knowledge, readiness, the petition, the docket, the client ─────────────────────────────

/** An entity in the case knowledge: a person, organization, project, work product, publication, achievement or credential. */
export interface CaseEntity {
  id: string;
  name: string;
  kind: "person" | "organization" | "project" | "work_product" | "publication" | "achievement" | "credential" | "other";
  /** How much the record says about it. */
  salience: number;
  description: string;
  claimCount: number;
  /** True when the attorney fixed this entity; never rename or merge it. */
  locked: boolean;
}

/** A legal claim binding entities, argued in petition sections, resting on facts. */
export interface CaseClaim {
  id: string;
  statement: string;
  /** Petition section keys this claim argues in. */
  criteria: string[];
  entityIds: string[];
  /** At least one fact id. A claim with no fact is not a claim. */
  factIds: string[];
  removed: boolean;
}

export interface SectionReadiness {
  key: string;
  title: string;
  /** The sufficiency gate's verdict: none, thin or sufficient. This is THE evidence verdict; never second-guess it with your own count. */
  evidence: "none" | "thin" | "sufficient";
  supportingClaims: number;
  supportingDocuments: number;
  /** What would strengthen it, for the client ask. */
  stillNeeded: string[];
}

export interface Readiness {
  caseType: string | null;
  sections: SectionReadiness[];
  sufficient: number;
  required: number;
  /** build: draft the whole letter. build_with_gaps: draft cleared sections, hold the rest, ask the client. gather: ask the client first. undecided: set the case type first. */
  gate: "build" | "build_with_gaps" | "gather" | "undecided";
  stillNeeded: string[];
}

/** The case knowledge: entities and claims built from the facts, plus the readiness the gate derives from them. */
export interface MatterKnowledge {
  /** The whole map: entities, claims. Read `readiness()` for the verdict, never count claims yourself. */
  map(): Promise<{ entities: CaseEntity[]; claims: CaseClaim[]; builtAt: string | null; building: boolean }>;
  /**
   * Add a claim to the case knowledge. `entities` are names with kinds; existing entities are
   * matched by name. Every claim needs at least one fact id from `evidence.facts()`.
   */
  addClaim(input: { statement: string; criteria: string[]; entities: { name: string; kind: CaseEntity["kind"] }[]; factIds: string[] }): Promise<{ id: string }>;
  /** Change which sections a claim argues in. */
  retagClaim(claimId: string, criteria: string[]): Promise<void>;
  /** Merge duplicate entities (the firm's chore, ledgered and undoable). Locked entities cannot be merged. */
  mergeEntities(keepId: string, mergeId: string, reason: string): Promise<void>;
  /** Describe an entity in plain legal English from its claims. */
  describeEntity(entityId: string, description: string): Promise<void>;
  /** The sufficiency gate's verdict per section, from the claims on file. */
  readiness(): Promise<Readiness>;
  /**
   * Rebuild the case knowledge from every fact on the record. Long-running; returns at once.
   * The firm runs this itself after a record settles; call it only when the attorney asks or the
   * record changed materially (documents removed, relevance rulings).
   */
  rebuild(): Promise<void>;
  /** The case type catalog: sections, criteria, purposes, forms, for every visa the firm practices. */
  caseTypes(): Promise<{ key: string; title: string; required: number; sections: { key: string; title: string; criterion: string; purpose: string; evidentiary: boolean }[] }[]>;
}

export interface PetitionSectionState {
  key: string;
  title: string;
  criterion: string;
  purpose: string;
  status: "not_drafted" | "held" | "drafting" | "drafted";
  body: string;
  version: number;
  heldReasons: string[];
  evidence: "none" | "thin" | "sufficient";
  review: { score: number; weaknesses: { severity: "high" | "medium" | "low"; issue: string; fix: string }[] } | null;
  guidance: string | null;
}

/** The petition letter: one section at a time, every version kept. */
export interface MatterPetition {
  /** Every section with its state and current body. */
  sections(): Promise<PetitionSectionState[]>;
  /** Mark a section as being written, so the attorney's screen says "the firm is writing this section now". */
  begin(key: string): Promise<void>;
  /**
   * Land a draft. `citedFactIds` are the facts the prose relies on; exhibits are assigned from them.
   * Cite exhibits in the prose as "Exhibit N" using the numbers from `exhibits()`. Quote only the
   * verbatim words of facts; the verifier rejects quotes it cannot find.
   */
  write(key: string, body: string, citedFactIds: string[]): Promise<{ version: number; unverifiedQuotes: number }>;
  /** Hold a section: the evidence is too thin; say what was requested from the client. */
  hold(key: string, reasons: string[]): Promise<void>;
  /** Record the adversarial reviewer's read of a section: a score 0 to 100 and specific weaknesses, each with a fix. */
  review(key: string, score: number, weaknesses: { severity: "high" | "medium" | "low"; issue: string; fix: string }[]): Promise<void>;
  /** The exhibit list: which document carries which exhibit number. Assign with `assignExhibits()` before citing. */
  exhibits(): Promise<{ exhibitNo: number; documentId: string; title: string }[]>;
  /** Number the record's included documents as exhibits in the order given (document ids). */
  assignExhibits(documentIds: string[]): Promise<void>;
  /** The attorney's standing directive for the whole letter (target pages, instruction). */
  directive(): Promise<{ targetPages: number | null; text: string } | null>;
  /** Record cross-section findings from a coherence pass. */
  recordCoherence(findings: { a: string; b: string; issue: string; fix: string; severity: "high" | "medium" | "low" }[]): Promise<void>;
  /** Save a version of the whole letter (after a full draft or a revision). */
  saveVersion(reason: string): Promise<{ id: string }>;
  /** Pending redraft instructions from the attorney (from the workbench), oldest first. Work each one, then `resolveInstruction`. */
  instructions(): Promise<{ id: string; key: string | null; instruction: string; at: string }[]>;
  resolveInstruction(id: string): Promise<void>;
}

/** Government forms for this filing, filled from the evidence with a source per value. */
export interface MatterForms {
  list(): Promise<{ code: string; title: string; filedOnline: boolean; status: string; fields: { name: string; label: string; value: string | null; sourceFactId: string | null }[] }[]>;
  /** Fill fields on a form. Every value names the fact it came from, or null when the attorney must supply it. */
  fill(code: string, values: { name: string; value: string | null; sourceFactId: string | null }[]): Promise<void>;
}

export interface Deadline {
  id: string; title: string; dueOn: string; kind: "filing" | "rfe" | "client" | "internal" | "other"; met: boolean; daysLeft: number;
}

/** The docket: the dates the firm must not miss. */
export interface MatterDocket {
  list(): Promise<Deadline[]>;
  /** Docket a deadline. `dueOn` is an ISO date. RFE clocks use kind "rfe". */
  add(title: string, dueOn: string, kind: Deadline["kind"]): Promise<{ id: string }>;
  markMet(id: string): Promise<void>;
}

/** The client on this matter, and the firm's outreach to them. */
export interface MatterClient {
  record(): Promise<{ name: string; email: string | null; phone: string | null; portal: "not_invited" | "invited" | "signed_in" | "expired"; documentsSent: number }>;
  /** Every message between the firm and the client, oldest first. */
  messages(): Promise<{ id: string; direction: "outbound" | "inbound"; subject: string | null; body: string; at: string; sent: boolean; source: string }[]>;
  /**
   * Draft a message to the client. It does NOT go out: it lands on the attorney's desk as an
   * outreach to release, shown to them exactly as written. Write the whole message, plainly, as
   * the firm speaking to its client. Never promise dates or outcomes.
   */
  draft(subject: string, body: string): Promise<{ itemId: string }>;
  /** The client's own words and answers submitted through the portal, newest first. */
  submissions(): Promise<{ id: string; at: string; text: string }[]>;
}

/** Extensions to the matter session. The methods below are reached the same way as `files()`. */
export interface MatterSession {
  /** The case knowledge and readiness. */
  knowledge(): Promise<MatterKnowledge>;
  /** The petition letter. */
  petition(): Promise<MatterPetition>;
  /** The government forms. */
  forms(): Promise<MatterForms>;
  /** The docket. */
  docket(): Promise<MatterDocket>;
  /** The client and the outreach. */
  client(): Promise<MatterClient>;
  /**
   * Put a plan on the attorney's desk for approval. Write plan.md on the desk first; this raises
   * the plan decision that shows the plan's phases and lets the attorney edit and approve it.
   * Do not draft the petition before the plan is approved.
   */
  proposePlan(summary: string): Promise<{ id: string }>;
  /** True once the attorney approved the plan (possibly edited: re-read plan.md). */
  planApproved(): Promise<boolean>;
}

// ── WP-C · The firm's matters (MATTERS, the singleton on every workspace) ────────────────────────
// Delimited block: the firm-wide capability. Everything above is one matter (MATTER).

export interface FirmMatterSummary {
  id: string;
  title: string;
  caseType: string | null;
  clientName: string;
  status: "open" | "paused" | "closed";
  record: { documents: number; reading: number; failed: number; facts: number };
  needsYou: { openDecisions: number; unreadableDocuments: number };
}

export interface FirmBriefRow {
  matterId: string;
  title: string;
  caseType: string | null;
  /** The matter's own open question for the attorney, when there is one. */
  ask: string | null;
  /** The single strongest signal: paused by the attorney, needs them, or still reading. */
  signal: { kind: "paused" | "needs_you" | "reading" | "updates"; count: number };
}

/**
 * Every matter on this lawyer's desk. Use it to answer firm-level questions ("which cases need
 * documents?", "what needs me today?"). For anything about one matter's record, open it.
 */
export interface FirmMattersSession {
  /** One line per matter: where it stands and what needs the attorney. */
  listMatters(): Promise<FirmMatterSummary[]>;
  /** One matter in depth: its overview, the open decisions, and recent activity. `matterId` from listMatters(). */
  readMatter(matterId: string): Promise<{ overview: MatterOverview; openDecisions: Decision[]; activity: ActivityEntry[] }>;
  /** The day: how many items need the attorney, the matters that are active and why, and how many rest. */
  brief(): Promise<{ needsYou: number; active: FirmBriefRow[]; resting: number; today: string }>;
  /** The full matter session (documents, evidence, desk, decisions) for one matter, for questions about its record. */
  openMatter(matterId: string): Promise<MatterSession>;
}

// ── Waking the counsel (WP-D) ───────────────────────────────────────────────────────────────────

/** What changed on the matter, delivered to the counsel's chat when the record moves without them. */
export interface MatterEvent {
  /** "record settled", "decision answered", "instruction queued", "client submission", "client replied", "knowledge built", "form requested", "resumed". */
  reason: string;
  /** One plain sentence about what happened, to act on. */
  summary: string;
  at: string;
}

/** The callback the counsel hands to `watch()`. Pass `self`: the matter then delivers `matterEvent` to this chat and activates you. */
export interface MatterWatcher {
  matterEvent(event: MatterEvent): Promise<void>;
}

export interface MatterSession {
  /**
   * Have the matter wake you whenever it changes without you: a record settles, the attorney
   * answers a decision or asks for a redraft, the client uploads or writes. Call this ONCE per
   * matter, on your first turn, passing `self` (the persistent handle to this chat):
   * `await env.MATTER.watch(self)`. It is idempotent while a watch is live. The attorney enables
   * the hook from their screen; until then, events wait on the record. A paused matter never wakes you.
   */
  watch(callback: RpcStub<MatterWatcher>): Promise<{ status: "bound" | "already_watching" }>;
}
