// The lawyer's side of the matter store: the LegalDesk RPC handed to the firm's screens through
// AuthenticatedApi.getLegalDesk(). No approval queue here on purpose: this is a human acting on
// their own desk, not an agent acting outward. Every write is attributed "lawyer".

import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type {
  CaseMap, CaseTypeSpec, ClientMessage, ClientRecord, Deadline, FirmBrief, GovernmentForm, LegalActivity, LegalDecision,
  LegalDesk, LegalDocument, LegalFact, MatterDesk, MatterListEntry, MatterOverviewView, Petition, PetitionSection, Readiness,
} from "@gadgets/workshop-shared/legal";
import { CASE_TYPES, normalizeCaseType } from "./case-types.js";
import type { MatterAccount } from "./matter.js";
import type { MatterStore } from "./store.js";
import { matterUrl } from "./matter.js";
import { signFileUrl } from "./portal.js";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const BRIEF_ACTIVE_ROWS = 6;

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
              private readonly matterId: string, private readonly onDeleted: () => Promise<void>) { super(); }

  async overview(): Promise<MatterOverviewView> { return this.store.overview(); }
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
    const ct = normalizeCaseType(caseType);
    if (ct) await this.store.setCaseType(ct, "lawyer");
  }
  setWorkspace(workspaceId: string): Promise<void> { return this.store.setWorkspace(workspaceId); }

  // ---- uploads ---------------------------------------------------------------------------------

  async beginUpload(filename: string, mime: string): Promise<{ uploadId: string }> {
    const name = safeName(filename);
    const id = crypto.randomUUID().replace(/-/g, "");
    const r2Key = `matters/${this.matterId}/docs/${id}/${name}`;
    const upload = await this.env.MATTER_FILES.createMultipartUpload(r2Key, { httpMetadata: { contentType: mime || "application/octet-stream" } });
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
    const result = await this.store.registerUpload({ filename: u.filename, mime: u.mime, bytes: u.bytes, sha256, r2Key: u.r2Key, uploadedBy: "lawyer" });
    return { id: result.id, status: result.status };
  }

  async abortUpload(uploadId: string): Promise<void> {
    const u = this.#uploads.get(uploadId);
    if (!u) return;
    this.#uploads.delete(uploadId);
    await u.upload.abort().catch(() => {});
  }

  async removeDocument(documentId: string): Promise<void> {
    const { factIds } = await this.store.removeDocument(documentId, "lawyer");
    if (factIds.length) await this.env.FACT_VECTORS.deleteByIds(factIds).catch(() => {});
  }
  dossier(documentId: string): ReturnType<MatterDesk["dossier"]> { return this.store.dossier(documentId); }
  setSupports(documentId: string, criteria: string[]): Promise<void> { return this.store.setSupports(documentId, criteria, "lawyer"); }
  fileUrl(documentId: string): Promise<string> { return signFileUrl(this.env, this.matterId, documentId); }

  // ---- the case map ----------------------------------------------------------------------------

  caseMap(): Promise<CaseMap> { return this.store.caseMap(); }
  renameEntity(entityId: string, name: string): Promise<void> { return this.store.renameEntity(entityId, name, "attorney"); }
  retagClaim(claimId: string, criteria: string[]): Promise<void> { return this.store.retagClaim(claimId, criteria, "attorney"); }
  setClaimRemoved(claimId: string, removed: boolean): Promise<void> { return this.store.setClaimRemoved(claimId, removed, "attorney"); }
  revertOverride(overrideId: string): Promise<void> { return this.store.revertOverride(overrideId); }
  rebuildKnowledge(): Promise<void> { return this.store.requestRebuild("lawyer"); }

  // ---- readiness, the petition -----------------------------------------------------------------

  async caseTypes(): Promise<CaseTypeSpec[]> { return CASE_TYPES; }
  readiness(): Promise<Readiness> { return this.store.readiness(); }
  petition(): Promise<Petition> { return this.store.petition(); }
  section(key: string): Promise<PetitionSection | null> { return this.store.section(key); }
  async redraftSection(key: string, instruction: string, options?: { remember?: boolean }): Promise<void> {
    if (!instruction.trim()) throw new Error("Tell the firm what to change.");
    if (options?.remember) await this.store.setGuidance(key, instruction.trim());
    await this.store.queueInstruction(key, instruction.trim(), Boolean(options?.remember), "lawyer");
  }
  async setDirective(directive: { targetPages: number | null; text: string } | null, options?: { rebalance?: boolean }): Promise<void> {
    await this.store.setDirective(directive, "lawyer");
    if (options?.rebalance && directive) {
      await this.store.queueInstruction(null, `Reshape the whole letter${directive.targetPages ? ` to about ${directive.targetPages} pages` : ""}: ${directive.text}`.trim(), false, "lawyer");
    }
  }
  async draftPetition(): Promise<void> {
    await this.store.queueInstruction(null, "Draft or re-draft every section the evidence clears; hold the rest and say what the client should send.", false, "lawyer");
  }
  exportLetter(): Promise<{ markdown: string; versionId: string }> { return this.store.exportLetter(); }
  simulateRfe(): ReturnType<MatterDesk["simulateRfe"]> { return this.store.simulateRfe(); }
  forms(): Promise<GovernmentForm[]> { return this.store.forms(); }
  prepareForm(code: string): Promise<void> { return this.store.prepareForm(code, "lawyer"); }
  acceptFormField(code: string, name: string, value: string): Promise<void> { return this.store.acceptFormField(code, name, value); }
  approveForm(code: string): Promise<void> { return this.store.approveForm(code); }

  // ---- the docket ------------------------------------------------------------------------------

  deadlines(): Promise<Deadline[]> { return this.store.deadlines(); }
  addDeadline(input: { title: string; dueOn: string; kind: Deadline["kind"] }): Promise<Deadline> { return this.store.addDeadline(input, "attorney"); }
  markDeadlineMet(id: string): Promise<void> { return this.store.markDeadlineMet(id, "lawyer"); }

  // ---- the client and the messages -------------------------------------------------------------

  client(): Promise<ClientRecord> { return this.store.client(); }
  setClient(input: { name?: string; email?: string | null; phone?: string | null }): Promise<ClientRecord> { return this.store.setClient(input); }
  invitePortal(): Promise<{ url: string }> { return this.store.invitePortal(); }
  messages(): Promise<ClientMessage[]> { return this.store.messages(); }
  sendMessage(body: string, subject?: string | null): Promise<ClientMessage> { return this.store.sendMessage(body, subject ?? null, "lawyer"); }
  releaseOutreach(itemId: string): Promise<void> { return this.store.releaseOutreach(itemId); }
  declineItem(itemId: string, reason: string): Promise<void> { return this.store.declineItem(itemId, reason); }

  async deleteMatter(confirmTitle: string): Promise<void> {
    const meta = await this.store.meta();
    if (!meta) throw new Error("This matter is no longer here.");
    if (confirmTitle !== meta.title) throw new Error("The title you typed does not match the matter. Nothing was deleted.");
    const { factIds } = await this.store.destroy();
    if (factIds.length) await this.env.FACT_VECTORS.deleteByIds(factIds).catch(() => {});
    await this.onDeleted();
  }
}

