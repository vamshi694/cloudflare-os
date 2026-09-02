// The lawyer's side of the matter store: the LegalDesk RPC handed to the firm's screens through
// AuthenticatedApi.getLegalDesk(). No approval queue here on purpose: this is a human acting on
// their own desk, not an agent acting outward. Every write is attributed "lawyer".

import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type {
  LegalActivity, LegalDecision, LegalDesk, LegalDocument, LegalFact, MatterDesk, MatterListEntry,
  MatterOverviewView,
} from "@gadgets/workshop-shared/legal";
import type { MatterAccount } from "./matter.js";
import type { MatterStore } from "./store.js";
import { matterUrl } from "./matter.js";

const R2_MIN_PART = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

type PendingUpload = {
  matterId: string; filename: string; mime: string; r2Key: string; upload: R2MultipartUpload;
  parts: R2UploadedPart[]; bytes: number; sha: Uint8Array[];
};

function safeName(filename: string): string {
  return filename.replace(/[\r\n\\/]/g, "_").slice(0, 200) || "document";
}

async function sha256Hex(chunks: Uint8Array[]): Promise<string> {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const joined = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { joined.set(c, off); off += c.byteLength; }
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", joined))].map(b => b.toString(16).padStart(2, "0")).join("");
}

@validateRpc()
export class MatterDeskImpl extends RpcTarget implements MatterDesk {
  // In-flight multipart uploads live in memory for the life of this stub (one browser session).
  readonly #uploads = new Map<string, PendingUpload>();

  constructor(private readonly store: DurableObjectStub<MatterStore>, private readonly env: Cloudflare.Env,
              private readonly matterId: string) { super(); }

  async overview(): Promise<MatterOverviewView> {
    const o = await this.store.overview();
    const meta = await this.store.meta();
    return { ...o, workspaceId: meta?.workspaceId ?? null };
  }
  documents(options?: { includeSuperseded?: boolean }): Promise<LegalDocument[]> {
    return this.store.listDocuments(options?.includeSuperseded ?? false);
  }
  async documentText(documentId: string): Promise<{ text: string; pageCount: number | null }> {
    const d = await this.store.documentText(documentId);
    return { text: d.text, pageCount: d.pageCount };
  }
  facts(options?: { documentId?: string; limit?: number; offset?: number }): Promise<LegalFact[]> {
    return this.store.facts({ documentId: options?.documentId, limit: options?.limit ?? 500, offset: options?.offset ?? 0 });
  }
  activity(limit?: number): Promise<LegalActivity[]> { return this.store.activity(limit ?? 100); }
  decisions(): Promise<LegalDecision[]> { return this.store.listDecisions(); }
  answerDecision(id: string, answer: string): Promise<void> { return this.store.answerDecision(id, answer, "lawyer"); }
  deskFiles(): Promise<{ path: string; rev: number; updatedAt: string; updatedBy: string }[]> { return this.store.deskList(); }
  deskRead(path: string): Promise<{ content: string; rev: number } | null> { return this.store.deskRead(path); }
  setRelevance(documentId: string, relevance: "included" | "excluded" | "check", reason: string): Promise<void> {
    return this.store.setRelevance(documentId, relevance, reason, "lawyer");
  }
  reread(documentId: string): Promise<void> { return this.store.requeue(documentId, "lawyer"); }
  setStatus(status: "open" | "paused"): Promise<void> { return this.store.setStatus(status, "lawyer"); }
  async setCaseType(caseType: string | null): Promise<void> {
    if (caseType) await this.store.setCaseType(caseType.trim().toUpperCase().replace(/\s+/g, "-"), "lawyer");
  }
  setWorkspace(workspaceId: string): Promise<void> { return this.store.setWorkspace(workspaceId); }

