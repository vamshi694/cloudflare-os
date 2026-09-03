// The Matters gatekeeper: Vendor -> per-user Account -> per-matter Gatekeeper facet -> Session.
//
// Auto-provisioned (no OAuth): the account is the lawyer's own matter index. A matter becomes an
// agent capability only when the lawyer introduces it to a workspace as the resource
// `legal://matter/<id>`. Observer strategy B: a collaborator may observe a matter only if their own
// account can access it, checked on every open.

import {
  DurableObject, RpcStub, RpcTarget, WorkerEntrypoint,
} from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  AccountDescription, ApprovalQueue, Gatekeeper, GatekeeperConnectCallback, GatekeeperConnectOptions,
  GatekeeperUser, GatekeeperUserVerifier, HookController, HookInitiator, HookTargetMetadata,
  ObservationDescription, ResourceConfiguratorFrame, ResourceDescription, SupportedResource,
  VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import type { MatterWatcher } from "./types.js";
import type {
  ActivityEntry, CaseClaim, CaseEntity, Deadline, Decision, DeskFile, DocumentSummary, DocumentText, Fact, FactFilter,
  MatterClient, MatterDecisions, MatterDesk, MatterDocket, MatterEvidence, MatterFiles, MatterForms, MatterKnowledge,
  MatterOverview, MatterPetition, MatterSession, PetitionSectionState, Readiness, SearchHit, TextHit,
  MatterDirective, MatterDirectives, MatterMemory, MemoryNote,
} from "./types.js";
import { CASE_TYPES } from "./case-types.js";
import TYPES_CODE from "./types.txt";
import { MatterStore, type MatterMeta } from "./store.js";
import { normalizePath, parseMatterUrl } from "./pure.js";
import { MatterConfiguratorUI } from "./configurator.js";
import { LegalDeskImpl, fetchTemplateOnto } from "./desk.js";
import type { LegalDesk } from "@gadgets/workshop-shared/legal";
import MATTER_CONFIGURATOR_HTML from "./generated/matter-configurator-ui.txt";
import type { FirmMattersSession } from "./types.js";
import type { FirmAdminApi } from "./firm-index.js";
import type { LetterState, MatterIntelligence, MatterRecommenders, RecommenderState } from "./types.js";
import { IntelligenceImpl } from "./intel-session.js";
import type { DocketItemView, KeyDates, MatterRfe, RfeAsk, RfeResponse } from "./types.js";
import { unverifiedQuotes } from "./rfe.js";
import { SPECIALIST_ROLES, composeBrief, specialistRunning } from "./specialists.js";
import type { MatterSpecialists, SpecialistRole, SpecialistScope } from "./types.js";
import type { RecommendationLetter, Recommender } from "@gadgets/workshop-shared/legal";

export const MATTER_ICON = {
  url: "data:image/svg+xml," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='none' stroke='currentColor' stroke-width='18'>" +
    "<path d='M48 40h104l56 56v120H48z'/><path d='M152 40v56h56'/><path d='M80 136h96M80 168h96'/></svg>"),
};

export const MATTER_RESOURCE: SupportedResource = {
  urlPattern: "legal://matter/:matterId",
  title: "Matter",
  description: "One client's case file: its documents, the facts read from them, the desk and the questions waiting on the attorney.",
  icon: MATTER_ICON,
  grantable: true,
};

const EMBED_MODEL = "@cf/baai/bge-m3";

type AccountProps = { accountObjectId: string };
type MatterProps = { accountObjectId: string; matterId: string };

export function matterUrl(id: string): string { return `legal://matter/${id}`; }

// ---- Vendor -----------------------------------------------------------------------------------

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Cloudflare.Env> {
  async describe(): Promise<VendorDescription> {
    return {
      displayName: "Matters",
      url: "https://github.com/vamshi694/legal_agent",
      logo: MATTER_ICON,
      color: "#eef3ff",
      tagline: "The firm's case files",
      description: "Each matter is one client's case file: documents, the facts read from them with their sources, the working desk, and the questions waiting on the attorney.",
      autoProvisionsAccount: true,
      providesAuth: false,
    };
  }

  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    const id = this.ctx.exports.MatterAccount.newUniqueId();
    return this.ctx.exports.MatterUser({ props: { accountObjectId: id.toString() } });
  }

  connectAccount(_callback: Fetcher<GatekeeperConnectCallback>, _options?: GatekeeperConnectOptions): Promise<{ url: string }> {
    throw new Error("Matters are auto-provisioned; there is no connect flow.");
  }

  async getSupportedResources(): Promise<SupportedResource[]> { return [MATTER_RESOURCE]; }
  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }

  /** Legal OS: the firm-wide admin view (every matter, analytics), for the workshop's admin API. */
  @skipRpcValidation()
  async getFirmAdminApi(): Promise<Fetcher<FirmAdminApi>> {
    return this.ctx.exports.FirmAdminApi({});
  }
}

// ---- Account: the lawyer's matter index -----------------------------------------------------

export type MatterIndexEntry = { id: string; title: string; caseType: string | null; clientName: string; createdAt: string };

