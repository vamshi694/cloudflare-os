// The firm's process rules, pure: the hold a removed member's matters carry until reassignment,
// the order of the firm-wide inbox, and the ranking of a search across matters. No workerd here,
// so the tests exercise exactly what the workers run.

import type { InboxItem, SearchResult } from "@gadgets/workshop-shared/legal";

// ── Holds and reassignment ───────────────────────────────────────────────────────────────────────

/**
 * A matter's ownership state as the firm's registry sees it. `hold` is why the firm stopped work
 * on it: a removed owner. Nothing here deletes a matter; a hold is a visible pause.
 */
export type OwnershipState = {
  ownerUserId: string | null;
  hold: "removed_owner" | null;
};

export type OwnershipEvent =
  | { type: "remove_owner" }
  | { type: "reassign"; toUserId: string }
  | { type: "restore_owner" };

/**
 * The state machine for one matter's ownership. Removing an owner holds the matter (idempotent);
 * reassigning hands it to a member and lifts the hold; restoring an owner (an admin undoing a
 * removal before reassignment) lifts the hold only when the hold was a removal.
 */
export function ownershipTransition(state: OwnershipState, event: OwnershipEvent): OwnershipState {
  switch (event.type) {
    case "remove_owner":
      return { ownerUserId: state.ownerUserId, hold: "removed_owner" };
    case "reassign": {
      const to = event.toUserId.trim();
      if (!to) throw new Error("Reassignment needs a member to reassign to.");
      return { ownerUserId: to, hold: null };
    }
    case "restore_owner":
      return state.hold === "removed_owner" ? { ownerUserId: state.ownerUserId, hold: null } : state;
  }
}

/** The plain-English hold line a matter shows while it waits for reassignment. */
export function holdLine(state: OwnershipState): string | null {
  if (state.hold !== "removed_owner") return null;
  return state.ownerUserId
    ? `Paused: its attorney ${state.ownerUserId} was removed from the firm. Reassign it under The firm to resume the work.`
    : "Paused: its attorney was removed from the firm. Reassign it under The firm to resume the work.";
}

// ── The firm inbox ───────────────────────────────────────────────────────────────────────────────

const KIND_RANK: Record<InboxItem["kind"], number> = { plan: 0, outreach: 1, decision: 2, unreadable_document: 3 };

/**
 * The inbox reads by urgency of kind, then by age within a kind: the plan first (nothing drafts
 * until it is approved), then outreach waiting for release, then decisions, then documents the
 * firm could not read. Within a kind the oldest waits longest and comes first.
 */
export function orderInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const k = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (k !== 0) return k;
    if (a.raisedAt !== b.raisedAt) return a.raisedAt < b.raisedAt ? -1 : 1;
    return a.matterTitle.localeCompare(b.matterTitle);
  });
}

// ── Search across matters ────────────────────────────────────────────────────────────────────────

/** Tokens of three or more letters or digits, lowercased. */
export function searchTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3))];
}

/**
 * Rank a hit: every term found in the title counts double, every term in the body once, a phrase
 * match of the whole query counts as much again, and a document title outranks a fact of the
 * same score so the lawyer sees the file before the sentence from it.
 */
export function scoreHit(hit: Pick<SearchResult, "kind" | "title" | "snippet">, terms: string[], query: string): number {
  const title = hit.title.toLowerCase();
  const body = hit.snippet.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (title.includes(t)) score += 2;
    if (body.includes(t)) score += 1;
  }
  const phrase = query.trim().toLowerCase();
  if (phrase.length >= 3 && (title.includes(phrase) || body.includes(phrase))) score += terms.length;
  if (score > 0 && hit.kind === "document") score += 0.5;
  return score;
}

export function rankSearch(hits: SearchResult[], query: string, limit: number): SearchResult[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  return hits
    .map(h => ({ h, s: scoreHit(h, terms, query) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.h.matterTitle.localeCompare(b.h.matterTitle))
    .slice(0, limit)
    .map(x => ({ ...x.h, score: x.s }));
}

// ── Lane models ─────────────────────────────────────────────────────────────────────────────────

export type Lane = "reader" | "knowledge" | "drafting" | "critic";

/**
 * The model an admin chose for a lane (The firm → Platform), or null for the worker's default.
 * Never throws: a registry hiccup keeps the default. Lives here, not in firm-index.ts, so the
 * reading and knowledge lanes (and their tests) never import the Durable Object module.
 */
export async function laneModel(env: { FIRM_INDEX: { getByName(name: string): { laneModels(): Promise<Record<Lane, string | null>> } } }, lane: Lane): Promise<string | null> {
  try {
    return (await env.FIRM_INDEX.getByName("").laneModels())[lane];
  } catch {
    return null;
  }
}
