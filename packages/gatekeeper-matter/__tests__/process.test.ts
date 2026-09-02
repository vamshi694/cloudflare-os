// The firm's process rules: holds and reassignment, the inbox order, search ranking. Pure.

import { describe, expect, it } from "vitest";
import type { InboxItem, SearchResult } from "@gadgets/workshop-shared/legal";
import { holdLine, orderInbox, ownershipTransition, rankSearch, scoreHit, searchTerms } from "../src/process.js";

describe("ownership holds", () => {
  it("removing an owner holds the matter and keeps who owned it", () => {
    const s = ownershipTransition({ ownerUserId: "ana", hold: null }, { type: "remove_owner" });
    expect(s).toEqual({ ownerUserId: "ana", hold: "removed_owner" });
    expect(holdLine(s)).toContain("ana was removed from the firm");
  });
  it("removal is idempotent", () => {
    const once = ownershipTransition({ ownerUserId: "ana", hold: null }, { type: "remove_owner" });
    expect(ownershipTransition(once, { type: "remove_owner" })).toEqual(once);
  });
  it("reassignment lifts the hold and names the new owner", () => {
    const held = ownershipTransition({ ownerUserId: "ana", hold: null }, { type: "remove_owner" });
    expect(ownershipTransition(held, { type: "reassign", toUserId: "ben" })).toEqual({ ownerUserId: "ben", hold: null });
    expect(() => ownershipTransition(held, { type: "reassign", toUserId: " " })).toThrow();
  });
  it("restoring an owner lifts only a removal hold", () => {
    const held = ownershipTransition({ ownerUserId: "ana", hold: null }, { type: "remove_owner" });
    expect(ownershipTransition(held, { type: "restore_owner" })).toEqual({ ownerUserId: "ana", hold: null });
    expect(ownershipTransition({ ownerUserId: "ana", hold: null }, { type: "restore_owner" })).toEqual({ ownerUserId: "ana", hold: null });
    expect(holdLine({ ownerUserId: "ana", hold: null })).toBeNull();
  });
});

function item(kind: InboxItem["kind"], raisedAt: string, matterTitle = "M"): InboxItem {
  return { id: `${kind}-${raisedAt}-${matterTitle}`, kind, title: kind, detail: null, options: [], recommendation: null, raisedAt, matterId: "m", matterTitle, caseType: null };
}

describe("inbox order", () => {
  it("puts the plan first, then outreach, decisions, unreadable documents", () => {
    const ordered = orderInbox([
      item("unreadable_document", "2026-09-01T00:00:00Z"), item("decision", "2026-09-01T00:00:00Z"),
      item("outreach", "2026-09-01T00:00:00Z"), item("plan", "2026-09-02T00:00:00Z"),
    ]);
    expect(ordered.map(i => i.kind)).toEqual(["plan", "outreach", "decision", "unreadable_document"]);
  });
  it("within a kind, the oldest waits longest and comes first; ties break by matter", () => {
    const ordered = orderInbox([
      item("decision", "2026-09-02T00:00:00Z", "B"), item("decision", "2026-09-01T00:00:00Z", "Z"), item("decision", "2026-09-02T00:00:00Z", "A"),
    ]);
    expect(ordered.map(i => `${i.raisedAt.slice(8, 10)}${i.matterTitle}`)).toEqual(["01Z", "02A", "02B"]);
  });
});

function hit(kind: SearchResult["kind"], title: string, snippet: string, matterTitle = "M"): SearchResult {
  return { kind, matterId: "m", matterTitle, title, snippet, documentId: "d", page: null, score: 0 };
}

describe("search ranking", () => {
  it("tokenizes to terms of three characters or more, deduplicated", () => {
    expect(searchTerms("IEEE Fellow, the IEEE!")).toEqual(["ieee", "fellow", "the"]);
    expect(searchTerms("a b")).toEqual([]);
  });
  it("title matches outrank body matches, phrases add, documents edge facts at equal score", () => {
    const terms = searchTerms("ieee fellow");
    const titled = hit("fact", "Elevated to IEEE Fellow", "letter");
    const bodied = hit("fact", "letter", "elevated to ieee fellow in 2019");
    expect(scoreHit(titled, terms, "ieee fellow")).toBeGreaterThan(scoreHit(bodied, terms, "ieee fellow"));
    const doc = hit("document", "IEEE Fellow letter", "award letter");
    const fact = hit("fact", "IEEE Fellow letter", "award letter");
    expect(scoreHit(doc, terms, "ieee fellow")).toBeGreaterThan(scoreHit(fact, terms, "ieee fellow"));
  });
  it("drops hits that match nothing and honors the limit", () => {
    const ranked = rankSearch([hit("fact", "nothing here", "at all"), hit("fact", "IEEE Fellow", "quote"), hit("document", "IEEE Fellow letter", "pdf")], "ieee", 1);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].kind).toBe("document");
    expect(ranked[0].score).toBeGreaterThan(0);
    expect(rankSearch([hit("fact", "IEEE", "x")], "", 5)).toEqual([]);
  });
});
