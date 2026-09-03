// Legal OS: the typed RPC the firm's screens use to work matters. Minted per user by the Matters
// gatekeeper account (see AuthenticatedApi.getLegalDesk) and passed to the frontend as a Cap'n Web
// stub. Everything here is the lawyer's own desk; the agent reaches the same store through the
// MatterSession binding instead.

import type { RpcTarget } from "capnweb";
import type {
  AuditExport, ConflictHit,
  CaseMap, CaseTypeSpec, ClientMessage, ClientRecord, Deadline, FirmBrief, GovernmentForm,
  BlastRadius, Chronology, Contradiction, CriteriaFindings, EntityPath, GapAudit, Grounding, IntelRun,
  OrganizeProposal, RecordInventory, ReviewState,
  FirmInbox, MatterDirective, MatterPhase, MatterStatusLine, MemoryNote, NeedsYouItem, Petition, PetitionSection,
  PlaybookChange, PlaybookEntry, Readiness, SearchResult, IntakeView,
  Exemplar, Precedent, TableColumn, TableView,
  Deliverable, Filing, RecommendationLetter, Recommender,
} from "./legal-contract.js";

export * from "./legal-contract.js";
// WP-13
import type { DocketView, KeyDates, RfeResponse, RfeState } from "./legal-contract.js";

export type MatterListEntry = {
  id: string;
  title: string;
  caseType: string | null;
  clientName: string;
  createdAt: string;
  /** The workspace whose chat is this matter's conversation, once one exists. */
  workspaceId: string | null;
  status: "open" | "paused" | "closed";
  /** Reading counts, so the list can say "reading 3 documents" without a second call. */
  record: { documents: number; reading: number; failed: number; facts: number };
  needsYou: { openDecisions: number; unreadableDocuments: number };
  /** Where the firm is on this matter, for the one honest status line. */
  phase: MatterPhase;
  /** The date the firm must not miss, so the desk can order by it. */
  nextDeadline: Deadline | null;
};

export type LegalDocument = {
  id: string;
  filename: string;
  displayTitle: string | null;
  docType: string | null;
  mime: string;
  bytes: number;
  pageCount: number | null;
  status: "queued" | "reading" | "ready" | "empty" | "failed" | "superseded";
  uploadedBy: "client" | "lawyer" | "agent";
  relevance: "included" | "excluded" | "check";
  factCount: number;
  exhibitNo: number | null;
  note: string | null;
  uploadedAt: string;
};

export type LegalFact = {
  id: string;
  documentId: string;
  documentTitle: string;
  page: number | null;
  statement: string;
  quote: string;
  occurredOn: string | null;
  dateAmbiguous: boolean;
  significance: string | null;
  confidence: number;
  verifiedBy: string | null;
};

export type LegalDecision = {
  id: string;
  question: string;
  options: string[];
  status: "open" | "answered";
  answer: string | null;
  raisedAt: string;
  answeredAt: string | null;
};

export type LegalActivity = { at: string; actor: string; summary: string };

export type MatterOverviewView = {
  id: string;
  title: string;
  caseType: string | null;
  clientName: string;
  status: "open" | "paused" | "closed";
  workspaceId: string | null;
  record: {
    documents: number; reading: number; ready: number; empty: number; failed: number;
    superseded: number; facts: number; stillArriving: boolean;
  };
  needsYou: { openDecisions: number; unreadableDocuments: number };
  lastReadNote: string | null;
  planHead: string | null;
  today: string;
  /** The status row: what the firm is doing (left) and what the calendar holds (right). */
  statusLine: MatterStatusLine;
  /** Everything waiting on the attorney, in the order to show it. */
  needsYouItems: NeedsYouItem[];
  /** Whether the client is on the matter (record, portal or messages), for the Messages tab. */
  hasClientRecord: boolean;
  clientMessages: number;
};

