// Case intelligence, the deterministic half: dates, chronology, candidate pairs, blast radius,
// paths, grounding, inventory, exhibit order, and the parsers for the model's answers. Pure
// functions; no workerd.

import { describe, expect, it } from "vitest";
import type { CaseClaim, CaseEntity } from "@gadgets/workshop-shared/legal";
import {
  blastRadiusOf, buildChronology, conflictCandidates, contradictionCandidates, duplicateCandidates, exhibitOrderOf, groundingOf,
  inventoryOf, namesLookAlike, parseContradictions, parseFindings, parseGapItems, parseReviewVerdicts, parseTitles, parseWhen, pathBetween,
} from "../src/intelligence.js";
import type { Fact } from "../src/types.js";

const fact = (id: string, statement: string, extra: Partial<Fact> = {}): Fact => ({
  id, documentId: extra.documentId ?? "d1", documentTitle: extra.documentTitle ?? "Doc 1", page: extra.page ?? 1, statement,
  quote: extra.quote ?? statement, occurredOn: extra.occurredOn ?? null, dateAmbiguous: extra.dateAmbiguous ?? false,
  significance: extra.significance ?? null, confidence: extra.confidence ?? 0.9, verifiedBy: extra.verifiedBy ?? null,
});
const claim = (id: string, statement: string, criteria: string[], entityIds: string[], factIds: string[], removed = false): CaseClaim =>
  ({ id, statement, criteria, entityIds, factIds, removed, editedBy: null });
const entity = (id: string, name: string, kind: CaseEntity["kind"] = "organization", salience = 1, locked = false): CaseEntity =>
  ({ id, name, kind, salience, description: "", claimCount: 1, locked });

describe("dates", () => {
  it("parses the ways documents state a date", () => {
    expect(parseWhen("14 January 2019")).toEqual({ year: 2019, month: 1, day: 14, ambiguous: false });
    expect(parseWhen("March 2021")).toEqual({ year: 2021, month: 3, day: null, ambiguous: false });
    expect(parseWhen("2021-03-05")).toEqual({ year: 2021, month: 3, day: 5, ambiguous: false });
    expect(parseWhen("2019")).toEqual({ year: 2019, month: null, day: null, ambiguous: false });
    expect(parseWhen("FY2023").ambiguous).toBe(true);
    expect(parseWhen("Spring 2020")).toMatchObject({ year: 2020, month: 4, ambiguous: true });
    expect(parseWhen("2019-2021")).toMatchObject({ year: 2019, ambiguous: true });
    expect(parseWhen("since 2020").ambiguous).toBe(true);
    expect(parseWhen("recently").year).toBeNull();
    expect(parseWhen(null).year).toBeNull();
  });

  it("orders the chronology by year and within it, counting the undated", () => {
    const c = buildChronology([
      fact("f1", "Elevated to IEEE Fellow", { occurredOn: "14 January 2019" }),
      fact("f2", "Best paper award", { occurredOn: "2019", dateAmbiguous: true }),
      fact("f3", "PhD awarded", { occurredOn: "2014" }),
      fact("f4", "Reviewer for Nature", { occurredOn: null }),
    ], "t");
    expect(c.years.map(y => y.year)).toEqual([2014, 2019]);
    expect(c.years[1].entries.map(e => e.factId)).toEqual(["f2", "f1"]);
    expect(c.years[1].entries[0].ambiguous).toBe(true);
    expect(c.dated).toBe(3);
    expect(c.undated).toBe(1);
  });
});

