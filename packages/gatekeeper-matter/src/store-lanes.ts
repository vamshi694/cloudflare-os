// The lanes' storage: the knowledge build's fan-out counter and the drafting lane's job rows.
// The MatterStore composes this over its Db handle; jobs.ts drives the transitions from the queue.

import type { DraftingLane } from "@gadgets/workshop-shared/legal";
import { advance, allDone, type LaneCounter } from "./lanes.js";
import { parseJson, type Db } from "./store-db.js";

export const LANES_SCHEMA = `
CREATE TABLE IF NOT EXISTS drafting_jobs (
  lane_id TEXT NOT NULL, key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
  note TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (lane_id, key));
`;

// ---- the knowledge build's fan-out -------------------------------------------------------------

export type KnowledgeBuild = { buildId: string; total: number; done: number; failed: number; documents: string[]; failures: string[] };

function readBuild(db: Db): KnowledgeBuild | null {
  const buildId = db.metaGet("knowledge_build_id");
  if (!buildId) return null;
  return {
    buildId,
    total: Number(db.metaGet("knowledge_batches_total") ?? "0"),
    done: Number(db.metaGet("knowledge_batches_done") ?? "0"),
    failed: Number(db.metaGet("knowledge_batches_failed") ?? "0"),
    documents: parseJson<string[]>(db.metaGet("knowledge_build_documents"), []),
    failures: parseJson<string[]>(db.metaGet("knowledge_build_failures"), []),
  };
}

function writeBuild(db: Db, b: KnowledgeBuild): void {
  db.metaSet("knowledge_build_id", b.buildId);
  db.metaSet("knowledge_batches_total", String(b.total));
  db.metaSet("knowledge_batches_done", String(b.done));
  db.metaSet("knowledge_batches_failed", String(b.failed));
  db.metaSet("knowledge_build_documents", JSON.stringify(b.documents));
  db.metaSet("knowledge_build_failures", JSON.stringify(b.failures));
}

export function beginKnowledgeBuild(db: Db, total: number): KnowledgeBuild {
  const b: KnowledgeBuild = { buildId: db.id(), total, done: 0, failed: 0, documents: [], failures: [] };
  writeBuild(db, b);
  return b;
}

/** One batch landed. Stale batches (from a superseded build) are ignored and reported as such. */
export function knowledgeBatchDone(db: Db, buildId: string, documents: string[], failure: string | null): { current: boolean; allDone: boolean; build: KnowledgeBuild | null } {
  const b = readBuild(db);
  if (!b || b.buildId !== buildId) return { current: false, allDone: false, build: b };
  const counter = advance({ total: b.total, done: b.done, failed: b.failed }, failure === null);
  const next: KnowledgeBuild = {
    ...b, done: counter.done, failed: counter.failed,
    documents: [...new Set([...b.documents, ...documents])],
    failures: failure ? [...b.failures, failure].slice(-5) : b.failures,
  };
  writeBuild(db, next);
  return { current: true, allDone: allDone(counter), build: next };
}

export function currentBuild(db: Db): KnowledgeBuild | null { return readBuild(db); }

export function endKnowledgeBuild(db: Db): void {
  for (const k of ["knowledge_build_id", "knowledge_batches_total", "knowledge_batches_done", "knowledge_batches_failed", "knowledge_build_documents", "knowledge_build_failures"]) db.metaDelete(k);
}

export function knowledgeProgress(db: Db): { total: number; done: number } | null {
  const b = readBuild(db);
  return b ? { total: b.total, done: b.done } : null;
}

// ---- the drafting lane -------------------------------------------------------------------------

export function activeLane(db: Db): string | null { return db.metaGet("drafting_lane_id"); }

export function startLane(db: Db, keys: string[]): string {
  const laneId = db.id();
  const ts = db.now();
  db.metaSet("drafting_lane_id", laneId);
  db.metaSet("drafting_lane_started_at", ts);
  for (const key of keys) db.sql("INSERT INTO drafting_jobs(lane_id, key, status, attempts, updated_at) VALUES(?, ?, 'queued', 0, ?)", laneId, key, ts);
  return laneId;
}

function counterOf(db: Db, laneId: string): LaneCounter {
  const rows = db.sql<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM drafting_jobs WHERE lane_id = ? GROUP BY status", laneId);
  const by = new Map(rows.map(r => [r.status, r.n]));
  const total = rows.reduce((n, r) => n + r.n, 0);
  return { total, done: (by.get("done") ?? 0) + (by.get("failed") ?? 0), failed: by.get("failed") ?? 0 };
}

export function laneProgress(db: Db): DraftingLane | null {
  const laneId = activeLane(db);
  if (!laneId) return null;
  const c = counterOf(db, laneId);
  return {
    id: laneId, total: c.total, drafted: c.done - c.failed, failed: c.failed, inFlight: c.total - c.done,
    startedAt: db.metaGet("drafting_lane_started_at") ?? db.now(),
  };
}

/** Claim a job. Null when the lane was superseded or the job already finished. */
export function jobStart(db: Db, laneId: string, key: string): { attempts: number } | null {
  if (activeLane(db) !== laneId) return null;
  const row = db.sql<{ status: string; attempts: number }>("SELECT status, attempts FROM drafting_jobs WHERE lane_id = ? AND key = ?", laneId, key)[0];
  if (!row || row.status === "done" || row.status === "failed") return null;
  const attempts = row.attempts + 1;
  db.sql("UPDATE drafting_jobs SET status = 'drafting', attempts = ?, updated_at = ? WHERE lane_id = ? AND key = ?", attempts, db.now(), laneId, key);
  return { attempts };
}

export function jobPhase(db: Db, laneId: string, key: string, phase: "verifying" | "reviewing"): void {
  db.sql("UPDATE drafting_jobs SET status = ?, updated_at = ? WHERE lane_id = ? AND key = ? AND status NOT IN ('done','failed')", phase, db.now(), laneId, key);
}

export function jobDone(db: Db, laneId: string, key: string, ok: boolean, note: string | null): { counter: LaneCounter; allDone: boolean; current: boolean } {
  const current = activeLane(db) === laneId;
  db.sql("UPDATE drafting_jobs SET status = ?, note = ?, updated_at = ? WHERE lane_id = ? AND key = ?", ok ? "done" : "failed", note, db.now(), laneId, key);
  const counter = counterOf(db, laneId);
  return { counter, allDone: allDone(counter), current };
}

export function laneCounter(db: Db, laneId: string): LaneCounter { return counterOf(db, laneId); }

export function laneNotes(db: Db, laneId: string): { key: string; note: string }[] {
  return db.sql<{ key: string; note: string }>("SELECT key, note FROM drafting_jobs WHERE lane_id = ? AND status = 'failed' AND note IS NOT NULL", laneId);
}

export function finishLane(db: Db, laneId: string): void {
  if (activeLane(db) === laneId) { db.metaDelete("drafting_lane_id"); db.metaDelete("drafting_lane_started_at"); }
}