/** The firm's method as it applies to one matter: the governing playbook documents and the standing rules. */
export type MatterMethod = {
  caseType: string | null;
  /** Case-type documents for this visa plus the firm-wide ones; reference filings excluded. */
  documents: PlaybookEntry[];
  /** Standing rules for this case type and the whole firm, each with the document it lives in. */
  rules: { slug: string; rule: string; why: string | null }[];
  /** Per petition section, the playbook passage the firm follows (empty when the playbook has none). */
  guidance: { key: string; title: string; heading: string; guidance: string }[];
  /** False when the firm's playbook could not be reached; the screen says so instead of showing nothing. */
  available: boolean;
};

/** One matter, from the lawyer's side. */
export interface MatterDesk extends RpcTarget, MatterProcessDesk {
  overview(): Promise<MatterOverviewView>;
  /** The playbook documents and standing rules that govern this matter. */
  method(): Promise<MatterMethod>;
  documents(options?: { includeSuperseded?: boolean }): Promise<LegalDocument[]>;
  /** The extracted text of a document that has been read. */
  documentText(documentId: string): Promise<{ text: string; pageCount: number | null }>;
  facts(options?: { documentId?: string; limit?: number; offset?: number }): Promise<LegalFact[]>;
  activity(limit?: number): Promise<LegalActivity[]>;
  decisions(): Promise<LegalDecision[]>;
  answerDecision(id: string, answer: string): Promise<void>;
  deskFiles(): Promise<{ path: string; rev: number; updatedAt: string; updatedBy: string }[]>;
  deskRead(path: string): Promise<{ content: string; rev: number } | null>;
  setRelevance(documentId: string, relevance: "included" | "excluded" | "check", reason: string): Promise<void>;
  reread(documentId: string): Promise<void>;
  setStatus(status: "open" | "paused"): Promise<void>;
  setCaseType(caseType: string | null): Promise<void>;
  setWorkspace(workspaceId: string): Promise<void>;
  /**
   * Upload in parts. Each part except the last must be at least 5 MiB (R2 multipart rule); the
   * frontend slices at 5 MiB. `finish` registers the document and queues it for reading.
   */
  beginUpload(filename: string, mime: string): Promise<{ uploadId: string }>;
  uploadPart(uploadId: string, partNumber: number, bytes: Uint8Array): Promise<void>;
  finishUpload(uploadId: string): Promise<{ id: string; status: string }>;
  abortUpload(uploadId: string): Promise<void>;
  /** Remove a document and its earlier versions; its facts and claims retire. */
  removeDocument(documentId: string): Promise<void>;
  /** The firm's read of one document: filed as, evidence for, how it is used, what it says. */
  dossier(documentId: string): Promise<{
    filedAs: string | null; evidenceFor: string[]; roleInCase: string | null; summary: string | null;
    versions: { id: string; version: number; filename: string; uploadedAt: string; current: boolean }[];
  } | null>;
  /** Pin which sections a document supports; retags every claim it grounds. Final over the machine. */
  setSupports(documentId: string, criteria: string[]): Promise<void>;
  /** A short-lived URL to view the original file in the DocViewer. */
  fileUrl(documentId: string): Promise<string>;

  // The case map.
  caseMap(): Promise<CaseMap>;
  renameEntity(entityId: string, name: string): Promise<void>;
  retagClaim(claimId: string, criteria: string[]): Promise<void>;
  setClaimRemoved(claimId: string, removed: boolean): Promise<void>;
  revertOverride(overrideId: string): Promise<void>;
  /** Ask the firm to rebuild the case knowledge from the record. Returns at once; caseMap().building says so. */
  rebuildKnowledge(): Promise<void>;

  // Readiness and the case type.
  caseTypes(): Promise<CaseTypeSpec[]>;
  readiness(): Promise<Readiness>;

