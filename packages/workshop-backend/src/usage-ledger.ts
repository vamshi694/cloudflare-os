// Legal OS: the deployment-wide usage ledger. One row per model turn (who, which workspace and
// chat, tokens, dollars, automated or interactive), written by every Overseer as costs land, read
// by the admin's Usage tab and by the monthly-ceiling gate on automated turns. Single instance,
// always addressed as getByName("").

import { DurableObject } from "cloudflare:workers";
import type { UsageSummary } from "@gadgets/workshop-shared/api";

export type UsageTurn = {
  userId: string;
  workspaceId: string;
  chatId: number;
  modelId: string | null;
  automated: boolean;
  totalTokens: number | null;
  cost: number;
};

export class UsageLedger extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      day TEXT NOT NULL,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      model_id TEXT,
      automated INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER,
      cost REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_turns_user_at ON turns(user_id, at);
    CREATE INDEX IF NOT EXISTS ix_turns_day ON turns(day);`);
  }

  async record(turn: UsageTurn): Promise<void> {
    const at = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `INSERT INTO turns(at, day, user_id, workspace_id, chat_id, model_id, automated, total_tokens, cost)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      at, at.slice(0, 10), turn.userId, turn.workspaceId, turn.chatId, turn.modelId,
      turn.automated ? 1 : 0, turn.totalTokens, turn.cost);
  }

  /** Dollars this user spent since `sinceIso` (both interactive and automated turns). */
  async spentSince(userId: string, sinceIso: string): Promise<number> {
    const row = this.ctx.storage.sql.exec(
      "SELECT COALESCE(SUM(cost), 0) AS c FROM turns WHERE user_id = ? AND at >= ?", userId, sinceIso)
      .toArray()[0] as { c: number } | undefined;
    return row?.c ?? 0;
  }

  async summary(days: number): Promise<UsageSummary> {
    const n = Math.max(1, Math.min(365, Math.floor(days)));
    const since = new Date(Date.now() - n * 86_400_000).toISOString();
    const sql = this.ctx.storage.sql;
    const totals = sql.exec(
      "SELECT COUNT(*) AS turns, COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(total_tokens),0) AS tokens FROM turns WHERE at >= ?", since)
      .toArray()[0] as { turns: number; cost: number; tokens: number };
    const byUser = sql.exec(
      `SELECT user_id AS userId, COUNT(*) AS turns, COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(total_tokens),0) AS tokens,
              SUM(automated) AS automatedTurns, COUNT(DISTINCT workspace_id) AS workspaces
       FROM turns WHERE at >= ? GROUP BY user_id ORDER BY cost DESC`, since).toArray() as UsageSummary["byUser"];
    const byDay = sql.exec(
      "SELECT day, COUNT(*) AS turns, COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(total_tokens),0) AS tokens FROM turns WHERE at >= ? GROUP BY day ORDER BY day",
      since).toArray() as UsageSummary["byDay"];
    const byModel = sql.exec(
      "SELECT COALESCE(model_id, 'unknown') AS modelId, COUNT(*) AS turns, COALESCE(SUM(cost),0) AS cost FROM turns WHERE at >= ? GROUP BY model_id ORDER BY cost DESC",
      since).toArray() as UsageSummary["byModel"];
    const byWorkspace = sql.exec(
      "SELECT workspace_id AS workspaceId, user_id AS userId, COUNT(*) AS turns, COALESCE(SUM(cost),0) AS cost FROM turns WHERE at >= ? GROUP BY workspace_id, user_id ORDER BY cost DESC LIMIT 100",
      since).toArray() as UsageSummary["byWorkspace"];
    return { days: n, since, turns: totals.turns, cost: totals.cost, tokens: totals.tokens, byUser, byDay, byModel, byWorkspace };
  }
}