export class MatterAccount extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS matters (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, case_type TEXT, client_name TEXT NOT NULL, created_at TEXT NOT NULL)`);
    });
  }

  #store(matterId: string): DurableObjectStub<MatterStore> {
    return this.env.MATTER_STORE.get(this.env.MATTER_STORE.idFromName(matterId));
  }

  async createMatter(input: { title: string; caseType: string | null; clientName: string }, ownerUserId?: string | null): Promise<MatterIndexEntry> {
    const title = input.title.trim();
    const clientName = input.clientName.trim();
    if (!title) throw new Error("A matter needs a title.");
    if (!clientName) throw new Error("A matter needs the client's name.");
    const id = crypto.randomUUID().replace(/-/g, "");
    const createdAt = new Date().toISOString();
    await this.#store(id).init({ id, title, caseType: input.caseType, clientName, ownerAccountId: this.ctx.id.toString() });
    this.ctx.storage.sql.exec("INSERT INTO matters(id, title, case_type, client_name, created_at) VALUES(?, ?, ?, ?, ?)",
      id, title, input.caseType, clientName, createdAt);
    // The firm's registry, for the admins' Matters view. Best effort: a registry hiccup must never
    // cost the lawyer their new matter.
    await this.ctx.exports.FirmIndex.getByName("")
      .upsert({ matterId: id, ownerAccountId: this.ctx.id.toString(), ownerUserId: ownerUserId ?? null, title, clientName, createdAt })
      .catch(() => {});
    return { id, title, caseType: input.caseType, clientName, createdAt };
  }

  async listMatters(): Promise<MatterIndexEntry[]> {
    return this.ctx.storage.sql.exec(
      "SELECT id, title, case_type AS caseType, client_name AS clientName, created_at AS createdAt FROM matters ORDER BY created_at DESC")
      .toArray() as MatterIndexEntry[];
  }

  async hasMatter(matterId: string): Promise<boolean> {
    return this.ctx.storage.sql.exec("SELECT 1 FROM matters WHERE id = ?", matterId).toArray().length > 0;
  }

  async removeMatter(matterId: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM matters WHERE id = ?", matterId);
    await this.ctx.exports.FirmIndex.getByName("").remove(matterId).catch(() => {});
  }

  // WP-8: reassignment moves a matter between two lawyers' indexes; the registry row is the
  // admin's, so these two touch only this account's list.
  async adoptMatter(entry: MatterIndexEntry): Promise<void> {
    this.ctx.storage.sql.exec(
      "INSERT INTO matters(id, title, case_type, client_name, created_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      entry.id, entry.title, entry.caseType, entry.clientName, entry.createdAt);
  }

  async forgetMatter(matterId: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM matters WHERE id = ?", matterId);
  }

  /**
   * Tell the firm's registry whose matters these are; called whenever the lawyer's desk opens.
   * Also backfills matters opened before the registry existed, so an admin's Matters view is
   * complete after each lawyer's first visit rather than only for new matters.
   */
  async claimOwner(ownerUserId: string): Promise<void> {
    const index = this.ctx.exports.FirmIndex.getByName("");
    const ownerAccountId = this.ctx.id.toString();
    for (const m of await this.listMatters()) {
      await index.upsert({ matterId: m.id, ownerAccountId, ownerUserId, title: m.title, clientName: m.clientName, createdAt: m.createdAt })
        .catch(() => {});
    }
    await index.claimOwner(ownerAccountId, ownerUserId).catch(() => {});
  }
}

// ---- User entrypoint --------------------------------------------------------------------------

@validateRpc()
export class MatterUser extends WorkerEntrypoint<Cloudflare.Env, AccountProps> implements GatekeeperUser {
  #account(): DurableObjectStub<MatterAccount> {
    const ns = this.ctx.exports.MatterAccount;
    return ns.get(ns.idFromString(this.ctx.props.accountObjectId));
  }

  async describe(): Promise<AccountDescription> {
    // Legal OS: the account also carries the firm-wide MATTERS singleton, folded into every
    // workspace as an ambient capsule (see firm-matters.ts).
    return { displayName: "Matters", avatar: MATTER_ICON, singleton: { tsType: "FirmMattersSession" } };
  }

  async getSingletonGatekeeperClass(): Promise<DurableObjectClass<Gatekeeper<FirmMattersSession>>> {
    return this.ctx.exports.FirmMattersGatekeeper({ props: { accountObjectId: this.ctx.props.accountObjectId } });
  }

  async getSupportedResources(): Promise<SupportedResource[]> { return [MATTER_RESOURCE]; }

  async getGatekeeperClassFor(url: string): Promise<{ class: DurableObjectClass<Gatekeeper<MatterSession>>; resource: SupportedResource }> {
    const matterId = parseMatterUrl(url);
    if (!(await this.#account().hasMatter(matterId))) throw new Error("That matter is not on your desk.");
    return {
      class: this.ctx.exports.MatterGatekeeper({ props: { accountObjectId: this.ctx.props.accountObjectId, matterId } }),
      resource: MATTER_RESOURCE,
    };
  }

  async startResourceConfigurator(resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    if (resourceUrlPattern !== MATTER_RESOURCE.urlPattern) throw new Error(`Unknown resource type: ${resourceUrlPattern}`);
    return { iframeHtml: MATTER_CONFIGURATOR_HTML, ui: new RpcStub(new MatterConfiguratorUI(this.#account())) };
  }

  /**
   * Legal OS: the lawyer's own desk over their matters (see AuthenticatedApi.getLegalDesk). The
   * workshop passes the lawyer's username so the firm's registry can say whose matters these are.
   */
  async startLegalDesk(options?: { userId?: string }): Promise<LegalDesk> {
    const userId = options?.userId?.trim() || null;
    if (userId) await this.#account().claimOwner(userId);
    return new LegalDeskImpl(this.#account(), this.env, userId);
  }

  async ensureResources(_patterns: string[]): Promise<{ url?: string }> { return {}; }
  async revoke(): Promise<void> {}
  reconnect(): Promise<{ url: string }> { throw new Error("Matters have no credentials to reconnect."); }
  async getAuthenticatedEmail(): Promise<string | null> { return null; }

  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.MatterVerifier({ props: this.ctx.props });
  }
}

export interface MatterVerifierApi extends GatekeeperUserVerifier {
  canAccessMatter(matterId: string): Promise<boolean>;
}

@validateRpc()
export class MatterVerifier extends WorkerEntrypoint<Cloudflare.Env, AccountProps> implements MatterVerifierApi {
  async canAccessMatter(matterId: string): Promise<boolean> {
    const ns = this.ctx.exports.MatterAccount;
    return await ns.get(ns.idFromString(this.ctx.props.accountObjectId)).hasMatter(matterId);
  }
}

// ---- Gatekeeper facet (one per matter binding) ----------------------------------------------

@validateRpc()
export class MatterGatekeeper extends DurableObject<Cloudflare.Env, MatterProps> implements Gatekeeper<MatterSession> {
  #store(): DurableObjectStub<MatterStore> {
    return this.env.MATTER_STORE.get(this.env.MATTER_STORE.idFromName(this.ctx.props.matterId));
  }

  async describe(): Promise<ResourceDescription> {
    const meta = await this.#store().meta();
    return {
      url: matterUrl(this.ctx.props.matterId),
      title: meta ? `${meta.title} (${meta.clientName})` : "Matter",
      snippet: meta ? `${meta.caseType ?? "Untyped"} matter for ${meta.clientName}.` : "A matter.",
      suggestedBindingName: "MATTER",
      tsType: "MatterSession",
    };
  }

  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }
  async getAutoApprovableActions(): Promise<[]> { return []; }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<MatterSession> {
    const queue = approvalQueue.dup();
    const matterId = this.ctx.props.matterId;
    return new MatterSessionImpl(queue, this.#store(), this.env, matterId, async callback => {
      await queue.bindHook(
        // @ts-expect-error Workers widens the controller's hook type across the bindHook RPC.
        this.ctx.exports.MatterWatchController({ props: { matterId } }),
        callback,
        { title: "Wake the counsel when the matter changes",
          description: "The record settled, the attorney decided or asked for a redraft, or the client sent something." },
      );
    });
  }

  async addObserver(_id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    const verifier = user as unknown as MatterVerifierApi;
    if (!(await verifier.canAccessMatter(this.ctx.props.matterId))) {
      throw new Error("This collaborator does not have this matter on their desk.");
    }
  }
  async removeObserver(_id: string): Promise<void> {}
  async applyAction(action: number): Promise<void> { throw new Error(`Matters have no actions yet (${action}).`); }
  async rejectAction(_action: number): Promise<void> {}
  async revertAction(_action: number): Promise<void> { throw new Error("Matters have no actions to revert."); }
}

// ---- Session ----------------------------------------------------------------------------------

type ObservationQueue = Pick<ApprovalQueue, "authorizeObservation"> & Partial<{ [Symbol.dispose](): void }>;

/** The watcher as the hook machinery sees it: the agent's `self` stub, an RpcTarget on the wire. */
export type MatterWatcherTarget = RpcTarget & MatterWatcher;

/** Binds a watch hook on the session's own approval queue; the gatekeeper DO supplies it. */
type WatchBinder = (callback: RpcStub<MatterWatcherTarget>) => Promise<void>;

/**
 * The hook controller for a matter watch. Stateless: `enable` hands the overseer's initiator to the
 * matter store, which keeps it and calls `startHook()` whenever the record moves (see store.ts
 * #wake); `disable` drops it.
 */
@validateRpc()
export class MatterWatchController extends WorkerEntrypoint<Cloudflare.Env, { matterId: string }>
    implements HookController<MatterWatcherTarget> {
  #store(): DurableObjectStub<MatterStore> {
    return this.env.MATTER_STORE.get(this.env.MATTER_STORE.idFromName(this.ctx.props.matterId));
  }

  @skipRpcValidation()
  async enable(initiator: Fetcher<HookInitiator<MatterWatcherTarget>>, target: HookTargetMetadata): Promise<void> {
    await this.#store().setWatcher(initiator, target.workspaceId);
  }

  async disable(): Promise<void> {
    await this.#store().clearWatcher();
  }
}

async function observe(queue: ObservationQueue, title: string, description: string): Promise<void> {
  await queue.authorizeObservation({ title, description } satisfies ObservationDescription);
}

@validateRpc()
class FilesImpl extends RpcTarget implements MatterFiles {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>,
              private readonly env: Cloudflare.Env, private readonly matterId: string) { super(); }

  async list(options?: { includeSuperseded?: boolean }): Promise<DocumentSummary[]> {
    const docs = await this.store.listDocuments(options?.includeSuperseded ?? false);
    await observe(this.q, "List the record", `Listed ${docs.length} documents on the matter.`);
    return docs;
  }

  async read(reference: string): Promise<DocumentText> {
    const doc = await this.store.documentText(reference);
    await observe(this.q, "Read a document", `Read the full text of "${doc.displayTitle ?? reference}".`);
    return doc;
  }

  async find(reference: string, query: string, options?: { maxResults?: number }): Promise<TextHit[]> {
    const hits = await this.store.findInDocument(reference, query, options?.maxResults ?? 8);
    await observe(this.q, "Search inside a document", `Searched "${reference}" for "${query}": ${hits.length} hits.`);
    return hits;
  }

  async upload(filename: string, mime: string, bytes: Uint8Array): Promise<{ id: string }> {
    const name = filename.replace(/[\r\n\\/]/g, "_").slice(0, 200) || "document";
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
    const id = crypto.randomUUID().replace(/-/g, "");
    const r2Key = `matters/${this.matterId}/docs/${id}/${name}`;
    await this.env.MATTER_FILES.put(r2Key, bytes, { httpMetadata: { contentType: mime || "application/octet-stream" } });
    const result = await this.store.registerUpload({ filename: name, mime: mime || "application/octet-stream", bytes: bytes.byteLength, sha256: sha, r2Key, uploadedBy: "agent" });
    await observe(this.q, "Put a document on the record", `Uploaded "${name}" (${bytes.byteLength} bytes); status ${result.status}.`);
    return { id: result.id };
  }

  async setRelevance(reference: string, relevance: "included" | "excluded" | "check", reason: string): Promise<void> {
    await this.store.setRelevance(reference, relevance, reason, "agent");
    await observe(this.q, "Change a document's relevance", `Marked "${reference}" ${relevance}: ${reason}`);
  }

  async reread(reference: string): Promise<void> {
    await this.store.requeue(reference, "agent");
    await observe(this.q, "Re-read a document", `Queued "${reference}" for a fresh read.`);
  }
}

@validateRpc()
class EvidenceImpl extends RpcTarget implements MatterEvidence {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>,
              private readonly env: Cloudflare.Env, private readonly matterId: string) { super(); }

  async facts(filter?: FactFilter): Promise<Fact[]> {
    const facts = await this.store.facts(filter ?? {});
    await observe(this.q, "Read the facts", `Read ${facts.length} facts from the record.`);
    return facts;
  }

  async search(query: string, options?: { limit?: number; documentId?: string }): Promise<SearchHit[]> {
    const limit = Math.min(options?.limit ?? 20, 100);
    const [exact, semantic] = await Promise.all([
      this.store.searchExact(query, limit, options?.documentId),
      this.#semantic(query, limit, options?.documentId),
    ]);
    const scores = new Map<string, { exact?: number; semantic?: number }>();
    exact.forEach((h, i) => scores.set(h.id, { ...scores.get(h.id), exact: 1 - i / Math.max(1, exact.length) }));
    semantic.forEach(h => scores.set(h.id, { ...scores.get(h.id), semantic: h.score }));
    const ranked = [...scores.entries()]
      .map(([id, s]) => ({ id, score: (s.exact ?? 0) * 0.5 + (s.semantic ?? 0) * 0.5, via: s.exact !== undefined && s.semantic !== undefined ? "both" as const : s.exact !== undefined ? "exact" as const : "semantic" as const }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const facts = await this.store.factsByIds(ranked.map(r => r.id));
    const byId = new Map(facts.map(f => [f.id, f]));
    const hits = ranked.flatMap(r => byId.has(r.id) ? [{ fact: byId.get(r.id)!, via: r.via, score: r.score }] : []);
    await observe(this.q, "Search the evidence", `Searched the record for "${query}": ${hits.length} facts.`);
    return hits;
  }

  async #semantic(query: string, limit: number, documentId?: string): Promise<{ id: string; score: number }[]> {
    try {
      const emb = await this.env.AI.run(EMBED_MODEL, { text: [query] }) as { data: number[][] };
      const res = await this.env.FACT_VECTORS.query(emb.data[0], {
        topK: limit, namespace: this.matterId, returnMetadata: "none",
        ...(documentId ? { filter: { documentId } } : {}),
      });
      return res.matches.map(m => ({ id: m.id, score: m.score }));
    } catch {
      return []; // exact search still answers; semantic is best-effort
    }
  }

  async verify(factId: string): Promise<void> {
    await this.store.verifyFact(factId, "attorney");
    await observe(this.q, "Confirm a fact", `Marked fact ${factId} as confirmed by the attorney.`);
  }
}

@validateRpc()
class DeskImpl extends RpcTarget implements MatterDesk {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async list(): Promise<DeskFile[]> {
    const files = await this.store.deskList();
    await observe(this.q, "List the desk", `Listed ${files.length} desk files.`);
    return files;
  }
  async read(path: string): Promise<{ content: string; rev: number } | null> {
    const file = await this.store.deskRead(normalizePath(path));
    await observe(this.q, "Read a desk file", `Read "${path}".`);
    return file;
  }
  async write(path: string, content: string, options?: { baseRev?: number }): Promise<{ rev: number }> {
    const result = await this.store.deskWrite(normalizePath(path), content, "agent", options?.baseRev);
    await observe(this.q, "Write a desk file", `Wrote "${path}" (revision ${result.rev}).`);
    return result;
  }
  async remove(path: string): Promise<void> {
    await this.store.deskDelete(normalizePath(path));
    await observe(this.q, "Delete a desk file", `Deleted "${path}".`);
  }
}

@validateRpc()
class DecisionsImpl extends RpcTarget implements MatterDecisions {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async raise(question: string, options: string[]): Promise<{ id: string }> {
    if (!question.trim()) throw new Error("A decision needs a question.");
    const r = await this.store.raiseDecision(question.trim(), options.map(o => o.trim()).filter(Boolean));
    await observe(this.q, "Ask the attorney", `Raised a decision: ${question}`);
    return r;
  }
  async list(): Promise<Decision[]> {
    const d = await this.store.listDecisions();
    await observe(this.q, "Read the decisions", `Read ${d.length} decisions.`);
    return d;
  }
}


@validateRpc()
class KnowledgeImpl extends RpcTarget implements MatterKnowledge {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async map(): Promise<{ entities: CaseEntity[]; claims: CaseClaim[]; builtAt: string | null; building: boolean }> {
    const m = await this.store.caseMap();
    await observe(this.q, "Read the case knowledge", `${m.entities.length} entities, ${m.claims.filter(c => !c.removed).length} claims.`);
    return { entities: m.entities, claims: m.claims, builtAt: m.builtAt, building: m.building };
  }
  async addClaim(input: { statement: string; criteria: string[]; entities: { name: string; kind: CaseEntity["kind"] }[]; factIds: string[] }): Promise<{ id: string }> {
    const r = await this.store.addClaim(input, "firm");
    await observe(this.q, "Add a claim to the case knowledge", input.statement.slice(0, 160));
    return r ?? { id: "" };
  }
  async retagClaim(claimId: string, criteria: string[]): Promise<void> {
    await this.store.retagClaim(claimId, criteria, "firm");
    await observe(this.q, "Refile a claim", `Claim ${claimId} now argues in ${criteria.join(", ") || "no section"}.`);
  }
  async mergeEntities(keepId: string, mergeId: string, reason: string): Promise<void> {
    await this.store.mergeEntities(keepId, mergeId, reason, "firm");
    await observe(this.q, "Tidy the case map", `Merged ${mergeId} into ${keepId}: ${reason}`);
  }
  async describeEntity(entityId: string, description: string): Promise<void> {
    await this.store.describeEntity(entityId, description);
    await observe(this.q, "Describe an entity", description.slice(0, 160));
  }
  async readiness(): Promise<Readiness> {
    const r = await this.store.readiness();
    await observe(this.q, "Check readiness", `${r.sufficient} of ${r.required} required sections sufficient; gate: ${r.gate}.`);
    return r;
  }
  async rebuild(): Promise<void> {
    await this.store.requestRebuild("agent");
    await observe(this.q, "Rebuild the case knowledge", "Queued a rebuild from every fact on the record.");
  }
  // WP-9: where the fanned-out build stands, so the counsel reads progress instead of rebuilding.
  async buildStatus(): Promise<{ building: boolean; done: number; total: number; builtAt: string | null; note: string | null }> {
    return this.store.knowledgeStatus();
  }
  async caseTypes(): Promise<Awaited<ReturnType<MatterKnowledge["caseTypes"]>>> {
    await observe(this.q, "Read the case type catalog", `${CASE_TYPES.length} case types.`);
    return CASE_TYPES.map(c => ({ key: c.key, title: c.title, required: c.required, sections: c.sections }));
  }
}

@validateRpc()
class PetitionImpl extends RpcTarget implements MatterPetition {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async sections(): Promise<PetitionSectionState[]> {
    const p = await this.store.petition();
    await observe(this.q, "Read the petition", `${p.sections.filter(s => s.status === "drafted").length} of ${p.sections.length} sections drafted.`);
    return p.sections.map(s => ({
      key: s.key, title: s.title, criterion: s.criterion, purpose: s.purpose, status: s.status, body: s.body, version: s.version,
      heldReasons: s.heldReasons, evidence: s.evidence, review: s.review ? { score: s.review.score, weaknesses: s.review.weaknesses } : null,
      guidance: s.guidance,
    }));
  }
  async begin(key: string): Promise<void> {
    await this.store.beginSection(key);
    await observe(this.q, "Start drafting a section", key);
  }
  async write(key: string, body: string, citedFactIds: string[]): Promise<{ version: number; unverifiedQuotes: number }> {
    const r = await this.store.writeSection(key, body, citedFactIds);
    await observe(this.q, "Draft a petition section", `${key}: version ${r.version}, ${r.unverifiedQuotes} unverified quotes.`);
    return r;
  }
  async hold(key: string, reasons: string[]): Promise<void> {
    await this.store.holdSection(key, reasons.map(r => r.trim()).filter(Boolean));
    await observe(this.q, "Hold a section", `${key}: ${reasons.join("; ").slice(0, 160)}`);
  }
  async review(key: string, score: number, weaknesses: { severity: "high" | "medium" | "low"; issue: string; fix: string }[]): Promise<void> {
    await this.store.reviewSection(key, score, weaknesses);
    await observe(this.q, "Record the reviewer's read", `${key}: ${score}/100, ${weaknesses.length} notes.`);
  }
  async exhibits(): Promise<{ exhibitNo: number; documentId: string; title: string }[]> {
    const p = await this.store.petition();
    await observe(this.q, "Read the exhibit list", `${p.exhibits.length} exhibits.`);
    return p.exhibits;
  }
  async assignExhibits(documentIds: string[]): Promise<void> {
    await this.store.assignExhibits(documentIds);
    await observe(this.q, "Number the exhibits", `${documentIds.length} documents.`);
  }
  async directive(): Promise<{ targetPages: number | null; text: string } | null> {
    const d = await this.store.directive();
    await observe(this.q, "Read the standing directive", d ? d.text.slice(0, 120) : "none");
    return d;
  }
  async recordCoherence(findings: { a: string; b: string; issue: string; fix: string; severity: "high" | "medium" | "low" }[]): Promise<void> {
    await this.store.recordCoherence(findings);
    await observe(this.q, "Record the cross-section review", `${findings.length} findings.`);
  }
  async buildPacket(): Promise<{ versionId: string; pages: number; draft: boolean; exhibits: number }> {
    const f = await this.store.buildPacket("agent");
    await observe(this.q, "Bind the USCIS packet", `Bound version ${f.versionId}: ${f.pages} pages, ${f.exhibits} exhibits${f.draft ? ", stamped DRAFT" : ""}.`);
    return { versionId: f.versionId, pages: f.pages, draft: f.draft, exhibits: f.exhibits };
  }

  async saveVersion(reason: string): Promise<{ id: string }> {
    const r = await this.store.savePetitionVersion(reason);
    await observe(this.q, "Save a letter version", reason);
    return r;
  }

  // WP-9: the drafting lane. The whole letter as queue jobs; the counsel is woken when it lands.
  async draftAll(): Promise<{ laneId: string | null; sections: string[]; held: { key: string; reasons: string[] }[]; alreadyRunning: boolean }> {
    const r = await this.store.draftAll("agent");
    await observe(this.q, "Draft the letter", r.alreadyRunning
      ? "A drafting lane is already running; nothing new was started."
      : r.sections.length ? `Started drafting ${r.sections.length} sections; ${r.held.length} held.` : "Nothing cleared for drafting.");
    return r;
  }
  async lane(): Promise<{ id: string; total: number; drafted: number; failed: number; inFlight: number; startedAt: string } | null> {
    return this.store.draftingLane();
  }
  async instructions(): Promise<{ id: string; key: string | null; instruction: string; at: string }[]> {
    const rows = await this.store.pendingInstructions();
    await observe(this.q, "Read the attorney's instructions", `${rows.length} pending.`);
    return rows.map(r => ({ id: r.id, key: r.key, at: r.at, instruction: r.remember ? `${r.instruction} (The attorney asked to remember this for every matter of this type: record it with FIRM.library().rememberRule.)` : r.instruction }));
  }
  async resolveInstruction(id: string): Promise<void> {
    await this.store.resolveInstruction(id);
    await observe(this.q, "Resolve an instruction", id);
  }
}

@validateRpc()
class FormsImpl extends RpcTarget implements MatterForms {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>,
              private readonly env?: Cloudflare.Env) { super(); }

  // ── WP-7: the official PDF and the attorney's rulings ──
  async fetchTemplate(code: string): Promise<{ state: "ready" | "failed"; note: string | null; fillable: number; unmapped: string[] }> {
    if (!this.env) throw new Error("The official form cannot be fetched from this session.");
    await fetchTemplateOnto(this.env, this.store, code);
    const t = await this.store.formTemplate(code);
    await observe(this.q, "Fetch the official form", `${code}: ${t.state === "ready" ? `${t.fields.length} fillable fields` : t.note}`);
    return { state: t.state === "ready" ? "ready" : "failed", note: t.note, fillable: t.fields.filter(f => f.type === "text").length, unmapped: t.unmapped };
  }
  async rulings(code: string): Promise<{ name: string; label: string; review: "proposed" | "accepted" | "asked" | "rejected"; value: string | null }[]> {
    const form = (await this.store.forms()).find(f => f.code === code);
    if (!form) throw new Error(`Form ${code} is not part of this filing.`);
    await observe(this.q, "Read the attorney's rulings on a form", `${code}: ${form.fields.filter(f => f.review !== "proposed").length} rulings.`);
    return form.fields.map(f => ({ name: f.name, label: f.label, review: f.review, value: f.value }));
  }
  // ── end WP-7 ──

  async list(): Promise<Awaited<ReturnType<MatterForms["list"]>>> {
    const forms = await this.store.forms();
    await observe(this.q, "Read the government forms", `${forms.length} forms.`);
    return forms.map(f => ({ code: f.code, title: f.title, filedOnline: f.filedOnline, status: f.status,
      fields: f.fields.map(x => ({ name: x.name, label: x.label, value: x.value, sourceFactId: x.sourceFactId })) }));
  }
  async fill(code: string, values: { name: string; value: string | null; sourceFactId: string | null }[]): Promise<void> {
    await this.store.fillForm(code, values);
    await observe(this.q, "Fill a government form", `${code}: ${values.length} fields.`);
  }
}

@validateRpc()
class DocketImpl extends RpcTarget implements MatterDocket {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async list(): Promise<Deadline[]> {
    const d = await this.store.deadlines();
    await observe(this.q, "Read the docket", `${d.length} deadlines.`);
    return d.map(x => ({ id: x.id, title: x.title, dueOn: x.dueOn, kind: x.kind, met: x.met, daysLeft: x.daysLeft }));
  }
  async add(title: string, dueOn: string, kind: Deadline["kind"]): Promise<{ id: string }> {
    const d = await this.store.addDeadline({ title, dueOn, kind }, "agent");
    await observe(this.q, "Docket a deadline", `${title} on ${dueOn}.`);
    return { id: d.id };
  }
  // WP-13: the whole docket, the key dates, the priority date's standing.
  async full(): Promise<DocketItemView[]> {
    const v = await this.store.docketView();
    await observe(this.q, "Read the docket", `${v.items.length} items, ${v.items.filter(i => !i.met).length} open.`);
    return v.items.map(i => ({ id: i.id, title: i.title, dueOn: i.dueOn, kind: i.kind, met: i.met, daysLeft: i.daysLeft, provenance: i.provenance, derivedFrom: i.derivedFrom }));
  }
  async keyDates(): Promise<KeyDates> {
    const k = await this.store.keyDates();
    await observe(this.q, "Read the key dates", "Read the matter's key dates.");
    return k;
  }
  async setKeyDates(input: Partial<KeyDates>): Promise<KeyDates> {
    const k = await this.store.setKeyDates(input, "agent");
    await observe(this.q, "Set key dates", `Set ${Object.keys(input).join(", ") || "nothing"}.`);
    return k;
  }
  async priorityStanding(): Promise<{ current: boolean | null; note: string } | null> {
    const p = await this.store.priorityStanding();
    await observe(this.q, "Check the priority date", p?.note ?? "No priority date on the matter.");
    return p;
  }
  async markMet(id: string): Promise<void> {
    await this.store.markDocketMet(id, "agent");
    await observe(this.q, "Mark a deadline met", id);
  }
}

@validateRpc()
class ClientImpl extends RpcTarget implements MatterClient {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async record(): Promise<Awaited<ReturnType<MatterClient["record"]>>> {
    const c = await this.store.client();
    await observe(this.q, "Read the client record", c.name);
    return { name: c.name, email: c.email, phone: c.phone, portal: c.portal, documentsSent: c.documentsSent };
  }
  async messages(): Promise<Awaited<ReturnType<MatterClient["messages"]>>> {
    const m = await this.store.messages();
    await observe(this.q, "Read the client messages", `${m.length} messages.`);
    return m;
  }
  async draft(subject: string, body: string): Promise<{ itemId: string }> {
    const r = await this.store.draftOutreach(subject, body);
    // Not an outward action: nothing reaches the client until the attorney releases it from their desk.
    await observe(this.q, "Draft a message to the client", `Put "${subject || "a message"}" on the attorney's desk for release.`);
    return r;
  }
  async submissions(): Promise<{ id: string; at: string; text: string }[]> {
    const s = await this.store.submissions();
    await observe(this.q, "Read the client's own words", `${s.length} submissions.`);
    return s;
  }
}