  // The petition workbench.
  petition(): Promise<Petition>;
  section(key: string): Promise<PetitionSection | null>;
  /** Redraft one section on the attorney's instruction. `remember` teaches the firm a durable rule for this case type. */
  redraftSection(key: string, instruction: string, options?: { remember?: boolean }): Promise<void>;
  setDirective(directive: { targetPages: number | null; text: string } | null, options?: { rebalance?: boolean }): Promise<void>;
  /** Draft or re-draft every cleared section. */
  draftPetition(): Promise<void>;
  /** The letter as one markdown document, the filing frame included. */
  exportLetter(): Promise<{ markdown: string; versionId: string }>;
  /** The adversarial RFE read of the current letter. */
  simulateRfe(): Promise<{ risk: "high" | "medium" | "low"; summary: string; issues: { severity: "high" | "medium" | "low"; section: string; issue: string; uscisWouldAsk: string; fix: string }[]; cached: boolean }>;
  forms(): Promise<GovernmentForm[]>;
  prepareForm(code: string): Promise<void>;
  acceptFormField(code: string, name: string, value: string): Promise<void>;
  approveForm(code: string): Promise<void>;
  /** Fetch the official USCIS PDF into the firm's store and discover its fillable fields. Honest failure in `template.note`. */
  fetchFormTemplate(code: string): Promise<GovernmentForm>;
  /** Render the filled form (editable for review) and return a short-lived URL to view it. */
  formPreviewUrl(code: string): Promise<{ url: string; renderedAt: string }>;
  /** The attorney corrects a value; it is accepted as corrected. */
  editFormField(code: string, name: string, value: string): Promise<void>;
  /** Ask the firm about a value: raises a decision naming the form and field; the field shows as asked. */
  askAboutFormField(code: string, name: string, question: string): Promise<void>;
  /** Reject the firm's value; the field is blank on the form until it is refilled. */
  rejectFormField(code: string, name: string, reason: string): Promise<void>;
  /** Ask the client to sign the filled form through the portal. Requires an approved form. */
  requestFormSignature(code: string): Promise<void>;

  // The docket.
  deadlines(): Promise<Deadline[]>;
  addDeadline(input: { title: string; dueOn: string; kind: Deadline["kind"] }): Promise<Deadline>;
  markDeadlineMet(id: string): Promise<void>;
  // ── WP-13 · The docket's key dates and derived windows; the RFE workbench ──
  /** The whole docket: docketed deadlines, windows derived from the key dates, RFE clocks, and the priority date's standing. */
  docket(): Promise<DocketView>;
  setKeyDates(input: Partial<KeyDates>): Promise<KeyDates>;
  /** The open Request for Evidence with its asks, evidence and response drafts; null when none is on the record. */
  rfe(): Promise<RfeState | null>;
  /** Ask the firm to draft the response to one ask from the record and the playbook's RFE doctrine. Returns at once; rfe() shows the draft when it lands. */
  draftRfeResponse(askId: string): Promise<void>;
  /** Save the attorney's own wording of a response; quotes are re-verified against the record. */
  saveRfeResponse(askId: string, body: string): Promise<RfeResponse>;
  /** Approve a response; refused while any quote in it is unverified. */
  approveRfeResponse(askId: string): Promise<void>;
  closeRfe(status: "responded" | "closed"): Promise<void>;

  // The client and the messages.
  client(): Promise<ClientRecord>;
  setClient(input: { name?: string; email?: string | null; phone?: string | null }): Promise<ClientRecord>;
  /** Mint (or re-mint) the client's private portal link. The old link dies in the same act. */
  invitePortal(): Promise<{ url: string }>;
  messages(): Promise<ClientMessage[]>;
  /** The attorney writing to the client themselves. Sending IS the decision; no approval card. */
  sendMessage(body: string, subject?: string | null): Promise<ClientMessage>;
  /** Release an agent-drafted outreach exactly as shown, or decline it with a reason the firm re-plans from. */
  releaseOutreach(itemId: string): Promise<void>;
  declineItem(itemId: string, reason: string): Promise<void>;

  // WP-11: the client intake questionnaire. Answers are the client's statements, used for the
  // forms and the counsel's context, never as evidence for the petition.
  intake(): Promise<IntakeView>;
  /** The lawyer correcting or entering answers on the client's behalf. Empty string clears. */
  saveIntake(answers: Record<string, string>): Promise<IntakeView>;
  /** Ask the client to fill it: the portal shows the questionnaire first from now on. */
  sendIntake(): Promise<IntakeView>;

