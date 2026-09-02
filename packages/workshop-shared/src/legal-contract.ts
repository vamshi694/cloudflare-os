// Legal OS: the shared shapes the lawyer's screens and the matter backend agree on, beyond the
// record itself (documents, facts, decisions, desk, activity live in ./legal.ts).
//
// Doctrine these types carry (from the Ellis OS brief):
//   - One truth per signal. Evidence sufficiency comes from the gate; draft quality from the reviewer.
//     They are never blended into one number.
//   - Verdicts lead, numbers recede. Pages, never words. Lawyer language, never machinery.
//   - Every claim traces to facts, every fact to a document and a verbatim quote.
//   - Nothing leaves the firm (client messages, filings) without the attorney's release.

// ── Case knowledge (the case map) ───────────────────────────────────────────────────────────────

/** The fixed kinds an entity can be. The map colors by kind; everything else is grey. */
export type EntityKind =
  | "person" | "organization" | "project" | "work_product" | "publication"
  | "achievement" | "credential" | "other";

export type CaseEntity = {
  id: string;
  name: string;
  kind: EntityKind;
  /** How much the record says about this entity: the number of claims it participates in, weighted. */
  salience: number;
  /** A synthesized description, in plain legal English, from the claims. */
  description: string;
  claimCount: number;
  /** True when the attorney renamed or pinned this entity; the firm's tidy-ups never touch it. */
  locked: boolean;
};

export type CaseClaim = {
  id: string;
  /** The legal claim in one sentence ("Dr. Rao received the IEEE Fellow elevation in 2019"). */
  statement: string;
  /** The petition sections (criteria keys) this claim argues in. */
  criteria: string[];
  entityIds: string[];
  /** The facts this claim rests on. Every claim has at least one. */
  factIds: string[];
  /** Set aside by the attorney; it leaves every brief and petition but stays reversible. */
  removed: boolean;
  /** "attorney" when the attorney retagged or set it aside. */
  editedBy: "attorney" | "firm" | null;
};

/** The ledger of overrides, split by who did it. Reverted entries never show. */
export type CaseOverride = {
  id: string;
  by: "attorney" | "firm";
  kind: "rename" | "retag" | "remove" | "merge" | "pin";
  summary: string;
  at: string;
  reverted: boolean;
};

export type CaseMap = {
  entities: CaseEntity[];
  claims: CaseClaim[];
  overrides: CaseOverride[];
  /** Null when the map has never been built; otherwise when it was last built. */
  builtAt: string | null;
  /** True while the firm is rebuilding the map. Lists that depend on it say so. */
  building: boolean;
  /** How many documents' facts fed the current map. */
  fromDocuments: number;
  /** What the last build reported, in plain words: what it built, or why it stopped early. */
  note: string | null;
  /** While building: batches of facts done against the total, so the map can say "3 of 8". */
  progress: { total: number; done: number } | null;
};

// ── Case type, criteria, readiness ──────────────────────────────────────────────────────────────

/** One section of the petition and the criterion it argues. */
export type CriterionSpec = {
  /** Stable key, e.g. "awards", "membership", "published_material", "judging", "original_contributions". */
  key: string;
  title: string;
  /** The regulatory criterion this section maps to, in words ("8 CFR 204.5(h)(3)(i) — lesser awards"). */
  criterion: string;
  /** What this section argues, in one sentence. */
  purpose: string;
  /** Sections a filing always carries (introduction, conclusion) are never "evidence sections". */
  evidentiary: boolean;
};

export type CaseTypeSpec = {
  /** EB1A, EB2-NIW, O1A, H1B. */
  key: string;
  title: string;
  /** The formal petition title for the letter frame. */
  petitionTitle: string;
  /** How many evidentiary criteria a filing needs (EB-1A: 3 of 10; NIW: all 3 prongs). */
  required: number;
  sections: CriterionSpec[];
  /** The government forms this filing submits, by code. */
  forms: { code: string; title: string; filedOnline: boolean }[];
};

/** The sufficiency gate's verdict for one section. ONE judgment per signal. */
export type SectionEvidence = "none" | "thin" | "sufficient";

