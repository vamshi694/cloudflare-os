// The firm's matters as one agent capability (MATTERS): the singleton on every lawyer's Matters
// account, folded into every workspace as an ambient capsule, so the firm-wide conversation can
// scan the desk, read a matter, and open one for evidence questions. Everything comes from the
// per-matter stores live; nothing here is cached.

import { DurableObject, RpcStub, RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type {
  ApprovalQueue, Gatekeeper, GatekeeperUserVerifier, ObservationDescription, ResourceDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import type { ActivityEntry, Decision, MatterOverview, MatterSession } from "./types.js";
import type { FirmBriefRow, FirmMatterSummary, FirmMattersSession } from "./types.js";
import TYPES_CODE from "./types.txt";
import type { MatterStore } from "./store.js";
import type { MatterAccount } from "./matter.js";
import { MatterSessionImpl } from "./matter.js";

type AccountProps = { accountObjectId: string };
type ObservationQueue = Pick<ApprovalQueue, "authorizeObservation"> & Partial<{ [Symbol.dispose](): void }>;

async function observe(queue: ObservationQueue, title: string, description: string): Promise<void> {
  await queue.authorizeObservation({ title, description } satisfies ObservationDescription);
}

export function summarize(o: MatterOverview): FirmMatterSummary {
  return {
    id: o.id, title: o.title, caseType: o.caseType, clientName: o.clientName, status: o.status,
    record: { documents: o.record.documents, reading: o.record.reading, failed: o.record.failed, facts: o.record.facts },
    needsYou: o.needsYou,
  };
}

/** One row of the morning brief: the matter's own open question, else its single strongest signal. */
export function briefRow(o: MatterOverview, ask: string | null): FirmBriefRow | null {
  const needs = o.needsYou.openDecisions + o.needsYou.unreadableDocuments;
  const signal: FirmBriefRow["signal"] | null =
    o.status === "paused" ? { kind: "paused", count: 1 }
    : needs > 0 ? { kind: "needs_you", count: needs }
    : o.record.reading > 0 ? { kind: "reading", count: o.record.reading }
    : null;
  if (!signal) return null;
  return { matterId: o.id, title: o.title, caseType: o.caseType, ask, signal };
}

@validateRpc()
export class FirmMattersSessionImpl extends RpcTarget implements FirmMattersSession {
  constructor(private readonly q: ObservationQueue, private readonly account: DurableObjectStub<MatterAccount>,
              private readonly env: Cloudflare.Env) { super(); }

  #store(matterId: string): DurableObjectStub<MatterStore> {
    return this.env.MATTER_STORE.get(this.env.MATTER_STORE.idFromName(matterId));
  }

  async #overviews(): Promise<MatterOverview[]> {
    const matters = await this.account.listMatters();
    return Promise.all(matters.map(m => this.#store(m.id).overview()));
  }

  async listMatters(): Promise<FirmMatterSummary[]> {
    const all = (await this.#overviews()).map(summarize);
    await observe(this.q, "Scan the matters", `Listed ${all.length} matters on the lawyer's desk.`);
    return all;
  }

  async readMatter(matterId: string): Promise<{ overview: MatterOverview; openDecisions: Decision[]; activity: ActivityEntry[] }> {
    if (!(await this.account.hasMatter(matterId))) throw new Error("That matter is not on this lawyer's desk.");
    const store = this.#store(matterId);
    const [overview, decisions, activity] = await Promise.all([store.overview(), store.listDecisions(), store.activity(20)]);
    await observe(this.q, "Read a matter", `Read ${overview.title}: ${overview.record.documents} documents, ${overview.needsYou.openDecisions} open decisions.`);
    return { overview, openDecisions: decisions.filter(d => d.status === "open"), activity };
  }

  // WP-16: the conflict check, for the counsel at intake ("is this party already on a matter?").
  async conflictCheck(names: string[]): Promise<{ hits: { matterId: string; title: string; ownerUserId: string | null; matched: string; role: string; query: string }[]; matters: number; unreachable: number }> {
    const cleaned = names.map(n => n.trim()).filter(Boolean).slice(0, 20);
    const r = cleaned.length === 0 ? { hits: [], matters: 0, unreachable: 0 } : await this.env.FIRM_INDEX.getByName("").conflictCheck(cleaned);
    await observe(this.q, "Check for conflicts", `Checked ${cleaned.length} names against ${r.matters} matters: ${r.hits.length} hits.`);
    return r;
  }

  async brief(): Promise<{ needsYou: number; active: FirmBriefRow[]; resting: number; today: string }> {
    const overviews = await this.#overviews();
    const rows: FirmBriefRow[] = [];
    let needsYou = 0;
    for (const o of overviews) {
      needsYou += o.needsYou.openDecisions + o.needsYou.unreadableDocuments;
      let ask: string | null = null;
      if (o.needsYou.openDecisions > 0) {
        const open = (await this.#store(o.id).listDecisions()).find(d => d.status === "open");
        ask = open?.question ?? null;
      }
      const row = briefRow(o, ask);
      if (row) rows.push(row);
    }
    const order = { paused: 0, needs_you: 1, reading: 2, updates: 3 } as const;
    rows.sort((a, b) => order[a.signal.kind] - order[b.signal.kind]);
    await observe(this.q, "Read the firm's brief", `${needsYou} items need the lawyer across ${overviews.length} matters.`);
    return { needsYou, active: rows, resting: overviews.length - rows.length, today: new Date().toISOString().slice(0, 10) };
  }

  async openMatter(matterId: string): Promise<MatterSession> {
    if (!(await this.account.hasMatter(matterId))) throw new Error("That matter is not on this lawyer's desk.");
    await observe(this.q, "Open a matter", `Opened matter ${matterId} for questions about its record.`);
    return new MatterSessionImpl(this.q, this.#store(matterId), this.env, matterId);
  }

  [Symbol.dispose](): void { this.q[Symbol.dispose]?.(); }
}

/** The singleton gatekeeper facet: MATTERS on every workspace of this lawyer. */
@validateRpc()
export class FirmMattersGatekeeper extends DurableObject<Cloudflare.Env, AccountProps> implements Gatekeeper<FirmMattersSession> {
  #account(): DurableObjectStub<MatterAccount> {
    const ns = this.ctx.exports.MatterAccount;
    return ns.get(ns.idFromString(this.ctx.props.accountObjectId));
  }

  async describe(): Promise<ResourceDescription> {
    return {
      url: "legal://matters",
      title: "The firm's matters",
      snippet: "Every matter on this lawyer's desk: where each stands, what needs them, and a way into any one of them.",
      suggestedBindingName: "MATTERS",
      tsType: "FirmMattersSession",
    };
  }

  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }
  async getAutoApprovableActions(): Promise<[]> { return []; }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<FirmMattersSession> {
    return new FirmMattersSessionImpl(approvalQueue.dup(), this.#account(), this.env);
  }

  // The desk is the lawyer's own; a collaborator on their firm conversation sees what they see.
  async addObserver(_id: string, _user: Fetcher<GatekeeperUserVerifier>): Promise<void> {}
  async removeObserver(_id: string): Promise<void> {}
  async applyAction(action: number): Promise<void> { throw new Error(`The matters desk has no actions (${action}).`); }
  async rejectAction(_action: number): Promise<void> {}
  async revertAction(_action: number): Promise<void> { throw new Error("The matters desk has no actions to revert."); }
}