describe("candidate pairs", () => {
  it("pairs facts about one entity that carry different years or numbers, never compatible ones", () => {
    const facts = [
      fact("a", "Dr. Rao was elevated to IEEE Fellow in 2019", { occurredOn: "2019" }),
      fact("b", "Dr. Rao was elevated to IEEE Fellow in 2018", { occurredOn: "2018", documentId: "d2" }),
      fact("c", "The paper has been cited 412 times"),
      fact("d", "The paper has been cited 287 times", { documentId: "d2" }),
      fact("e", "Dr. Rao holds a PhD from Stanford", { occurredOn: "2014" }),
    ];
    const ents = new Map([["a", ["Dr. Anand Rao"]], ["b", ["Dr. Anand Rao"]], ["c", ["Science Robotics paper"]], ["d", ["Science Robotics paper"]], ["e", ["Dr. Anand Rao"]]]);
    const pairs = contradictionCandidates(facts, ents);
    expect(pairs.map(p => `${p.a.id}${p.b.id}:${p.why}`)).toEqual(["ab:date", "cd:number"]);
  });

  it("knows which names are one entity", () => {
    expect(namesLookAlike("IEEE", "Institute of Electrical and Electronics Engineers")).toBe(true);
    expect(namesLookAlike("Dr. Anand Rao", "A. Rao")).toBe(false);
    expect(namesLookAlike("Anand Rao", "Rao")).toBe(false);
    expect(namesLookAlike("Stanford University", "Stanford University, Department of EE")).toBe(true);
    expect(namesLookAlike("International Conference on Robotics and Automation", "ICRA")).toBe(true);
    expect(namesLookAlike("Anand Rao", "Anand K. Rao")).toBe(true);
  });

  it("proposes duplicate pairs of one kind, keeping the locked or weightier entity", () => {
    const pairs = duplicateCandidates([entity("1", "Stanford University", "organization", 3), entity("2", "Stanford University EE", "organization", 1), entity("3", "Stanford", "person")]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.id).toBe("1");
    expect(pairs[0].b.id).toBe("2");
    const locked = duplicateCandidates([entity("1", "Stanford University", "organization", 3), entity("2", "Stanford University EE", "organization", 1, true)]);
    expect(locked[0].a.id).toBe("2");
  });

  it("finds claims that clash on a date or a number in one section", () => {
    const pairs = conflictCandidates([
      claim("c1", "Rao received the Early Career Award in 2021", ["awards"], ["e1"], ["f1"]),
      claim("c2", "Rao received the Early Career Award in 2020", ["awards"], ["e1"], ["f2"]),
      claim("c3", "Rao reviewed 42 manuscripts", ["judging"], ["e1"], ["f3"]),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].reason).toMatch(/date/);
  });
});

describe("blast radius and paths", () => {
  const claims = [
    claim("c1", "Rao is an IEEE Fellow", ["awards"], ["rao", "ieee"], ["f1"]),
    claim("c2", "Rao published in Science Robotics", ["scholarly"], ["rao", "sr"], ["f2", "f3"]),
    claim("c3", "Science Robotics is a leading journal", [], ["sr"], ["f3"]),
  ];
  const facts = [{ id: "f1", documentId: "d1" }, { id: "f2", documentId: "d1" }, { id: "f3", documentId: "d2" }];

  it("traces what a document touches, marking claims it alone grounds", () => {
    const b = blastRadiusOf({ id: "d1", title: "Letter" }, facts, claims, new Set(["d1", "d2"]), [{ key: "awards", title: "Awards" }, { key: "scholarly", title: "Scholarly" }],
      [{ key: "awards", title: "Awards", status: "drafted" }]);
    expect(b.facts).toBe(2);
    expect(b.claims.map(c => `${c.id}:${c.onlyHere}`)).toEqual(["c1:true", "c2:false"]);
    expect(b.sections.map(s => s.key)).toEqual(["awards", "scholarly"]);
    expect(b.petitionSections).toHaveLength(1);
  });

  it("finds the shortest chain of claims between two entities", () => {
    const ents = [entity("rao", "Rao", "person"), entity("ieee", "IEEE"), entity("sr", "Science Robotics", "publication")];
    const p = pathBetween(ents, claims, "ieee", "sr");
    expect(p.found).toBe(true);
    expect(p.hops.map(h => h.entityId)).toEqual(["ieee", "rao", "sr"]);
    expect(pathBetween(ents, claims, "ieee", "nobody").found).toBe(false);
  });
});