export type SectionReadiness = {
  key: string;
  title: string;
  evidence: SectionEvidence;
  supportingClaims: number;
  supportingDocuments: number;
  /** What would strengthen it, for the client ask. Empty when sufficient. */
  stillNeeded: string[];
};

export type Readiness = {
  caseType: string | null;
  sections: SectionReadiness[];
  /** How many evidentiary sections are sufficient, against the case type's requirement. */
  sufficient: number;
  required: number;
  /**
   * build: enough sections clear to draft the whole letter.
   * build_with_gaps: draft the cleared sections; hold the rest and ask the client.
   * gather: too thin to draft anything but the plan; ask the client.
   * undecided: no case type yet.
   */
  gate: "build" | "build_with_gaps" | "gather" | "undecided";
  /** Everything still needed from the client, across sections, deduplicated. */
  stillNeeded: string[];
  computedAt: string;
};

// ── The petition workbench ──────────────────────────────────────────────────────────────────────

export type ReviewWeakness = { severity: "high" | "medium" | "low"; issue: string; fix: string };

export type PetitionSection = {
  key: string;
  title: string;
  criterion: string;
  purpose: string;
  status: "not_drafted" | "held" | "drafting" | "drafted";
  /** Markdown body. Empty until drafted. Exhibit citations read "Exhibit N". */
  body: string;
  words: number;
  version: number;
  /** Why it is held: what was requested from the client. */
  heldReasons: string[];
  /** The gate's verdict for this section's evidence. Never blended with the review score. */
  evidence: SectionEvidence;
  /** The adversarial reviewer's read of this draft, reading as the officer will. Null until reviewed. */
  review: { score: number; weaknesses: ReviewWeakness[]; reviewedAt: string } | null;
  /** Source documents, with how many of their facts the draft cites. */
  builtFrom: { documentId: string; title: string; citedFacts: number }[];
  /** Exhibits routed to this section but never cited. */
  uncitedExhibits: number[];
  /** Quotes in the draft that the verifier could not find in the cited exhibit. */
  unverifiedQuotes: { quote: string; exhibitNo: number | null; reason: "absent" | "wrong_exhibit" | "unverifiable"; foundIn: number | null }[];
  /** The attorney's standing guidance for this section, if any. */
  guidance: string | null;
  updatedAt: string | null;
};

export type PetitionVersion = {
  id: string;
  at: string;
  /** Why it was saved: "drafted", "revised:<section key>", "exported". */
  reason: string;
  sections: number;
  words: number;
};

export type Petition = {
  caseType: string | null;
  petitionTitle: string;
  sections: PetitionSection[];
  /** Exhibit numbers, assigned in citation order. */
  exhibits: { exhibitNo: number; documentId: string; title: string }[];
  directive: { targetPages: number | null; text: string } | null;
  /** Section keys whose drafts cite exhibits no longer on the record. */
  staleSections: string[];
  /** Cross-section findings from the coherence pass. */
  coherence: { a: string; b: string; issue: string; fix: string; severity: "high" | "medium" | "low" }[];
  versions: PetitionVersion[];
  /** True while any section is being drafted or redrafted. */
  writing: boolean;
  /** The drafting lane in flight, or null. Progress the workbench and the status row narrate. */
  lane: DraftingLane | null;
};

export type FormFieldValue = {
  name: string;
  label: string;
  value: string | null;
  /** The fact the value came from, when the firm filled it. */
  sourceFactId: string | null;
  acceptedBy: "attorney" | null;
  /**
   * proposed: the firm filled it and the attorney has not ruled. accepted: the attorney accepted
   * or entered it. asked: the attorney asked the firm about it (a decision is open). rejected:
   * the attorney rejected the value; it is blank on the form until refilled.
   */
  review: "proposed" | "accepted" | "asked" | "rejected";
  /** The official PDF field this value lands in, once the template is on file; null when unmapped. */
  pdfField: string | null;
};