function recommenderState(r: Recommender): RecommenderState {
  return { id: r.id, name: r.name, title: r.title, organization: r.organization, relationship: r.relationship, basis: r.basis, status: r.status };
}

function letterState(l: RecommendationLetter): LetterState {
  return {
    id: l.id, recommenderId: l.recommenderId, recommenderName: l.recommenderName, body: l.body, version: l.version,
    status: l.status, unverifiedQuotes: l.unverifiedQuotes.map(u => ({ quote: u.quote, reason: u.reason })),
  };
}

// ---- WP-10: the specialists ------------------------------------------------------------------

@validateRpc()
class SpecialistsImpl extends RpcTarget implements MatterSpecialists {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async brief(role: SpecialistRole, scope: SpecialistScope, instruction?: string): Promise<{ title: string; prompt: string }> {
    if (!SPECIALIST_ROLES.includes(role)) throw new Error(`No such specialist: ${role}. Roles: ${SPECIALIST_ROLES.join(", ")}.`);
    const ctx = await this.store.specialistContext(role, scope, instruction?.trim() || null);
    const brief = composeBrief(role, ctx);
    await observe(this.q, "Brief a specialist", `Briefed the ${brief.title.toLowerCase()} on ${ctx.matterTitle}.`);
    return brief;
  }

