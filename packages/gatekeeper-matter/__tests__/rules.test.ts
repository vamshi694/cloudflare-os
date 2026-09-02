// The deterministic rules that fail loudly if the matter's logic breaks: readiness tiers and the
// gate, phase derivation, deadline urgency, the quote verifier, exhibit numbering, the knowledge
// reader's parser, and the portal's client-facing wording. Pure functions; no workerd.

import { describe, expect, it } from "vitest";
import { caseTypeSpec, normalizeCaseType } from "../src/case-types.js";
import {
  citedExhibitNumbers, computeReadiness, daysBetween, deadlineUrgency, derivePhase, firstNameOf, nextExhibitNumbers,
  portalDocumentState, quotedSpans, sectionEvidence, verifyQuotes,
} from "../src/rules.js";
import { parseClaims } from "../src/knowledge.js";

const claim = (criteria: string[], docs: string[], conf = 0.9, removed = false) =>
  ({ criteria, documentIds: docs, maxConfidence: conf, removed });

describe("readiness", () => {
  it("tiers a section: none, thin, sufficient", () => {
    expect(sectionEvidence([]).evidence).toBe("none");
    expect(sectionEvidence([claim(["awards"], ["d1"]), claim(["awards"], ["d1"])]).evidence).toBe("thin");
    expect(sectionEvidence([claim(["awards"], ["d1"], 0.4), claim(["awards"], ["d2"], 0.5)]).evidence).toBe("thin");
    expect(sectionEvidence([claim(["awards"], ["d1"]), claim(["awards"], ["d2"])]).evidence).toBe("sufficient");
    expect(sectionEvidence([claim(["awards"], ["d1"]), claim(["awards"], ["d2"], 0.9, true)]).evidence).toBe("thin");
  });

  it("gates the EB-1A record: build, build with gaps, gather, undecided", () => {
    const spec = caseTypeSpec("EB-1A")!;
    const two = (k: string) => [claim([k], ["a"]), claim([k], ["b"])];
    const build = computeReadiness(spec, [...two("awards"), ...two("membership"), ...two("judging")], "t");
    expect(build.gate).toBe("build");
    expect(build.sufficient).toBe(3);
    const gaps = computeReadiness(spec, [...two("awards"), claim(["membership"], ["a"])], "t");
    expect(gaps.gate).toBe("build_with_gaps");
    expect(gaps.stillNeeded.length).toBeGreaterThan(0);
    expect(computeReadiness(spec, [claim(["awards"], ["a"])], "t").gate).toBe("gather");
    expect(computeReadiness(null, [], "t").gate).toBe("undecided");
  });

  it("normalizes case type spellings", () => {
    expect(normalizeCaseType("eb-1a")).toBe("EB1A");
    expect(normalizeCaseType("EB2 NIW")).toBe("EB2-NIW");
    expect(normalizeCaseType("o-1a")).toBe("O1A");
  });
});

describe("derivePhase", () => {
  const base = { paused: false, documents: 3, reading: 0, ready: 3, failed: 0, building: false, planProposed: false, planApproved: false, writing: false, drafted: 0, pendingInstructions: 0 };
  it("follows the ladder", () => {
    expect(derivePhase({ ...base, paused: true, reading: 2 })).toBe("paused");
    expect(derivePhase({ ...base, reading: 1 })).toBe("reading");
    expect(derivePhase({ ...base, ready: 0, failed: 2 })).toBe("not_understood");
    expect(derivePhase({ ...base, building: true })).toBe("knowledge");
    expect(derivePhase(base)).toBe("analysis");
    expect(derivePhase({ ...base, planProposed: true })).toBe("clearance");
    expect(derivePhase({ ...base, planProposed: true, planApproved: true, writing: true })).toBe("building");
    expect(derivePhase({ ...base, planProposed: true, planApproved: true, drafted: 4 })).toBe("review");
    expect(derivePhase({ ...base, planProposed: true, planApproved: true, drafted: 4, pendingInstructions: 1 })).toBe("idle");
    expect(derivePhase({ ...base, documents: 0 })).toBe("idle");
  });
});