export type GovernmentForm = {
  code: string;
  title: string;
  filedOnline: boolean;
  status: "not_started" | "opened" | "for_review" | "approved" | "awaiting_signature" | "signed";
  fields: FormFieldValue[];
  filled: number;
  accepted: number;
  /**
   * The official USCIS PDF: none until fetched; ready with its fillable fields discovered;
   * failed with the reason in words (the site did not answer, or the PDF is an XFA form pdf
   * tooling cannot fill).
   */
  template: { state: "none" | "ready" | "failed"; note: string | null; fetchedAt: string | null; fillable: number; unmapped: string[] };
  /** When a filled PDF was last rendered, so the preview can say whether it is current. */
  renderedAt: string | null;
  /** The client's signature on the filled form, requested through the portal. */
  signature: { state: "none" | "requested" | "signed"; requestedAt: string | null; signedAt: string | null; signedName: string | null };
};

/** A form waiting for the client's signature in the portal. */
export type PortalSignatureRequest = {
  id: string;
  /** The form's human title, never a code alone. */
  title: string;
  requestedAt: string;
  /** The filled form to review before signing, as a PDF the portal can frame. */
  documentUrl: string;
};

// ── The docket ──────────────────────────────────────────────────────────────────────────────────

export type Deadline = {
  id: string;
  title: string;
  /** ISO date. */
  dueOn: string;
  kind: "filing" | "rfe" | "client" | "internal" | "other";
  /** Where it came from: "attorney", "agent", "rfe". */
  source: string;
  met: boolean;
  daysLeft: number;
  urgency: "overdue" | "in_window" | "later";
};

// ── The client, messages, the portal ────────────────────────────────────────────────────────────

export type ClientRecord = {
  name: string;
  email: string | null;
  phone: string | null;
  portal: "not_invited" | "invited" | "signed_in" | "expired";
  portalUrl: string | null;
  documentsSent: number;
  invitedAt: string | null;
  lastSeenAt: string | null;
};

export type ClientMessage = {
  id: string;
  direction: "outbound" | "inbound";
  subject: string | null;
  body: string;
  at: string;
  /** For outbound: whether the client can see it. A draft by the firm is not sent. */
  sent: boolean;
  /** "lawyer" (typed by the attorney), "agent" (drafted, released by the attorney), "client". */
  source: "lawyer" | "agent" | "client";
};

/** What the client sees. No machinery, no counts of internal state. */
export type PortalView = {
  clientFirstName: string;
  caseTypeTitle: string | null;
  attorney: { name: string; email: string | null } | null;
  status: { line: string; needsClient: boolean };
  requests: { id: string; body: string; at: string }[];
  stillNeeded: string[];
  received: { id: string; name: string; state: "reading" | "trouble" | "read"; label: string | null }[];
  /** Forms the client is asked to sign; empty when none. */
  signatures: PortalSignatureRequest[];
};

// ── Needs-you, phase, the brief ─────────────────────────────────────────────────────────────────

export type NeedsYouItem = {
  id: string;
  kind: "decision" | "plan" | "outreach" | "unreadable_document";
  title: string;
  /** Markdown detail. For outreach, the exact letter, in full. */
  detail: string | null;
  options: string[];
  recommendation: string | null;
  raisedAt: string;
};

export type MatterPhase =
  | "reading" | "not_understood" | "knowledge" | "analysis" | "clearance"
  | "building" | "review" | "idle" | "paused";

/** One of the heavy lanes in flight, counted from the record so the status row never fakes progress. */
export type LaneProgress = { kind: "reading" | "knowledge" | "drafting"; done: number; total: number };

export type MatterStatusLine = {
  phase: MatterPhase;
  /** What the firm is doing right now, in one sentence, or null when idle. */
  narrative: string | null;
  working: boolean;
  nextDeadline: Deadline | null;
  /** The lane in flight (reading, building the case knowledge, drafting), or null when none is. */
  lane: LaneProgress | null;
};

/** The drafting lane: one queue job per cleared section, then the coherence pass. */
export type DraftingLane = {
  id: string;
  total: number;
  drafted: number;
  failed: number;
  /** Sections still being drafted, verified or reviewed. */
  inFlight: number;
  startedAt: string;
};

export type BriefRow = {
  matterId: string;
  title: string;
  caseType: string | null;
  /** The matter's own open question, when there is one. */
  ask: string | null;
  signal: { kind: "paused" | "needs_you" | "reading" | "updates"; count: number } | null;
};