  async running(role: SpecialistRole, scope: SpecialistScope): Promise<boolean> {
    const files = await this.store.deskList();
    return specialistRunning(files.map(f => ({ path: f.path, updatedAt: f.updatedAt })), role, scope, new Date());
  }
}

/** WP-13: the Request for Evidence, for the agent. */
@validateRpc()
class RfeImpl extends RpcTarget implements MatterRfe {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async current(): Promise<{ id: string; documentId: string; receivedOn: string | null; responseDue: string | null; summary: string; asks: RfeAsk[] } | null> {
    const s = await this.store.rfeState();
    await observe(this.q, "Read the RFE", s ? `${s.asks.length} asks, response due ${s.responseDue ?? "not stated"}.` : "No RFE on the record.");
    return s ? { id: s.id, documentId: s.documentId, receivedOn: s.receivedOn, responseDue: s.responseDue, summary: s.summary, asks: s.asks } : null;
  }
  async draftResponse(askId: string): Promise<RfeResponse> {
    await this.store.rfeDraftStart(askId, "agent");
    await observe(this.q, "Draft an RFE response", "Asked the firm to draft the response to one ask; it lands on the matter.");
    const existing = (await this.store.rfeState())?.responses.find(r => r.askId === askId);
    return existing ? toRfeResponse(existing) : { askId, body: "", citedFactIds: [], unverified: 0, status: "drafted", version: 0 };
  }
  async respond(askId: string, body: string, citedFactIds: string[]): Promise<RfeResponse> {
    if (!body.trim()) throw new Error("A response needs a body.");
    const ctx = await this.store.rfeContext(askId);
    if (!ctx) throw new Error("That RFE ask is not on the matter.");
    const cited = ctx.facts.filter(f => citedFactIds.includes(f.id));
    const unverified = unverifiedQuotes(body, cited.length > 0 ? cited : ctx.facts).length;
    const r = await this.store.saveRfeResponse(askId, body, citedFactIds, unverified, "agent");
    await observe(this.q, "Write an RFE response", unverified > 0 ? `${unverified} quotes do not verify.` : "Every quote verifies.");
    return toRfeResponse(r);
  }
  async responses(): Promise<RfeResponse[]> {
    const s = await this.store.rfeState();
    await observe(this.q, "Read the RFE responses", `${s?.responses.length ?? 0} responses.`);
    return (s?.responses ?? []).map(toRfeResponse);
  }
}