  // Case intelligence (WP-5). Long passes (contradictions, reviews, findings, gaps, strategy,
  // organize) return at once; the matching read reports `running` and a note when one stopped early.
  chronology(): Promise<Chronology>;
  contradictions(): Promise<Contradiction[]>;
  resolveContradiction(id: string, outcome: "resolved" | "dismissed", note: string): Promise<void>;
  blastRadius(documentId: string): Promise<BlastRadius>;
  entityPath(fromEntityId: string, toEntityId: string): Promise<EntityPath>;
  review(kind: "duplicate" | "conflict"): Promise<ReviewState>;
  /** The attorney rules on a pair the firm left pending or got wrong; ledgered like any override. */
  decideReview(pairId: string, verdict: "merge" | "set_aside" | "keep"): Promise<void>;
  criteriaFindings(): Promise<CriteriaFindings>;
  gapAudit(): Promise<GapAudit>;
  grounding(): Promise<Grounding>;
  inventory(): Promise<RecordInventory>;
  organizeProposal(): Promise<OrganizeProposal | null>;
  /** Apply the proposal: retitle documents and number the exhibits as proposed. */
  applyOrganization(): Promise<void>;
  /** Start a pass. Returns at once; the pass reports through its read. */
  runIntel(kind: IntelRun): Promise<void>;
  intelRunning(): Promise<Record<IntelRun, boolean>>;

  // The filing: the packet binder with its signed manifest, the Word letter, recommenders and
  // their letters, and the documents the firm wrote on the desk.
  /** Bind the USCIS packet for the letter as it stands. Stamped DRAFT while any quote is unverified. */
  buildPacket(): Promise<Filing>;
  filings(): Promise<Filing[]>;
  /** The letter alone, as Word. */
  exportWord(): Promise<{ url: string; versionId: string }>;
  deliverables(): Promise<Deliverable[]>;
  deliverableWord(path: string): Promise<{ url: string }>;
  recommenders(): Promise<Recommender[]>;
  /** Have the firm propose recommenders from the case map and the record. */
  suggestRecommenders(): Promise<Recommender[]>;
  addRecommender(input: { name: string; title?: string | null; organization?: string | null; relationship?: string | null; basis?: string | null }): Promise<Recommender>;
  updateRecommender(id: string, patch: { name?: string; title?: string | null; organization?: string | null; relationship?: string | null; basis?: string | null; status?: Recommender["status"] }): Promise<Recommender>;
  removeRecommender(id: string): Promise<void>;
  /** The attorney's list is final: named ones are confirmed (added when new), suggestions left out are declined. */
  reconcileRecommenders(names: string[]): Promise<{ confirmed: number; added: number; declined: number }>;
  letters(): Promise<RecommendationLetter[]>;
  /** Write letters for the confirmed recommenders (or the ones given) from the record, quote-verified. */
  generateLetters(recommenderIds?: string[]): Promise<{ written: RecommendationLetter[]; failed: { recommenderId: string; reason: string }[] }>;
  approveLetter(id: string): Promise<void>;

  // Deleting the matter is two-factor: the phrase to type is the matter title.
  deleteMatter(confirmTitle: string): Promise<void>;

  // WP-16: the matter's audit export, a zip the firm owns (activity, decisions, directives, the
  // document list with fingerprints, petition versions and signed manifests, forms rulings, signatures).
  exportAudit(): Promise<AuditExport>;

  // ── Tabular review (WP-14) ──
  /** The review grid: every document a row, every question a column. Cells fill as the firm answers. */
  tableView(): Promise<TableView>;
  /** Ask a question of every document on the record; a new column, answered one lane job per document. */
  addTableQuestion(question: string): Promise<TableColumn>;
  removeTableQuestion(key: string): Promise<void>;
  /** Answer the firm's own columns for any document not yet answered (and re-ask a failed one). */
  refreshTable(): Promise<{ queued: number }>;
  /** The grid as CSV, ready to save. */
  tableCsv(): Promise<string>;
}