export type FirmBrief = {
  needsYou: number;
  active: BriefRow[];
  moreActive: number;
  resting: number;
  docket: (Deadline & { matterId: string; matterTitle: string })[];
  today: string;
};

// ── The firm's playbooks (the library, from the lawyer's side) ───────────────────────────────────

export type PlaybookEntry = {
  slug: string;
  title: string;
  category: "firm" | "case-type" | "work-type" | "reference";
  scope: string;
  description: string;
  layer: "firm" | "personal";
  updatedAt: string;
};

export type PlaybookChange = {
  id: number;
  at: string;
  slug: string;
  kind: "create" | "evolve" | "learn";
  summary: string;
  by: string;
};

// ── Case intelligence (WP-5): what the firm reasons out of the knowledge ─────────────────────────

export type ChronologyEntry = {
  factId: string;
  documentId: string;
  documentTitle: string;
  page: number | null;
  /** The date as the document states it. */
  when: string;
  year: number | null;
  /** Sort key YYYY-MM-DD with unknown parts filled low, so entries order within a year. */
  sortKey: string;
  /** Inferred, vague, a season, or a range: the reader could not pin the date. */
  ambiguous: boolean;
  statement: string;
  quote: string;
  significance: string | null;
};

export type Chronology = {
  years: { year: number | null; entries: ChronologyEntry[] }[];
  dated: number;
  undated: number;
  computedAt: string;
};

export type ContradictionSide = { factId: string; statement: string; quote: string; documentId: string; documentTitle: string; page: number | null };

export type Contradiction = {
  id: string;
  kind: "date" | "number" | "statement";
  /** Who or what the two sides disagree about. */
  subject: string;
  a: ContradictionSide;
  b: ContradictionSide;
  explanation: string;
  /** Which side the firm would rely on and why, in one sentence; null when it cannot say. */
  recommendation: string | null;
  severity: "high" | "medium" | "low";
  status: "open" | "resolved" | "dismissed";
  resolution: string | null;
  foundAt: string;
};

export type BlastRadius = {
  documentId: string;
  documentTitle: string;
  facts: number;
  claims: { id: string; statement: string; criteria: string[]; /** true when no other live document also grounds it */ onlyHere: boolean }[];
  sections: { key: string; title: string }[];
  petitionSections: { key: string; title: string; status: "not_drafted" | "held" | "drafting" | "drafted" }[];
};

export type EntityPath = {
  found: boolean;
  /** From the first entity to the second: each hop is the claim that joins the previous entity to this one. */
  hops: { entityId: string; entityName: string; claimId: string | null; claimStatement: string | null }[];
};

/** A pair the firm must rule on: two entities that may be one, or two claims that disagree. */
export type ReviewPair = {
  id: string;
  kind: "duplicate" | "conflict";
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  reason: string;
  /** merge (duplicates), set_aside (conflicts: b leaves the case), keep (both stand), pending. */
  verdict: "merge" | "set_aside" | "keep" | "pending";
  decidedBy: "firm" | "attorney" | null;
  /** The ledger entry the verdict produced, so the attorney can undo it from the map. */
  overrideId: string | null;
};

export type ReviewState = {
  kind: "duplicate" | "conflict";
  status: "never" | "running" | "done";
  pairs: ReviewPair[];
  finishedAt: string | null;
  note: string | null;
};

export type CriteriaFinding = {
  key: string;
  title: string;
  verdict: "strong" | "arguable" | "weak" | "absent";
  strongest: { claimId: string; statement: string }[];
  /** What an officer would seize on, each in one sentence. */
  officerWouldSeize: string[];
  note: string;
};

export type CriteriaFindings = {
  sections: CriteriaFinding[];
  assessedAt: string | null;
  running: boolean;
  note: string | null;
};

export type GapItem = {
  id: string;
  key: string;
  title: string;
  /** 1 = blocks the filing, 2 = weakens it, 3 = nice to have. */
  priority: 1 | 2 | 3;
  missing: string;
  /** What to ask the client for, in the client's language. */
  ask: string;
};

export type GapAudit = { items: GapItem[]; auditedAt: string | null; running: boolean; note: string | null };

