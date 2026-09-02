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
};

export type FormFieldValue = {
  name: string;
  label: string;
  value: string | null;
  /** The fact the value came from, when the firm filled it. */
  sourceFactId: string | null;
  acceptedBy: "attorney" | null;
};

export type GovernmentForm = {
  code: string;
  title: string;
  filedOnline: boolean;
  status: "not_started" | "opened" | "for_review" | "approved" | "awaiting_signature" | "signed";
  fields: FormFieldValue[];
  filled: number;
  accepted: number;
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

export type MatterStatusLine = {
  phase: MatterPhase;
  /** What the firm is doing right now, in one sentence, or null when idle. */
  narrative: string | null;
  working: boolean;
  nextDeadline: Deadline | null;
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
