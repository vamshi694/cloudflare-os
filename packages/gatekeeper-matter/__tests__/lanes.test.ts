// The lanes' pure logic: the fan-out plan, the counter, which sections draft or hold, and the
// status row's narration. Fails if a build could skip facts, a counter could overrun, a thin
// section could draft under the wrong gate, or the row could narrate machinery.

import { describe, expect, it } from "vitest";
import type { CaseTypeSpec } from "@gadgets/workshop-shared/legal";
import { advance, allDone, chunk, clearedSections, draftingSummary, narrateLane, planBatches } from "../src/lanes.js";

const sections: CaseTypeSpec["sections"] = [
  { key: "introduction", title: "Introduction", criterion: "", purpose: "", evidentiary: false },
  { key: "awards", title: "Awards", criterion: "", purpose: "", evidentiary: true },
  { key: "membership", title: "Membership", criterion: "", purpose: "", evidentiary: true },
  { key: "judging", title: "Judging", criterion: "", purpose: "", evidentiary: true },
  { key: "conclusion", title: "Conclusion", criterion: "", purpose: "", evidentiary: false },
];

function readiness(gate: "build" | "build_with_gaps" | "gather" | "undecided") {
  return {
    gate,
    sections: [
      { key: "awards", title: "Awards", evidence: "sufficient" as const, supportingClaims: 3, supportingDocuments: 2, stillNeeded: [] },
      { key: "membership", title: "Membership", evidence: "thin" as const, supportingClaims: 1, supportingDocuments: 1, stillNeeded: ["Proof of the admission bar"] },
      { key: "judging", title: "Judging", evidence: "none" as const, supportingClaims: 0, supportingDocuments: 0, stillNeeded: [] },
    ],
  };
}

describe("planBatches", () => {
  it("covers every fact exactly once and needs no batch for an empty record", () => {
    expect(planBatches(0)).toEqual([]);
    expect(planBatches(40)).toEqual([0]);
    expect(planBatches(41)).toEqual([0, 40]);
    expect(planBatches(1000, 40)).toHaveLength(25);
  });
});

describe("the lane counter", () => {
  it("counts failures as done and never overruns the total", () => {
    let c = { total: 2, done: 0, failed: 0 };
    c = advance(c, true);
    expect(allDone(c)).toBe(false);
    c = advance(c, false);
    expect(c).toEqual({ total: 2, done: 2, failed: 1 });
    expect(allDone(c)).toBe(true);
    expect(advance(c, true).done).toBe(2);
  });
  it("chunks queue sends at the platform ceiling", () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map(c => c.length)).toEqual([100, 100, 50]);
  });
});

describe("clearedSections", () => {
  it("build drafts everything with evidence and holds the empty section", () => {
    const p = clearedSections(sections, readiness("build"));
    expect(p.draft).toEqual(["introduction", "awards", "membership", "conclusion"]);
    expect(p.hold).toEqual([{ key: "judging", reasons: ["The record does not yet support this section."] }]);
  });
  it("build_with_gaps drafts framing and sufficient sections only, holding thin ones with the client ask", () => {
    const p = clearedSections(sections, readiness("build_with_gaps"));
    expect(p.draft).toEqual(["introduction", "awards", "conclusion"]);
    expect(p.hold.map(h => h.key)).toEqual(["membership", "judging"]);
    expect(p.hold[0].reasons).toEqual(["Proof of the admission bar"]);
  });
  it("gather drafts nothing and holds every evidentiary section", () => {
    const p = clearedSections(sections, readiness("gather"));
    expect(p.draft).toEqual([]);
    expect(p.hold.map(h => h.key)).toEqual(["awards", "membership", "judging"]);
  });
  it("undecided does nothing at all", () => {
    expect(clearedSections(sections, readiness("undecided"))).toEqual({ draft: [], hold: [] });
  });
});

describe("narrateLane", () => {
  it("speaks in documents, knowledge and sections, never in jobs", () => {
    expect(narrateLane({ kind: "reading", done: 12, total: 40 })).toBe("Reading 12 of 40 documents");
    expect(narrateLane({ kind: "knowledge", done: 3, total: 8 })).toBe("Building case knowledge 3 of 8");
    expect(narrateLane({ kind: "drafting", done: 5, total: 15 })).toBe("Drafting 5 of 15 sections");
    expect(narrateLane({ kind: "drafting", done: 9, total: 1 })).toBe("Drafting 1 of 1 section");
    expect(narrateLane(null)).toBeNull();
    expect(narrateLane({ kind: "reading", done: 0, total: 0 })).toBeNull();
  });
});

describe("draftingSummary", () => {
  it("says what landed and what did not", () => {
    expect(draftingSummary({ total: 15, done: 15, failed: 0 }, 0)).toBe("Drafted 15 of 15 sections.");
    expect(draftingSummary({ total: 15, done: 15, failed: 2 }, 3))
      .toBe("Drafted 13 of 15 sections; 2 could not be drafted and wait for another pass; the cross-section review found 3 issues.");
  });
});
