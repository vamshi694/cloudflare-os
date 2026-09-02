// The lawyer's side of the matter store: the LegalDesk RPC handed to the firm's screens through
// AuthenticatedApi.getLegalDesk(). No approval queue here on purpose: this is a human acting on
// their own desk, not an agent acting outward. Every write is attributed "lawyer".

import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type {
  CaseMap, CaseTypeSpec, ClientMessage, ClientRecord, Deadline, Deliverable, Filing, FirmBrief, GovernmentForm, LegalActivity, LegalDecision,
  LegalDesk, LegalDocument, LegalFact, MatterDesk, MatterListEntry, MatterMethod, MatterOverviewView, Petition, PetitionSection, Readiness,
  RecommendationLetter, Recommender,
} from "@gadgets/workshop-shared/legal";
import type { FirmInbox, InboxItem, MatterDirective, MemoryNote, SearchResult } from "@gadgets/workshop-shared/legal";
import { orderInbox, rankSearch } from "./process.js";
// WP-5 types (case intelligence)
import type {
  BlastRadius, Chronology, Contradiction, CriteriaFindings, EntityPath, GapAudit, Grounding, IntelRun, OrganizeProposal, RecordInventory, ReviewState,
} from "@gadgets/workshop-shared/legal";
import { CASE_TYPES, caseTypeSpec, normalizeCaseType } from "./case-types.js";
import { firmGuidance, firmMethod } from "./firm-library.js";
import type { MatterAccount } from "./matter.js";
import type { MatterStore } from "./store.js";
import { matterUrl } from "./matter.js";
import { signFileUrl, signFormUrl } from "./portal.js";
import { discoverFields, fetchTemplate, fillPdf, mapFieldNames } from "./forms-pdf.js";

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

  // ---- WP-8: standing directives and memory notes ----------------------------------------------
  directives(): Promise<MatterDirective[]> { return this.store.listDirectives(); }
  addDirective(text: string, scope?: MatterDirective["scope"]): Promise<MatterDirective> { return this.store.addDirective(text, scope, "lawyer"); }
  removeDirective(id: string): Promise<void> { return this.store.removeDirective(id, "lawyer"); }
  memoryNotes(): Promise<MemoryNote[]> { return this.store.listMemoryNotes(); }
  addMemoryNote(text: string): Promise<MemoryNote> { return this.store.addMemoryNote(text, "lawyer"); }
  removeMemoryNote(id: string): Promise<void> { return this.store.removeMemoryNote(id); }

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

  /** The playbook documents and standing rules that govern this matter, from the firm library binding. */
  async method(): Promise<MatterMethod> {
    const meta = await this.store.meta();
    const caseType = meta?.caseType ?? null;
    const spec = caseTypeSpec(caseType);
    const [method, guidance] = await Promise.all([firmMethod(this.env, caseType), firmGuidance(this.env, spec)]);
    return {
      caseType,
      documents: method?.documents ?? [],
      rules: method?.rules ?? [],
      guidance: [...guidance.values()],
      available: method !== null,
    };
  }
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
  /** Start the drafting lane from the workbench: one job per cleared section, the rest held with the client ask. */
  async draftPetition(): Promise<void> {
    await this.store.draftAll("lawyer");
  }
  exportLetter(): Promise<{ markdown: string; versionId: string }> { return this.store.exportLetter(); }
  simulateRfe(): ReturnType<MatterDesk["simulateRfe"]> { return this.store.simulateRfe(); }
  // ---- government forms (WP-7): the PDF work runs here, on the desk, not inside the store ------

  forms(): Promise<GovernmentForm[]> { return this.store.forms(); }
  prepareForm(code: string): Promise<void> { return this.store.prepareForm(code, "lawyer"); }
  acceptFormField(code: string, name: string, value: string): Promise<void> { return this.store.acceptFormField(code, name, value); }
  editFormField(code: string, name: string, value: string): Promise<void> {
    if (!value.trim()) throw new Error("A corrected value cannot be blank. Reject the value instead.");
    return this.store.editFormField(code, name, value.trim());
  }
  askAboutFormField(code: string, name: string, question: string): Promise<void> { return this.store.askAboutFormField(code, name, question); }
  rejectFormField(code: string, name: string, reason: string): Promise<void> { return this.store.rejectFormField(code, name, reason); }
  approveForm(code: string): Promise<void> { return this.store.approveForm(code); }

  async fetchFormTemplate(code: string): Promise<GovernmentForm> {
    await fetchTemplateOnto(this.env, this.store, code);
    const form = (await this.store.forms()).find(f => f.code === code);
    if (!form) throw new Error(`Form ${code} is not part of this filing.`);
    return form;
  }

  async formPreviewUrl(code: string): Promise<{ url: string; renderedAt: string }> {
    const renderedAt = await renderForm(this.env, this.store, this.matterId, code, { flatten: false });
    return { url: await signFormUrl(this.env, this.matterId, code), renderedAt };
  }

  async requestFormSignature(code: string): Promise<void> {
    // The client signs the form as it will be filed: a flattened render, kept as the signed copy.
    await renderForm(this.env, this.store, this.matterId, code, { flatten: true });
    const render = await this.store.formRender(code);
    if (!render) throw new Error("The form could not be rendered, so there is nothing for the client to sign.");
    await this.store.requestFormSignature(code, render.r2Key);
  }

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

  // Case intelligence (WP-5).
  chronology(): Promise<Chronology> { return this.store.chronology(); }
  contradictions(): Promise<Contradiction[]> { return this.store.contradictions(); }
  resolveContradiction(id: string, outcome: "resolved" | "dismissed", note: string): Promise<void> {
    return this.store.resolveContradiction(id, outcome, note, "lawyer");
  }
  blastRadius(documentId: string): Promise<BlastRadius> { return this.store.blastRadius(documentId); }
  entityPath(fromEntityId: string, toEntityId: string): Promise<EntityPath> { return this.store.entityPath(fromEntityId, toEntityId); }
  review(kind: "duplicate" | "conflict"): Promise<ReviewState> { return this.store.review(kind); }
  decideReview(pairId: string, verdict: "merge" | "set_aside" | "keep"): Promise<void> { return this.store.decideReview(pairId, verdict, "attorney"); }
  criteriaFindings(): Promise<CriteriaFindings> { return this.store.criteriaFindings(); }
  gapAudit(): Promise<GapAudit> { return this.store.gapAudit(); }
  grounding(): Promise<Grounding> { return this.store.grounding(); }
  inventory(): Promise<RecordInventory> { return this.store.inventory(); }
  organizeProposal(): Promise<OrganizeProposal | null> { return this.store.organizeProposal(); }
  applyOrganization(): Promise<void> { return this.store.applyOrganization("lawyer"); }
  runIntel(kind: IntelRun): Promise<void> { return this.store.runIntel(kind, "lawyer"); }
  async intelRunning(): Promise<Record<IntelRun, boolean>> { return { ...(await this.store.intelRunning()) }; }

  // ---- the filing (WP-6) -----------------------------------------------------------------------

  buildPacket(): Promise<Filing> { return this.store.buildPacket("lawyer"); }
  filings(): Promise<Filing[]> { return this.store.filings(); }
  exportWord(): Promise<{ url: string; versionId: string }> { return this.store.exportWord(); }
  deliverables(): Promise<Deliverable[]> { return this.store.deliverables(); }
  deliverableWord(path: string): Promise<{ url: string }> { return this.store.deliverableWord(path); }
  recommenders(): Promise<Recommender[]> { return this.store.recommenders(); }
  suggestRecommenders(): Promise<Recommender[]> { return this.store.suggestRecommenders(); }
  addRecommender(input: { name: string; title?: string | null; organization?: string | null; relationship?: string | null; basis?: string | null }): Promise<Recommender> {
    return this.store.addRecommender(input, "lawyer");
  }
  updateRecommender(id: string, patch: { name?: string; title?: string | null; organization?: string | null; relationship?: string | null; basis?: string | null; status?: Recommender["status"] }): Promise<Recommender> {
    return this.store.updateRecommender(id, patch);
  }
  removeRecommender(id: string): Promise<void> { return this.store.removeRecommender(id, "lawyer"); }
  reconcileRecommenders(names: string[]): Promise<{ confirmed: number; added: number; declined: number }> { return this.store.reconcileRecommenders(names, "lawyer"); }
  letters(): Promise<RecommendationLetter[]> { return this.store.letters(); }
  generateLetters(recommenderIds?: string[]): Promise<{ written: RecommendationLetter[]; failed: { recommenderId: string; reason: string }[] }> {
    return this.store.generateLetters(recommenderIds);
  }
  approveLetter(id: string): Promise<void> { return this.store.approveLetter(id); }

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
  constructor(private readonly account: DurableObjectStub<MatterAccount>, private readonly env: Cloudflare.Env,
              private readonly ownerUserId: string | null = null) { super(); }

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
    const created = await this.account.createMatter(
      { title: input.title, clientName: input.clientName, caseType: normalizeCaseType(input.caseType) }, this.ownerUserId);
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

  // ---- WP-8: the firm inbox and search across the desk ---------------------------------------

  /**
   * Every item waiting on the lawyer across their matters. A matter whose queue could not be read
   * is named in `unreachable`, so an empty list never claims "nothing needs you" after a failure.
   */
  async inbox(): Promise<FirmInbox> {
    const matters = await this.account.listMatters();
    const items: InboxItem[] = [];
    const unreachable: FirmInbox["unreachable"] = [];
    await Promise.all(matters.map(async m => {
      try {
        const o = await this.#store(m.id).overview();
        for (const it of o.needsYouItems) items.push({ ...it, matterId: m.id, matterTitle: o.title, caseType: o.caseType });
      } catch {
        unreachable.push({ matterId: m.id, matterTitle: m.title });
      }
    }));
    return { items: orderInbox(items), unreachable, readAt: new Date().toISOString() };
  }

  /** Facts and documents across the lawyer's matters that mention the query, best first. */
  async search(query: string, options?: { limit?: number }): Promise<SearchResult[]> {
    const q = query.trim();
    if (q.length < 3) return [];
    const limit = Math.min(Math.max(1, options?.limit ?? 40), 200);
    const matters = await this.account.listMatters();
    const hits: SearchResult[] = [];
    await Promise.all(matters.map(async m => {
      try {
        const r = await this.#store(m.id).searchRecord(q, limit);
        for (const f of r.facts) {
          hits.push({ kind: "fact", matterId: m.id, matterTitle: m.title, title: f.statement, snippet: f.quote, documentId: f.documentId, page: f.page, score: 0 });
        }
        for (const d of r.documents) {
          hits.push({ kind: "document", matterId: m.id, matterTitle: m.title, title: d.displayTitle ?? d.filename,
            snippet: `${d.docType ? d.docType.replace(/_/g, " ") : "document"} · ${d.status}`, documentId: d.id, page: null, score: 0 });
        }
      } catch {
        // A matter that cannot be searched contributes nothing; the desk's inbox names unreachable matters.
      }
    }));
    return rankSearch(hits, q, limit);
  }

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