function toRfeResponse(r: { askId: string; body: string; citedFactIds: string[]; unverified: number; status: "drafted" | "approved"; version: number }): RfeResponse {
  return { askId: r.askId, body: r.body, citedFactIds: r.citedFactIds, unverified: r.unverified, status: r.status, version: r.version };
}

/** Recommenders and their letters, for the agent (WP-6 wiring). */
@validateRpc()
class RecommendersImpl extends RpcTarget implements MatterRecommenders {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async list(): Promise<RecommenderState[]> {
    const rows = await this.store.recommenders();
    await observe(this.q, "Read the recommenders", `${rows.length} recommenders on file.`);
    return rows.map(recommenderState);
  }
  async suggest(): Promise<RecommenderState[]> {
    const rows = await this.store.suggestRecommenders();
    await observe(this.q, "Suggest recommenders", `Proposed ${rows.length} recommenders from the record.`);
    return rows.map(recommenderState);
  }
  async add(input: { name: string; title?: string; organization?: string; relationship?: string; basis?: string }): Promise<RecommenderState> {
    if (!input.name?.trim()) throw new Error("A recommender needs a name.");
    const r = await this.store.addRecommender({
      name: input.name.trim(), title: input.title ?? null, organization: input.organization ?? null,
      relationship: input.relationship ?? null, basis: input.basis ?? null,
    }, "agent");
    await observe(this.q, "Add a recommender", `Added ${r.name}.`);
    return recommenderState(r);
  }
  async writeLetter(recommenderId: string, body: string, citedFactIds: string[]): Promise<LetterState> {
    if (!body.trim()) throw new Error("A letter needs a body.");
    const l = await this.store.writeLetter(recommenderId, body, citedFactIds);
    await observe(this.q, "Write a recommendation letter", `Landed a letter for ${l.recommenderName} (${l.unverifiedQuotes.length} unverified quotes).`);
    return letterState(l);
  }
  async letters(): Promise<LetterState[]> {
    const rows = await this.store.letters();
    await observe(this.q, "Read the letters", `${rows.length} letters on file.`);
    return rows.map(letterState);
  }
}

