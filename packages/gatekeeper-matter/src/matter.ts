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
  GatekeeperUser, GatekeeperUserVerifier, ObservationDescription, ResourceConfiguratorFrame,
  ResourceDescription, SupportedResource, VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import type {
  ActivityEntry, Decision, DeskFile, DocumentSummary, DocumentText, Fact, FactFilter, MatterDecisions,
  MatterDesk, MatterEvidence, MatterFiles, MatterOverview, MatterSession, SearchHit, TextHit,
} from "./types.js";
import TYPES_CODE from "./types.txt";
import { MatterStore, type MatterMeta } from "./store.js";
import { normalizePath, parseMatterUrl } from "./pure.js";
import { MatterConfiguratorUI } from "./configurator.js";
import { LegalDeskImpl } from "./desk.js";
import type { LegalDesk } from "@gadgets/workshop-shared/legal";
import MATTER_CONFIGURATOR_HTML from "./generated/matter-configurator-ui.txt";

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

  async createMatter(input: { title: string; caseType: string | null; clientName: string }): Promise<MatterIndexEntry> {
    const title = input.title.trim();
    const clientName = input.clientName.trim();
    if (!title) throw new Error("A matter needs a title.");
    if (!clientName) throw new Error("A matter needs the client's name.");
    const id = crypto.randomUUID().replace(/-/g, "");
    const createdAt = new Date().toISOString();
    await this.#store(id).init({ id, title, caseType: input.caseType, clientName, ownerAccountId: this.ctx.id.toString() });
    this.ctx.storage.sql.exec("INSERT INTO matters(id, title, case_type, client_name, created_at) VALUES(?, ?, ?, ?, ?)",
      id, title, input.caseType, clientName, createdAt);
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
}

// ---- User entrypoint --------------------------------------------------------------------------

@validateRpc()
export class MatterUser extends WorkerEntrypoint<Cloudflare.Env, AccountProps> implements GatekeeperUser {
  #account(): DurableObjectStub<MatterAccount> {
    const ns = this.ctx.exports.MatterAccount;
    return ns.get(ns.idFromString(this.ctx.props.accountObjectId));
  }

  async describe(): Promise<AccountDescription> {
    return { displayName: "Matters", avatar: MATTER_ICON };
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

  /** Legal OS: the lawyer's own desk over their matters (see AuthenticatedApi.getLegalDesk). */
  async startLegalDesk(): Promise<LegalDesk> {
    return new LegalDeskImpl(this.#account(), this.env);
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
    return new MatterSessionImpl(approvalQueue.dup(), this.#store(), this.env, this.ctx.props.matterId);
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
export class MatterSessionImpl extends RpcTarget implements MatterSession {
  readonly #files: FilesImpl;
  readonly #evidence: EvidenceImpl;
  readonly #desk: DeskImpl;
  readonly #decisions: DecisionsImpl;

  constructor(private readonly q: ObservationQueue, private readonly store: DurableObjectStub<MatterStore>,
              env: Cloudflare.Env, matterId: string) {
    super();
    this.#files = new FilesImpl(q, store, env, matterId);
    this.#evidence = new EvidenceImpl(q, store, env, matterId);
    this.#desk = new DeskImpl(q, store);
    this.#decisions = new DecisionsImpl(q, store);
  }

  async files(): Promise<MatterFiles> { return this.#files; }
  async evidence(): Promise<MatterEvidence> { return this.#evidence; }
  async desk(): Promise<MatterDesk> { return this.#desk; }
  async decisions(): Promise<MatterDecisions> { return this.#decisions; }

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

export type { MatterMeta };
export { normalizePath, parseMatterUrl };
