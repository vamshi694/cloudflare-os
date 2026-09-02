// The lanes' pure logic: how a knowledge build fans out into batches, how a drafting lane decides
// which sections draft and which hold, how a counter advances, and how the status row narrates a
// lane. No storage, no models, no cloudflare imports; the tests exercise these directly.

import type { CaseTypeSpec, LaneProgress, Readiness } from "@gadgets/workshop-shared/legal";

/** Facts per knowledge batch. Forty facts fit one model call with room for the claims it emits. */
export const KNOWLEDGE_BATCH = 40;

/** Queue messages fan out in chunks of this many (the Queues sendBatch ceiling). */
export const QUEUE_SEND_CHUNK = 100;

/** The offsets of every batch a build needs; a record with no facts needs none. */
export function planBatches(factCount: number, batch = KNOWLEDGE_BATCH): number[] {
  if (factCount <= 0 || batch <= 0) return [];
  const out: number[] = [];
  for (let offset = 0; offset < factCount; offset += batch) out.push(offset);
  return out;
}

export type LaneCounter = { total: number; done: number; failed: number };

/** One job finished; the counter never exceeds its total, and a failure still counts as done. */
export function advance(counter: LaneCounter, ok: boolean): LaneCounter {
  const done = Math.min(counter.total, counter.done + 1);
  return { total: counter.total, done, failed: ok ? counter.failed : Math.min(done, counter.failed + 1) };
}

export function allDone(counter: LaneCounter): boolean {
  return counter.total === 0 || counter.done >= counter.total;
}

export function chunk<T>(items: T[], size = QUEUE_SEND_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The status row's lane line: pages, never machinery. "Reading 12 of 40 documents", "Building case
 * knowledge 3 of 8", "Drafting 5 of 15 sections". Null when nothing is in flight.
 */
export function narrateLane(lane: LaneProgress | null): string | null {
  if (!lane || lane.total <= 0) return null;
  const done = Math.min(lane.done, lane.total);
  if (lane.kind === "reading") return `Reading ${done} of ${lane.total} document${lane.total === 1 ? "" : "s"}`;
  if (lane.kind === "knowledge") return `Building case knowledge ${done} of ${lane.total}`;
  return `Drafting ${done} of ${lane.total} section${lane.total === 1 ? "" : "s"}`;
}

export type SectionPlan = { draft: string[]; hold: { key: string; reasons: string[] }[] };

const NOT_YET = "The record does not yet support this section.";

/**
 * Which sections the drafting lane writes and which it holds, from the sufficiency gate's verdict.
 * The gate is THE evidence judgment (one signal, one verdict):
 *   build            every section drafts; an evidentiary section with no evidence still holds.
 *   build_with_gaps  framing sections and sufficient sections draft; thin and empty ones hold.
 *   gather           nothing drafts; every evidentiary section holds with what the client should send.
 *   undecided        nothing drafts and nothing holds; the case type comes first.
 */
export function clearedSections(sections: CaseTypeSpec["sections"], readiness: Pick<Readiness, "gate" | "sections">): SectionPlan {
  const verdict = new Map(readiness.sections.map(s => [s.key, s]));
  const plan: SectionPlan = { draft: [], hold: [] };
  if (readiness.gate === "undecided") return plan;
  for (const s of sections) {
    if (!s.evidentiary) {
      if (readiness.gate !== "gather") plan.draft.push(s.key);
      continue;
    }
    const r = verdict.get(s.key);
    const evidence = r?.evidence ?? "none";
    const reasons = r?.stillNeeded.length ? r.stillNeeded : [NOT_YET];
    const drafts = readiness.gate === "build" ? evidence !== "none" : readiness.gate === "build_with_gaps" && evidence === "sufficient";
    if (drafts) plan.draft.push(s.key);
    else plan.hold.push({ key: s.key, reasons });
  }
  return plan;
}

/** The lane's closing line for the activity trail and the wake, honest about what did not land. */
export function draftingSummary(counter: LaneCounter, coherenceFindings: number): string {
  const drafted = counter.done - counter.failed;
  const base = `Drafted ${drafted} of ${counter.total} section${counter.total === 1 ? "" : "s"}`;
  const failed = counter.failed > 0 ? `; ${counter.failed} could not be drafted and ${counter.failed === 1 ? "waits" : "wait"} for another pass` : "";
  const coherence = coherenceFindings > 0 ? `; the cross-section review found ${coherenceFindings} issue${coherenceFindings === 1 ? "" : "s"}` : "";
  return `${base}${failed}${coherence}.`;
}