export type Grounding = {
  /** 0 to 1: the share of live claims resting on a confident fact. */
  score: number;
  claims: number;
  grounded: number;
  /** Claims with at least one fact the attorney verified. */
  verified: number;
};

export type RecordInventory = {
  kinds: { docType: string | null; label: string; count: number; documentIds: string[] }[];
  documents: number;
  unread: number;
};

export type OrganizeProposal = {
  titles: { documentId: string; current: string | null; proposed: string }[];
  exhibitOrder: { documentId: string; title: string; exhibitNo: number; firstSection: string | null }[];
  proposedAt: string;
  note: string | null;
};

export type IntelRun = "contradictions" | "duplicate" | "conflict" | "findings" | "gaps" | "strategy" | "organize";

// ── The firm's process (WP-8): the inbox, search, directives, memory, holds, lane models ────────

/** One item waiting on the lawyer, from any matter on their desk. */
export type InboxItem = NeedsYouItem & { matterId: string; matterTitle: string; caseType: string | null };

/**
 * The firm-wide inbox. `unreachable` names the matters whose queue could not be read, so an empty
 * list never claims "nothing needs you" when a fetch failed.
 */
export type FirmInbox = {
  items: InboxItem[];
  unreachable: { matterId: string; matterTitle: string }[];
  readAt: string;
};

/** A hit in a search across the lawyer's matters. */
export type SearchResult = {
  kind: "fact" | "document";
  matterId: string;
  matterTitle: string;
  /** The document title for a document, the fact's statement for a fact. */
  title: string;
  /** The verbatim quote for a fact, the document's type and status for a document. */
  snippet: string;
  documentId: string;
  page: number | null;
  score: number;
};

/** A standing instruction the attorney gave for the whole matter; the counsel reads them every turn. */
export type MatterDirective = {
  id: string;
  text: string;
  /** What it governs: "matter" (everything), "drafting", "client", "evidence". */
  scope: "matter" | "drafting" | "client" | "evidence";
  createdAt: string;
  createdBy: string;
};

/** A note the counsel or the attorney kept for this matter, outside the record. */
export type MemoryNote = {
  id: string;
  text: string;
  createdAt: string;
  createdBy: "agent" | "lawyer";
};

/** The models each lane runs on; null means the worker's configured default. */
export type LaneModels = {
  reader: string | null;
  knowledge: string | null;
  drafting: string | null;
  critic: string | null;
};

// ── The filing (WP-6): the packet, its manifest, recommenders, letters, deliverables ────────────

export type Recommender = {
  id: string;
  name: string;
  title: string | null;
  organization: string | null;
  /** How they know the beneficiary, in the firm's words. */
  relationship: string | null;
  /** Why the firm suggests them: the facts on the record that make them credible. */
  basis: string | null;
  status: "suggested" | "confirmed" | "declined";
  /** "firm" when the firm suggested them from the record, "attorney" when the attorney added them. */
  source: "firm" | "attorney";
  /** The case-map entity they were drawn from, when any. */
  entityId: string | null;
  updatedAt: string;
};

export type RecommendationLetter = {
  id: string;
  recommenderId: string;
  recommenderName: string;
  /** Markdown body, written in the recommender's voice from the record. */
  body: string;
  words: number;
  version: number;
  status: "drafted" | "approved";
  unverifiedQuotes: { quote: string; exhibitNo: number | null; reason: "absent" | "wrong_exhibit" | "unverifiable"; foundIn: number | null }[];
  citedFacts: number;
  updatedAt: string;
};

/** One assembled packet: the binder, its signed manifest, and (when made) the Word letter. */
export type Filing = {
  versionId: string;
  at: string;
  pages: number;
  exhibits: number;
  forms: string[];
  /** Stamped DRAFT: at least one quote in the letter was unverified when it was bound. */
  draft: boolean;
  packetSha256: string;
  /** Signed, time-limited links; re-read the filing to refresh them. */
  packetUrl: string;
  manifestUrl: string;
  letterDocxUrl: string | null;
};

/** A document the firm wrote on the desk (memo, timeline, letter), with its Word export. */
export type Deliverable = {
  path: string;
  title: string;
  updatedAt: string;
  updatedBy: string;
  words: number;
};