describe("deadlines", () => {
  it("counts days and tones", () => {
    expect(daysBetween("2026-09-02", "2026-09-05")).toBe(3);
    expect(deadlineUrgency(-1, false)).toBe("overdue");
    expect(deadlineUrgency(10, false)).toBe("in_window");
    expect(deadlineUrgency(40, false)).toBe("later");
    expect(deadlineUrgency(-5, true)).toBe("later");
  });
});

describe("quote verifier", () => {
  const body = 'The IEEE wrote that he was "elevated to the grade of IEEE Fellow" (Exhibit 2). He also claims "won the Nobel Prize in Physics" (Exhibit 3).';
  it("finds quoted spans and their exhibits", () => {
    expect(quotedSpans(body)).toEqual(["elevated to the grade of IEEE Fellow", "won the Nobel Prize in Physics"]);
    expect(citedExhibitNumbers(body)).toEqual([2, 3]);
  });
  it("passes quotes found in a cited fact, flags absent, wrong exhibit and unverifiable", () => {
    const facts = ["…pleased to inform you that you have been elevated to the grade of IEEE Fellow…"];
    const texts = new Map<number, string | undefined>([[2, "letter text elevated to the grade of ieee fellow"], [3, "nothing about a prize"]]);
    const out = verifyQuotes(body, facts, texts, [2, 3]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ quote: "won the Nobel Prize in Physics", exhibitNo: 3, reason: "absent" });
    const wrong = verifyQuotes(body, [], new Map([[2, "x"], [3, "he was elevated to the grade of IEEE Fellow"]]), [2, 3]);
    expect(wrong.find(q => q.exhibitNo === 2)?.reason).toBe("wrong_exhibit");
    const missing = verifyQuotes(body, [], new Map([[2, undefined], [3, undefined]]), [2, 3]);
    expect(missing.every(q => q.reason === "unverifiable")).toBe(true);
  });
});

describe("exhibits", () => {
  it("numbers new documents after the existing ones, in citation order", () => {
    const next = nextExhibitNumbers(new Map([["a", 1], ["b", 2]]), ["c", "a", "d"]);
    expect(next.get("c")).toBe(3);
    expect(next.get("d")).toBe(4);
    expect(next.get("a")).toBe(1);
  });
});

describe("knowledge parser", () => {
  const batch = [
    { id: "f1", documentId: "d", documentTitle: "t", page: 1, statement: "s", quote: "q", occurredOn: null, dateAmbiguous: false, significance: null, confidence: 0.9, verifiedBy: null },
    { id: "f2", documentId: "d", documentTitle: "t", page: 1, statement: "s2", quote: "q2", occurredOn: null, dateAmbiguous: false, significance: null, confidence: 0.9, verifiedBy: null },
  ];
  it("keeps claims with valid fact indexes and allowed criteria only", () => {
    const raw = JSON.stringify({ claims: [
      { statement: "Rao is an IEEE Fellow.", criteria: ["membership", "bogus"], entities: [{ name: "Dr. Anand Rao", kind: "person" }, { name: "IEEE", kind: "organization" }], fact_indexes: [0, 7] },
      { statement: "No facts.", criteria: [], entities: [], fact_indexes: [] },
    ] });
    const out = parseClaims(raw, batch, new Set(["membership"]));
    expect(out).toHaveLength(1);
    expect(out[0].criteria).toEqual(["membership"]);
    expect(out[0].factIds).toEqual(["f1"]);
    expect(out[0].entities[1].kind).toBe("organization");
  });
  it("rejects a non-JSON reply", () => {
    expect(() => parseClaims("no", batch, new Set())).toThrow();
  });
});

describe("the portal's words", () => {
  it("never shows the firm's statuses to the client", () => {
    expect(portalDocumentState("queued").state).toBe("reading");
    expect(portalDocumentState("failed")).toMatchObject({ state: "trouble" });
    expect(portalDocumentState("ready")).toEqual({ state: "read", label: null });
  });
  it("greets by first name without the honorific", () => {
    expect(firstNameOf("Dr. Anaya Raghunathan")).toBe("Anaya");
    expect(firstNameOf("Anand Rao")).toBe("Anand");
  });
});