// ---- government forms: template and render helpers (WP-7) -------------------------------------

/** Put the official PDF on file under templates/<code>.pdf and record its fields and mapping. */
export async function fetchTemplateOnto(env: Cloudflare.Env, store: DurableObjectStub<MatterStore>, code: string): Promise<void> {
  const got = await fetchTemplate(code);
  if ("error" in got) {
    await store.setFormTemplate(code, { state: "failed", note: got.error, r2Key: null, fields: [], mapping: {}, unmapped: [] });
    return;
  }
  let discovered;
  try {
    discovered = await discoverFields(got.bytes);
  } catch (err) {
    await store.setFormTemplate(code, { state: "failed", note: err instanceof Error ? err.message : String(err), r2Key: null, fields: [], mapping: {}, unmapped: [] });
    return;
  }
  const r2Key = `templates/${code}.pdf`;
  await env.MATTER_FILES.put(r2Key, got.bytes, { httpMetadata: { contentType: "application/pdf" } });
  const ours = (await store.forms()).find(f => f.code === code)?.fields.map(f => f.name) ?? [];
  const { mapped, unmapped } = mapFieldNames(code, ours, discovered);
  await store.setFormTemplate(code, { state: "ready", note: null, r2Key, fields: discovered, mapping: mapped, unmapped });
}

/** Render the filled form into the matter's R2 space. Reuses a current render when nothing changed. */
async function renderForm(env: Cloudflare.Env, store: DurableObjectStub<MatterStore>, matterId: string, code: string,
                          options: { flatten: boolean }): Promise<string> {
  const existing = await store.formRender(code);
  if (existing && existing.flattened === options.flatten) return existing.renderedAt;
  let template = await store.formTemplate(code);
  if (template.state !== "ready" || !template.r2Key) {
    await fetchTemplateOnto(env, store, code);
    template = await store.formTemplate(code);
    if (template.state !== "ready" || !template.r2Key) throw new Error(template.note ?? `The official ${code} is not on file.`);
  }
  const obj = await env.MATTER_FILES.get(template.r2Key);
  if (!obj) throw new Error(`The official ${code} is missing from the firm's store. Fetch it again.`);
  const values = await store.renderableFormValues(code);
  const bytes = await fillPdf(await obj.arrayBuffer(), values, options);
  const r2Key = `matters/${matterId}/forms/${code}${options.flatten ? "-final" : ""}.pdf`;
  await env.MATTER_FILES.put(r2Key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  return store.setFormRender(code, r2Key, options.flatten);
}