  async beginUpload(filename: string, mime: string): Promise<{ uploadId: string }> {
    const name = safeName(filename);
    const id = crypto.randomUUID().replace(/-/g, "");
    const r2Key = `matters/${this.matterId}/docs/${id}/${name}`;
    const upload = await this.env.MATTER_FILES.createMultipartUpload(r2Key, {
      httpMetadata: { contentType: mime || "application/octet-stream" },
    });
    this.#uploads.set(id, { matterId: this.matterId, filename: name, mime: mime || "application/octet-stream", r2Key, upload, parts: [], bytes: 0, sha: [] });
    return { uploadId: id };
  }

  async uploadPart(uploadId: string, partNumber: number, bytes: Uint8Array): Promise<void> {
    const u = this.#uploads.get(uploadId);
    if (!u) throw new Error("Unknown upload.");
    if (u.bytes + bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("This file is larger than the 200 MB limit.");
    const part = await u.upload.uploadPart(partNumber, bytes);
    u.parts.push(part);
    u.bytes += bytes.byteLength;
    u.sha.push(bytes.slice());
  }

  async finishUpload(uploadId: string): Promise<{ id: string; status: string }> {
    const u = this.#uploads.get(uploadId);
    if (!u) throw new Error("Unknown upload.");
    this.#uploads.delete(uploadId);
    if (u.parts.length === 0) { await u.upload.abort(); throw new Error("The file was empty."); }
    await u.upload.complete(u.parts.sort((a, b) => a.partNumber - b.partNumber));
    const sha256 = await sha256Hex(u.sha);
    const result = await this.store.registerUpload({
      filename: u.filename, mime: u.mime, bytes: u.bytes, sha256, r2Key: u.r2Key, uploadedBy: "lawyer",
    });
    return { id: result.id, status: result.status };
  }

  async abortUpload(uploadId: string): Promise<void> {
    const u = this.#uploads.get(uploadId);
    if (!u) return;
    this.#uploads.delete(uploadId);
    await u.upload.abort().catch(() => {});
  }
}

@validateRpc()
export class LegalDeskImpl extends RpcTarget implements LegalDesk {
  constructor(private readonly account: DurableObjectStub<MatterAccount>, private readonly env: Cloudflare.Env) { super(); }

  #store(matterId: string): DurableObjectStub<MatterStore> {
    return this.env.MATTER_STORE.get(this.env.MATTER_STORE.idFromName(matterId));
  }

  async #entry(m: { id: string; title: string; caseType: string | null; clientName: string; createdAt: string }): Promise<MatterListEntry> {
    const store = this.#store(m.id);
    const [o, meta] = await Promise.all([store.overview(), store.meta()]);
    return {
      id: m.id, title: o.title, caseType: o.caseType, clientName: o.clientName, createdAt: m.createdAt,
      workspaceId: meta?.workspaceId ?? null, status: o.status,
      record: { documents: o.record.documents, reading: o.record.reading, failed: o.record.failed, facts: o.record.facts },
      needsYou: o.needsYou,
    };
  }

  async listMatters(): Promise<MatterListEntry[]> {
    const matters = await this.account.listMatters();
    return Promise.all(matters.map(m => this.#entry(m)));
  }

  async createMatter(input: { title: string; clientName: string; caseType: string | null }): Promise<MatterListEntry> {
    const created = await this.account.createMatter({
      title: input.title, clientName: input.clientName,
      caseType: input.caseType ? input.caseType.trim().toUpperCase().replace(/\s+/g, "-") : null,
    });
    return this.#entry(created);
  }

  async matterResourceUrl(matterId: string): Promise<string> {
    if (!(await this.account.hasMatter(matterId))) throw new Error("That matter is not on your desk.");
    return matterUrl(matterId);
  }

  async openMatter(matterId: string): Promise<MatterDesk> {
    if (!(await this.account.hasMatter(matterId))) throw new Error("That matter is not on your desk.");
    return new MatterDeskImpl(this.#store(matterId), this.env, matterId);
  }
}