@validateRpc()
export class LegalDeskImpl extends RpcTarget implements LegalDesk {
  constructor(private readonly account: DurableObjectStub<MatterAccount>, private readonly env: Cloudflare.Env) { super(); }

  #store(matterId: string): DurableObjectStub<MatterStore> {
    return this.env.MATTER_STORE.get(this.env.MATTER_STORE.idFromName(matterId));
  }

  async #entry(m: { id: string; createdAt: string }): Promise<MatterListEntry> {
    const o = await this.#store(m.id).overview();
    return {
      id: m.id, title: o.title, caseType: o.caseType, clientName: o.clientName, createdAt: m.createdAt,
      workspaceId: o.workspaceId, status: o.status,
      record: { documents: o.record.documents, reading: o.record.reading, failed: o.record.failed, facts: o.record.facts },
      needsYou: o.needsYou,
      phase: o.statusLine.phase,
      nextDeadline: o.statusLine.nextDeadline,
    };
  }

  async listMatters(): Promise<MatterListEntry[]> {
    const matters = await this.account.listMatters();
    return Promise.all(matters.map(m => this.#entry(m)));
  }

  async createMatter(input: { title: string; clientName: string; caseType: string | null; clientEmail?: string | null }): Promise<MatterListEntry> {
    const created = await this.account.createMatter({ title: input.title, clientName: input.clientName, caseType: normalizeCaseType(input.caseType) });
    if (input.clientEmail?.trim()) await this.#store(created.id).setClient({ email: input.clientEmail });
    return this.#entry(created);
  }

  async matterResourceUrl(matterId: string): Promise<string> {
    if (!(await this.account.hasMatter(matterId))) throw new Error("That matter is not on your desk.");
    return matterUrl(matterId);
  }

  async openMatter(matterId: string): Promise<MatterDesk> {
    if (!(await this.account.hasMatter(matterId))) throw new Error("That matter is not on your desk.");
    return new MatterDeskImpl(this.#store(matterId), this.env, matterId, () => this.account.removeMatter(matterId));
  }

  async caseTypes(): Promise<CaseTypeSpec[]> { return CASE_TYPES; }

  /** The morning brief: one store call per matter. */
  async brief(): Promise<FirmBrief> {
    const matters = await this.account.listMatters();
    const slices = await Promise.all(matters.map(async m => ({ m, ...(await this.#store(m.id).briefSlice()) })));
    const today = slices[0]?.overview.today ?? new Date().toISOString().slice(0, 10);
    const active = slices.filter(s => s.overview.status === "paused" || s.overview.needsYouItems.length > 0 || s.updatesToday > 0 || s.overview.record.reading > 0);
    const rows = active.map(s => {
      const o = s.overview;
      const ask = o.needsYouItems[0]?.title ?? null;
      const signal = o.status === "paused" ? { kind: "paused" as const, count: 1 }
        : o.needsYouItems.length ? { kind: "needs_you" as const, count: o.needsYouItems.length }
        : o.record.reading ? { kind: "reading" as const, count: o.record.reading }
        : s.updatesToday ? { kind: "updates" as const, count: s.updatesToday } : null;
      return { matterId: o.id, title: o.title, caseType: o.caseType, ask, signal };
    });
    return {
      needsYou: slices.reduce((n, s) => n + s.overview.needsYouItems.length, 0),
      active: rows.slice(0, BRIEF_ACTIVE_ROWS),
      moreActive: Math.max(0, rows.length - BRIEF_ACTIVE_ROWS),
      resting: slices.length - active.length,
      docket: slices.flatMap(s => s.deadlines.map(d => ({ ...d, matterId: s.overview.id, matterTitle: s.overview.title })))
        .sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 12),
      today,
    };
  }
}