/** The lawyer's matters. */
export interface LegalDesk extends RpcTarget {
  listMatters(): Promise<MatterListEntry[]>;
  createMatter(input: { title: string; clientName: string; caseType: string | null; clientEmail?: string | null }): Promise<MatterListEntry>;
  /** The URL to bind this matter into a workspace chat: legal://matter/<id>. */
  matterResourceUrl(matterId: string): Promise<string>;
  openMatter(matterId: string): Promise<MatterDesk>;
  /** The morning brief: what needs the lawyer across every matter, the docket, and the rest. */
  brief(): Promise<FirmBrief>;
  caseTypes(): Promise<CaseTypeSpec[]>;
  /** Every item waiting on the lawyer across their matters, urgent kinds first, with the matters that could not be read. */
  inbox(): Promise<FirmInbox>;
  /** Facts and documents across the lawyer's matters that mention the query, best first. */
  search(query: string, options?: { limit?: number }): Promise<SearchResult[]>;
  /**
   * WP-16: the conflict check at intake. Every matter in the firm (not only this lawyer's) whose
   * client, title, or case-map entity matches one of the party names, so a new matter never opens
   * against a party the firm already represents or opposes without the attorney seeing it.
   */
  conflictCheck(names: string[]): Promise<ConflictHit[]>;
}

/** Per-matter standing directives and memory notes, on the desk. */
export interface MatterProcessDesk {
  directives(): Promise<MatterDirective[]>;
  addDirective(text: string, scope?: MatterDirective["scope"]): Promise<MatterDirective>;
  removeDirective(id: string): Promise<void>;
  memoryNotes(): Promise<MemoryNote[]>;
  addMemoryNote(text: string): Promise<MemoryNote>;
  removeMemoryNote(id: string): Promise<void>;
}

/** A learning run: the counsel reads a reference filing and proposes what the playbook should learn. */
export type LearningRun = {
  id: string;
  referenceSlug: string;
  referenceTitle: string;
  startedAt: string;
  startedBy: string;
  /** queued: handed to the counsel. proposed: a change awaits approval. adopted: applied. reverted: undone. declined. */
  status: "queued" | "proposed" | "adopted" | "reverted" | "declined";
  /** The playbook document the run changed, once it did. */
  changedSlug: string | null;
  summary: string | null;
  updatedAt: string;
};

/** The firm's playbooks, from the lawyer's side: read, edit (copy-on-write), history. */
export interface PlaybookDesk extends RpcTarget {
  list(): Promise<PlaybookEntry[]>;
  read(slug: string): Promise<{ slug: string; title: string; markdown: string; layer: "firm" | "personal"; category: PlaybookEntry["category"]; scope: string } | null>;
  /** Save this lawyer's copy. Admins pass `layer: "firm"` to edit the firm's base copy for everyone. */
  save(slug: string, input: { title: string; markdown: string; category: PlaybookEntry["category"]; scope: string }, options?: { layer?: "firm" | "personal"; note?: string }): Promise<void>;
  history(slug: string): Promise<{ at: string; note: string | null; markdown: string }[]>;
  changes(limit?: number): Promise<PlaybookChange[]>;
  /** Drop this lawyer's personal copy so the firm's base applies again. */
  revertToFirm(slug: string): Promise<void>;
  /** Teach the firm: every learning run, newest first. */
  learningRuns(): Promise<LearningRun[]>;
  /**
   * Start a run from a reference filing in the library. Returns the message to hand the counsel
   * in the firm's conversation; the run's status moves as the counsel proposes and the attorney approves.
   */
  startLearningRun(referenceSlug: string): Promise<{ run: LearningRun; seed: string }>;
  /** Undo what an adopted run changed; the document returns to its previous version. */
  revertLearningRun(runId: string): Promise<void>;

  // ── The precedent library (WP-14) ──
  /** The firm's past filings on file, with how many exemplar passages each yielded. */
  precedents(): Promise<Precedent[]>;
  /**
   * Add a past filing (markdown or plain text of the petition letter). The firm reads it into
   * exemplar passages per criterion, using the case type's playbook to name the criteria. Client
   * names stay in the passages only as the filing wrote them; nothing here is evidence.
   */
  uploadPrecedent(input: { title: string; caseType: string; text: string; outcome?: string | null }): Promise<Precedent>;
  removePrecedent(slug: string): Promise<void>;
  /** Exemplar passages for a case type, grouped by the criterion heading they argued. */
  exemplars(caseType: string): Promise<Exemplar[]>;
}
