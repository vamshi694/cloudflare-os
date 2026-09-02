// Legal OS: the typed RPC the firm's screens use to work matters. Minted per user by the Matters
// gatekeeper account (see AuthenticatedApi.getLegalDesk) and passed to the frontend as a Cap'n Web
// stub. Everything here is the lawyer's own desk; the agent reaches the same store through the
// MatterSession binding instead.

import type { RpcTarget } from "capnweb";

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
}

/** The lawyer's matters. */
export interface LegalDesk extends RpcTarget {
  listMatters(): Promise<MatterListEntry[]>;
  createMatter(input: { title: string; clientName: string; caseType: string | null }): Promise<MatterListEntry>;
  /** The URL to bind this matter into a workspace chat: legal://matter/<id>. */
  matterResourceUrl(matterId: string): Promise<string>;
  openMatter(matterId: string): Promise<MatterDesk>;
}
