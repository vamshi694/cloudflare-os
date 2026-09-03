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
import type { MatterAccount } from "./matter.js";
import { ownershipTransition } from "./process.js";
import { findConflicts, type ConflictHit, type PartyNames } from "./conflicts.js";

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
  /** Why the firm stopped work on it: its owner was removed. Reassign to resume. */
  hold: "removed_owner" | null;
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

/** The models each lane runs on; null keeps the worker's configured default. */
export type LaneModels = { reader: string | null; knowledge: string | null; drafting: string | null; critic: string | null };
export type Lane = keyof LaneModels;
// (laneModel() lives in process.ts so the lanes never import this Durable Object module.)
const LANES: Lane[] = ["reader", "knowledge", "drafting", "critic"];

export class FirmIndex extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS matters (
        matter_id TEXT PRIMARY KEY, owner_account_id TEXT NOT NULL, owner_user_id TEXT,
        title TEXT NOT NULL, client_name TEXT NOT NULL, created_at TEXT NOT NULL)`);
      // WP-8: holds, the owner directory (username → account, so reassignment can target a member
      // by name), and the firm's settings (lane models).
      const cols = ctx.storage.sql.exec("PRAGMA table_info(matters)").toArray().map(r => r.name as string);
      if (!cols.includes("hold")) ctx.storage.sql.exec("ALTER TABLE matters ADD COLUMN hold TEXT");
      if (!cols.includes("held_at")) ctx.storage.sql.exec("ALTER TABLE matters ADD COLUMN held_at TEXT");
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS owners (
        owner_user_id TEXT PRIMARY KEY, owner_account_id TEXT NOT NULL, seen_at TEXT NOT NULL,
        removed_at TEXT, removed_by TEXT)`);
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
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
    this.ctx.storage.sql.exec(
      `INSERT INTO owners(owner_user_id, owner_account_id, seen_at) VALUES(?, ?, ?)
       ON CONFLICT(owner_user_id) DO UPDATE SET owner_account_id = excluded.owner_account_id, seen_at = excluded.seen_at`,
      ownerUserId, ownerAccountId, new Date().toISOString());
  }

  async list(): Promise<(FirmIndexEntry & { hold: "removed_owner" | null })[]> {
    return this.ctx.storage.sql.exec(
      `SELECT matter_id AS matterId, owner_account_id AS ownerAccountId, owner_user_id AS ownerUserId,
              title, client_name AS clientName, created_at AS createdAt, hold FROM matters ORDER BY created_at DESC`)
      .toArray().map(r => ({ ...r, hold: (r.hold as "removed_owner" | null) ?? null })) as (FirmIndexEntry & { hold: "removed_owner" | null })[];
  }

  async entry(matterId: string): Promise<(FirmIndexEntry & { hold: "removed_owner" | null }) | null> {
    const r = this.ctx.storage.sql.exec(
      `SELECT matter_id AS matterId, owner_account_id AS ownerAccountId, owner_user_id AS ownerUserId,
              title, client_name AS clientName, created_at AS createdAt, hold FROM matters WHERE matter_id = ?`, matterId).toArray()[0];
    return r ? ({ ...r, hold: (r.hold as "removed_owner" | null) ?? null } as FirmIndexEntry & { hold: "removed_owner" | null }) : null;
  }

  /** The account behind a member's username, once their desk has opened; null when never seen. */
  async ownerAccount(ownerUserId: string): Promise<string | null> {
    const r = this.ctx.storage.sql.exec("SELECT owner_account_id FROM owners WHERE owner_user_id = ?", ownerUserId).toArray()[0];
    return (r?.owner_account_id as string | undefined) ?? null;
  }

  /** Hold every matter a removed member owns. Returns the matter ids so their stores can pause. */
  async holdOwner(ownerUserId: string, by: string): Promise<string[]> {
    const at = new Date().toISOString();
    const ids = this.ctx.storage.sql.exec("SELECT matter_id FROM matters WHERE owner_user_id = ?", ownerUserId).toArray().map(r => r.matter_id as string);
    for (const id of ids) {
      const row = this.ctx.storage.sql.exec("SELECT owner_user_id, hold FROM matters WHERE matter_id = ?", id).toArray()[0];
      const next = ownershipTransition({ ownerUserId: (row?.owner_user_id as string | null) ?? null, hold: (row?.hold as "removed_owner" | null) ?? null }, { type: "remove_owner" });
      this.ctx.storage.sql.exec("UPDATE matters SET hold = ?, held_at = ? WHERE matter_id = ?", next.hold, at, id);
    }
    this.ctx.storage.sql.exec("UPDATE owners SET removed_at = ?, removed_by = ? WHERE owner_user_id = ?", at, by, ownerUserId);
    return ids;
  }

  /** Move a matter to another member and lift its hold. The caller moves the per-account rows. */
  async reassign(matterId: string, toUserId: string): Promise<{ fromAccountId: string; toAccountId: string; fromUserId: string | null }> {
    const row = this.ctx.storage.sql.exec("SELECT owner_account_id, owner_user_id, hold FROM matters WHERE matter_id = ?", matterId).toArray()[0];
    if (!row) throw new Error("That matter is not in the firm's registry.");
    const toAccountId = await this.ownerAccount(toUserId);
    if (!toAccountId) throw new Error(`${toUserId} has not opened their desk yet, so the firm cannot hand them a matter. Ask them to sign in once.`);
    const next = ownershipTransition({ ownerUserId: (row.owner_user_id as string | null) ?? null, hold: (row.hold as "removed_owner" | null) ?? null }, { type: "reassign", toUserId });
    this.ctx.storage.sql.exec("UPDATE matters SET owner_account_id = ?, owner_user_id = ?, hold = ?, held_at = NULL WHERE matter_id = ?",
      toAccountId, next.ownerUserId, next.hold, matterId);
    return { fromAccountId: row.owner_account_id as string, toAccountId, fromUserId: (row.owner_user_id as string | null) ?? null };
  }

  async removedMembers(): Promise<{ userId: string; removedAt: string; removedBy: string }[]> {
    return this.ctx.storage.sql.exec(
      "SELECT owner_user_id AS userId, removed_at AS removedAt, removed_by AS removedBy FROM owners WHERE removed_at IS NOT NULL ORDER BY removed_at DESC")
      .toArray() as { userId: string; removedAt: string; removedBy: string }[];
  }

  // ---- WP-16: the conflict check ----------------------------------------------------------------

  /**
   * Every matter in the firm whose client, title, or case-map entity matches a party name. Reads
   * each matter's names live; a store that does not answer is skipped (a conflict check that
   * fails open is still a check; the screen says how many matters it could not read).
   */
  async conflictCheck(names: string[], options?: { excludeMatterId?: string }): Promise<{ hits: ConflictHit[]; matters: number; unreachable: number }> {
    const entries = await this.list();
    const parties: PartyNames[] = [];
    let unreachable = 0;
    await Promise.all(entries.map(async e => {
      try {
        const store = this.env.MATTER_STORE.get(this.env.MATTER_STORE.idFromName(e.matterId));
        const p = await store.partyNames();
        parties.push({ ...p, ownerUserId: e.ownerUserId ?? p.ownerUserId });
      } catch {
        unreachable += 1;
        parties.push({ matterId: e.matterId, title: e.title, clientName: e.clientName, ownerUserId: e.ownerUserId, entities: [] });
      }
    }));
    return { hits: findConflicts(names, parties, options), matters: entries.length, unreachable };
  }

  async laneModels(): Promise<LaneModels> {
    const raw = this.ctx.storage.sql.exec("SELECT value FROM settings WHERE key = 'lane_models'").toArray()[0]?.value as string | undefined;
    const parsed = raw ? JSON.parse(raw) as Partial<LaneModels> : {};
    return { reader: parsed.reader ?? null, knowledge: parsed.knowledge ?? null, drafting: parsed.drafting ?? null, critic: parsed.critic ?? null };
  }

  async setLaneModels(models: LaneModels): Promise<void> {
    const clean: LaneModels = { reader: null, knowledge: null, drafting: null, critic: null };
    for (const lane of LANES) {
      const v = (models[lane] ?? "").trim();
      if (v && !/^[@a-zA-Z0-9._\/-]{3,120}$/.test(v)) throw new Error(`"${v}" is not a model id.`);
      clean[lane] = v || null;
    }
    this.ctx.storage.sql.exec("INSERT INTO settings(key, value) VALUES('lane_models', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(clean));
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
        hold: e.hold,
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

  // ---- WP-8: the firm's process ----------------------------------------------------------------
  // The workshop calls these only for admins (AuthenticatedApi.getAdminApi is null otherwise);
  // `by` is the acting admin's username for the ledger.

  #account(accountObjectId: string): DurableObjectStub<MatterAccount> {
    const ns = this.ctx.exports.MatterAccount;
    return ns.get(ns.idFromString(accountObjectId));
  }

  /**
   * Hand a matter to another member: the registry row moves, the two accounts' indexes follow, the
   * store's owner and hold change, and the matter resumes if it was held. Nothing is deleted.
   */
  async reassignMatter(matterId: string, toUserId: string, by: string): Promise<void> {
    const to = toUserId.trim();
    if (!to) throw new Error("Choose the member to reassign to.");
    const moved = await this.#index().reassign(matterId, to);
    const entry = await this.#index().entry(matterId);
    if (moved.fromAccountId !== moved.toAccountId) {
      await this.#account(moved.toAccountId).adoptMatter({
        id: matterId, title: entry?.title ?? "", caseType: null, clientName: entry?.clientName ?? "", createdAt: entry?.createdAt ?? new Date().toISOString(),
      });
      await this.#account(moved.fromAccountId).forgetMatter(matterId);
    }
    await this.#store(matterId).transferOwnership(moved.toAccountId, to, moved.fromUserId, by);
  }

  /** Remove a member: their matters pause with a visible hold until an admin reassigns them. */
  async removeMember(userId: string, by: string): Promise<{ heldMatters: number }> {
    const user = userId.trim();
    if (!user) throw new Error("Name the member to remove.");
    const ids = await this.#index().holdOwner(user, by);
    await Promise.all(ids.map(id => this.#store(id).placeHold(user, by).catch(() => {})));
    return { heldMatters: ids.length };
  }

  async removedMembers(): Promise<{ userId: string; removedAt: string; removedBy: string }[]> {
    return this.#index().removedMembers();
  }

  async laneModels(): Promise<LaneModels> { return this.#index().laneModels(); }
  async setLaneModels(models: LaneModels): Promise<void> { await this.#index().setLaneModels(models); }

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
