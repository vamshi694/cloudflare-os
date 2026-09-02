// The firm-wide matter index and the admin's view over it.
//
// Every lawyer's matters live in their own MatterAccount; the firm's admins need one list. The
// FirmIndex (one Durable Object per deployment, name "") is the registry: which matter belongs to
// whom, written when a matter is opened or removed. Everything that changes (phase, needs-you,
// documents) is read live from each matter's store when an admin looks, so the index never holds
// a stale copy of the record.
//
// The workshop reaches this through the GatekeeperVendor's `getFirmAdminApi()` (a named
// entrypoint handed over as a stub), the same way it reaches a user's verifier.

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type { MatterStore } from "./store.js";

export type FirmIndexEntry = {
  matterId: string;
  ownerAccountId: string;
  /** The lawyer's username, learned when their desk opens; null for matters opened before that. */
  ownerUserId: string | null;
  title: string;
  clientName: string;
  createdAt: string;
};

/** One matter as the firm's admin sees it: who owns it, where it stands, what it holds. */
export type FirmMatterRow = {
  matterId: string;
  ownerUserId: string | null;
  title: string;
  clientName: string;
  caseType: string | null;
  status: "open" | "paused" | "closed";
  phase: string;
  needsYou: number;
  documents: number;
  facts: number;
  workspaceId: string | null;
  createdAt: string;
  /** Null when the matter's store could not be read; the row still shows what the index knows. */
  unreachable: boolean;
};

/** What the firm did over a window, counted from every matter's activity trail. */
export type FirmAnalytics = {
  days: number;
  since: string;
  matters: number;
  documentsRead: number;
  factsOnFile: number;
  claimsOnFile: number;
  sectionsDrafted: number;
  decisionsAnswered: number;
  clientMessages: number;
  byDay: { day: string; documentsRead: number; sectionsDrafted: number; decisionsAnswered: number }[];
};

export class FirmIndex extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS matters (
        matter_id TEXT PRIMARY KEY, owner_account_id TEXT NOT NULL, owner_user_id TEXT,
        title TEXT NOT NULL, client_name TEXT NOT NULL, created_at TEXT NOT NULL)`);
    });
  }

  async upsert(entry: Omit<FirmIndexEntry, "ownerUserId"> & { ownerUserId?: string | null }): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO matters(matter_id, owner_account_id, owner_user_id, title, client_name, created_at) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(matter_id) DO UPDATE SET owner_account_id = excluded.owner_account_id,
         owner_user_id = COALESCE(excluded.owner_user_id, matters.owner_user_id), title = excluded.title, client_name = excluded.client_name`,
      entry.matterId, entry.ownerAccountId, entry.ownerUserId ?? null, entry.title, entry.clientName, entry.createdAt);
  }

  async remove(matterId: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM matters WHERE matter_id = ?", matterId);
  }

  /** Learn who a matter account belongs to; called whenever a lawyer's desk opens. */
  async claimOwner(ownerAccountId: string, ownerUserId: string): Promise<void> {
    this.ctx.storage.sql.exec("UPDATE matters SET owner_user_id = ? WHERE owner_account_id = ?", ownerUserId, ownerAccountId);
  }

  async list(): Promise<FirmIndexEntry[]> {
    return this.ctx.storage.sql.exec(
      `SELECT matter_id AS matterId, owner_account_id AS ownerAccountId, owner_user_id AS ownerUserId,
              title, client_name AS clientName, created_at AS createdAt FROM matters ORDER BY created_at DESC`)
      .toArray() as FirmIndexEntry[];
  }
}

function dayOf(iso: string): string { return iso.slice(0, 10); }

/** Classify one activity line into the analytics it counts toward. Unknown lines count nothing. */
export function classifyActivity(summary: string): "document_read" | "section_drafted" | "decision_answered" | "client_message" | null {
  if (/^Read "/.test(summary)) return "document_read";
  if (/^(Drafted|Landed|Wrote|Redrafted) /.test(summary) || /section .*(landed|drafted)/i.test(summary)) return "section_drafted";
  if (/^(Answered: |On the plan: |On the client message: )/.test(summary)) return "decision_answered";
  if (/^(Wrote to the client\.|The client replied through the portal\.|Released )/.test(summary)) return "client_message";
  return null;
}

@validateRpc()
export class FirmAdminApi extends WorkerEntrypoint<Cloudflare.Env> {
  #index(): DurableObjectStub<FirmIndex> { return this.ctx.exports.FirmIndex.getByName(""); }
  #store(matterId: string): DurableObjectStub<MatterStore> {
    return this.env.MATTER_STORE.get(this.env.MATTER_STORE.idFromName(matterId));
  }

  /** Every matter in the firm, each read live from its own store. */
  async listFirmMatters(): Promise<FirmMatterRow[]> {
    const entries = await this.#index().list();
    return Promise.all(entries.map(async (e): Promise<FirmMatterRow> => {
      const base = {
        matterId: e.matterId, ownerUserId: e.ownerUserId, title: e.title, clientName: e.clientName, createdAt: e.createdAt,
      };
      try {
        const o = await this.#store(e.matterId).overview();
        return {
          ...base, title: o.title, clientName: o.clientName, caseType: o.caseType, status: o.status,
          phase: o.statusLine.phase, needsYou: o.needsYouItems.length, documents: o.record.documents,
          facts: o.record.facts, workspaceId: o.workspaceId, unreachable: false,
        };
      } catch {
        return { ...base, caseType: null, status: "open", phase: "idle", needsYou: 0, documents: 0, facts: 0, workspaceId: null, unreachable: true };
      }
    }));
  }

  /** The firm's work over the window, from every matter's activity trail and knowledge. */
  async firmAnalytics(days: number): Promise<FirmAnalytics> {
    const n = Math.max(1, Math.min(365, Math.floor(days)));
    const since = new Date(Date.now() - n * 86_400_000).toISOString();
    const entries = await this.#index().list();
    const totals = { documentsRead: 0, factsOnFile: 0, claimsOnFile: 0, sectionsDrafted: 0, decisionsAnswered: 0, clientMessages: 0 };
    const byDay = new Map<string, { documentsRead: number; sectionsDrafted: number; decisionsAnswered: number }>();
    await Promise.all(entries.map(async e => {
      const store = this.#store(e.matterId);
      try {
        const [activity, overview, map] = await Promise.all([store.activity(500), store.overview(), store.caseMap()]);
        totals.factsOnFile += overview.record.facts;
        totals.claimsOnFile += map.claims.filter(c => !c.removed).length;
        for (const a of activity) {
          if (a.at < since) continue;
          const kind = classifyActivity(a.summary);
          if (!kind) continue;
          const day = byDay.get(dayOf(a.at)) ?? { documentsRead: 0, sectionsDrafted: 0, decisionsAnswered: 0 };
          if (kind === "document_read") { totals.documentsRead++; day.documentsRead++; }
          else if (kind === "section_drafted") { totals.sectionsDrafted++; day.sectionsDrafted++; }
          else if (kind === "decision_answered") { totals.decisionsAnswered++; day.decisionsAnswered++; }
          else totals.clientMessages++;
          byDay.set(dayOf(a.at), day);
        }
      } catch {
        // A matter whose store cannot be read counts nothing; the Matters tab shows it as unreachable.
      }
    }));
    return {
      days: n, since, matters: entries.length, ...totals,
      byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
    };
  }
}