@validateRpc()
export class MatterSessionImpl extends RpcTarget implements MatterSession {
  readonly #files: FilesImpl;
  readonly #evidence: EvidenceImpl;
  readonly #desk: DeskImpl;
  readonly #decisions: DecisionsImpl;
  readonly #knowledge: KnowledgeImpl;
  readonly #petition: PetitionImpl;
  readonly #forms: FormsImpl;
  readonly #docket: DocketImpl;
  readonly #client: ClientImpl;

  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>,
              env: Cloudflare.Env, matterId: string,
              private readonly bindWatch?: WatchBinder) {
    super();
    this.#files = new FilesImpl(q, store, env, matterId);
    this.#evidence = new EvidenceImpl(q, store, env, matterId);
    this.#desk = new DeskImpl(q, store);
    this.#decisions = new DecisionsImpl(q, store);
    this.#knowledge = new KnowledgeImpl(q, store);
    this.#petition = new PetitionImpl(q, store);
    this.#forms = new FormsImpl(q, store, env);
    this.#docket = new DocketImpl(q, store);
    this.#client = new ClientImpl(q, store);
  }

  @skipRpcValidation()
  async watch(callback: RpcStub<MatterWatcherTarget>): Promise<{ status: "bound" | "already_watching" }> {
    if (!this.bindWatch) throw new Error("watch() is only available on the matter's own workspace, not from the firm desk.");
    if (await this.store.watchIsLive()) return { status: "already_watching" };
    await this.bindWatch(callback);
    await this.store.markWatchBound();
    await observe(this.q, "Watch the matter", "Asked to be woken when the matter changes.");
    return { status: "bound" };
  }

  async files(): Promise<MatterFiles> { return this.#files; }
  async evidence(): Promise<MatterEvidence> { return this.#evidence; }
  async desk(): Promise<MatterDesk> { return this.#desk; }
  async decisions(): Promise<MatterDecisions> { return this.#decisions; }
  async knowledge(): Promise<MatterKnowledge> { return this.#knowledge; }
  async petition(): Promise<MatterPetition> { return this.#petition; }
  async forms(): Promise<MatterForms> { return this.#forms; }
  async docket(): Promise<MatterDocket> { return this.#docket; }
  async client(): Promise<MatterClient> { return this.#client; }

  // WP-8: standing directives and memory, reached like files().
  async directives(): Promise<MatterDirectives> { return new DirectivesImpl(this.q, this.store); }
  async memory(): Promise<MatterMemory> { return new MemoryImpl(this.q, this.store); }
  // WP-6 and WP-5: recommenders and the case intelligence.
  async recommenders(): Promise<MatterRecommenders> { return new RecommendersImpl(this.q, this.store); }
  async intelligence(): Promise<MatterIntelligence> { return new IntelligenceImpl(this.q, this.store); }
  // WP-13: the Request for Evidence.
  async rfe(): Promise<MatterRfe> { return new RfeImpl(this.q, this.store); }
  // WP-10: the specialists the counsel briefs and spawns.
  async specialists(): Promise<MatterSpecialists> { return new SpecialistsImpl(this.q, this.store); }

  async proposePlan(summary: string): Promise<{ id: string }> {
    const r = await this.store.proposePlan(summary.trim());
    await observe(this.q, "Propose the plan", "Put the plan on the attorney's desk for approval.");
    return r;
  }
  async planApproved(): Promise<boolean> {
    const ok = await this.store.planApproved();
    await observe(this.q, "Check the plan's approval", ok ? "Approved." : "Not yet approved.");
    return ok;
  }

  async overview(): Promise<MatterOverview> {
    const o = await this.store.overview();
    await observe(this.q, "Read the matter overview", `${o.title}: ${o.record.documents} documents, ${o.record.facts} facts.`);
    return o;
  }
  async activity(options?: { limit?: number }): Promise<ActivityEntry[]> {
    const a = await this.store.activity(options?.limit ?? 50);
    await observe(this.q, "Read the activity", `Read ${a.length} activity entries.`);
    return a;
  }
  async note(summary: string): Promise<void> {
    await this.store.note("agent", summary);
    await observe(this.q, "Record a note", summary.slice(0, 200));
  }
  async setCaseType(caseType: string): Promise<void> {
    const ct = caseType.trim().toUpperCase().replace(/\s+/g, "-");
    await this.store.setCaseType(ct, "agent");
    await observe(this.q, "Set the matter type", `Matter type set to ${ct}.`);
  }

  [Symbol.dispose](): void { this.q[Symbol.dispose]?.(); }
}

// ---- WP-8: directives and memory, the agent's side ---------------------------------------------

@validateRpc()
export class DirectivesImpl extends RpcTarget implements MatterDirectives {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async list(): Promise<MatterDirective[]> {
    const rows = await this.store.listDirectives();
    await observe(this.q, "Read the standing directives", `Read ${rows.length} directives.`);
    return rows;
  }
}

@validateRpc()
export class MemoryImpl extends RpcTarget implements MatterMemory {
  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>) { super(); }

  async list(): Promise<MemoryNote[]> {
    const rows = await this.store.listMemoryNotes();
    await observe(this.q, "Read the matter notes", `Read ${rows.length} notes.`);
    return rows;
  }
  async add(text: string): Promise<{ id: string }> {
    const note = await this.store.addMemoryNote(text, "agent");
    await observe(this.q, "Keep a note", note.text.slice(0, 160));
    return { id: note.id };
  }
  async remove(id: string): Promise<void> {
    await this.store.removeMemoryNote(id);
    await observe(this.q, "Drop a note", `Dropped note ${id}.`);
  }
}

export type { MatterMeta };
export { normalizePath, parseMatterUrl };

export { FirmMattersGatekeeper } from "./firm-matters.js";
export { FirmIndex, FirmAdminApi } from "./firm-index.js";