describe("grounding, inventory, exhibit order", () => {
  it("scores grounding by confident facts and attorney verification", () => {
    const g = groundingOf([claim("c1", "x", [], [], ["f1"]), claim("c2", "y", [], [], ["f2"]), claim("c3", "z", [], [], ["f3"], true)],
      [{ id: "f1", confidence: 0.9, verifiedBy: "attorney" }, { id: "f2", confidence: 0.4, verifiedBy: null }, { id: "f3", confidence: 0.9, verifiedBy: null }]);
    expect(g).toEqual({ score: 0.5, claims: 2, grounded: 1, verified: 1 });
  });

  it("groups the record by kind with the unfiled last", () => {
    const inv = inventoryOf([{ id: "1", docType: "award_letter", status: "ready" }, { id: "2", docType: null, status: "queued" }, { id: "3", docType: "cv", status: "ready" }, { id: "4", docType: "cv", status: "superseded" }]);
    expect(inv.kinds.map(k => k.label)).toEqual(["Award Letter", "CV", "Not yet filed under a kind"]);
    expect(inv.documents).toBe(3);
    expect(inv.unread).toBe(1);
  });

  it("orders exhibits by the first section they argue in, then by weight, ungrounded last", () => {
    const order = exhibitOrderOf(
      [{ id: "d1", title: "CV", uploadedAt: "2026-01-01", live: true }, { id: "d2", title: "Award letter", uploadedAt: "2026-01-02", live: true },
       { id: "d3", title: "Photo", uploadedAt: "2026-01-03", live: true }, { id: "d4", title: "Old copy", uploadedAt: "2026-01-04", live: false }],
      [{ id: "f1", documentId: "d1" }, { id: "f2", documentId: "d2" }],
      [claim("c1", "x", ["scholarly"], [], ["f1"]), claim("c2", "y", ["awards"], [], ["f2"])],
      ["awards", "scholarly"]);
    expect(order.map(o => `${o.exhibitNo}:${o.documentId}:${o.firstSection}`)).toEqual(["1:d2:awards", "2:d1:scholarly", "3:d3:null"]);
  });
});

describe("what the model answers", () => {
  const cands = contradictionCandidates(
    [fact("a", "Elevated in 2019", { occurredOn: "2019" }), fact("b", "Elevated in 2018", { occurredOn: "2018", documentId: "d2", documentTitle: "Doc 2" })],
    new Map([["a", ["Rao"]], ["b", ["Rao"]]]));

  it("keeps only the pairs the model calls real, with its recommendation", () => {
    const out = parseContradictions(`{"contradictions":[{"index":0,"real":true,"kind":"date","subject":"the elevation year","severity":"high","explanation":"Two years.","recommendation":"Rely on the letter"},{"index":5,"real":true}]}`, cands, "t", () => "id1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "date", severity: "high", recommendation: "Rely on the letter", a: { factId: "a" }, b: { factId: "b" }, status: "open" });
    expect(parseContradictions(`{"contradictions":[{"index":0,"real":false}]}`, cands, "t", () => "x")).toHaveLength(0);
    expect(() => parseContradictions("nothing", cands, "t", () => "x")).toThrow(/no JSON/);
  });

  it("reads review verdicts by index and ignores the rest", () => {
    const v = parseReviewVerdicts(`{"verdicts":[{"index":0,"verdict":"merge","reason":"same"},{"index":1,"verdict":"set_aside"},{"index":9,"verdict":"keep"}]}`, 2, ["merge", "keep"]);
    expect([...v.keys()]).toEqual([0]);
    expect(v.get(0)).toEqual({ verdict: "merge", reason: "same" });
  });

  it("fills a finding for every section and drops claims not on file", () => {
    const f = parseFindings(`{"findings":[{"key":"awards","verdict":"strong","strongest":[{"claimId":"c1","statement":"x"},{"claimId":"ghost","statement":"y"}],"seize":["thin dates"],"note":"ok"}]}`,
      [{ key: "awards", title: "Awards" }, { key: "judging", title: "Judging" }], new Set(["c1"]));
    expect(f.map(x => `${x.key}:${x.verdict}`)).toEqual(["awards:strong", "judging:absent"]);
    expect(f[0].strongest).toEqual([{ claimId: "c1", statement: "x" }]);
    expect(f[1].note).toMatch(/did not reach/);
  });

  it("keeps gap items on known sections, ordered by priority, and titles that change something", () => {
    const g = parseGapItems(`{"gaps":[{"key":"judging","priority":3,"missing":"m","ask":"a"},{"key":"awards","priority":1,"missing":"n"},{"key":"nope","priority":1,"missing":"z"}]}`,
      [{ key: "awards", title: "Awards" }, { key: "judging", title: "Judging" }], () => "g");
    expect(g.map(x => `${x.key}:${x.priority}`)).toEqual(["awards:1", "judging:3"]);
    expect(g[0].ask).toBe("n");
    const t = parseTitles(`{"titles":[{"documentId":"d1","title":"2019 letter"},{"documentId":"d2","title":"Same"},{"documentId":"zz","title":"x"}]}`, [{ id: "d1", current: null }, { id: "d2", current: "Same" }]);
    expect(t).toEqual([{ documentId: "d1", current: null, proposed: "2019 letter" }]);
  });
});
