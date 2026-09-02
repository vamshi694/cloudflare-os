// Legal OS: the typed RPC the firm's screens use to work matters. Minted per user by the Matters
// gatekeeper account (see AuthenticatedApi.getLegalDesk) and passed to the frontend as a Cap'n Web
// stub. Everything here is the lawyer's own desk; the agent reaches the same store through the
// MatterSession binding instead.

import type { RpcTarget } from "capnweb";
import type {
  CaseMap, CaseTypeSpec, ClientMessage, ClientRecord, Deadline, FirmBrief, GovernmentForm,
  MatterPhase, MatterStatusLine, NeedsYouItem, Petition, PetitionSection, PlaybookChange,
  PlaybookEntry, Readiness,
} from "./legal-contract.js";

export * from "./legal-contract.js";

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

/** One matter, from the lawyer's side. */
export interface MatterDesk extends RpcTarget {
  overview(): Promise<MatterOverviewView>;
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

  // The docket.
  deadlines(): Promise<Deadline[]>;
  addDeadline(input: { title: string; dueOn: string; kind: Deadline["kind"] }): Promise<Deadline>;
  markDeadlineMet(id: string): Promise<void>;

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

  // Deleting the matter is two-factor: the phrase to type is the matter title.
  deleteMatter(confirmTitle: string): Promise<void>;
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
}

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
}
