import { describe, expect, it } from "vitest";
import {
  SPECIALIST_ROLES, composeBrief, delegationPath, specialistRunning, type SpecialistContext,
} from "../src/specialists.js";

const facts = [
  { id: "f1", exhibitNo: 3, documentTitle: "2021 IEEE RAS Early Career Award letter", page: 1,
    statement: "The society gave the 2021 Early Career Award to fewer than five researchers worldwide.",
    quote: "given to fewer than five researchers worldwide each year" },
  { id: "f2", exhibitNo: null, documentTitle: "Curriculum vitae", page: null,
    statement: "The beneficiary holds a doctorate from Stanford University.", quote: "Ph.D. in Electrical Engineering, Stanford University, 2014" },
];

function ctx(over: Partial<SpecialistContext> = {}): SpecialistContext {
  return {
    matterTitle: "Dr. Test Client EB-1A", clientName: "Dr. Test Client", caseType: "EB1A",
    petitionTitle: "I-140 Immigrant Petition for Alien of Extraordinary Ability (EB-1A)",
    scope: { kind: "section", key: "awards" },
    sections: [{
      key: "awards", title: "Nationally or internationally recognized prizes or awards",
      criterion: "8 CFR 204.5(h)(3)(i)", purpose: "Proves receipt of lesser nationally or internationally recognized prizes.",
      status: "drafted", draft: "Dr. Client received the 2021 Early Career Award.",
      weaknesses: [{ severity: "high", issue: "The selection rate is asserted, not shown.", fix: "Quote the award letter's own words on the number of recipients." }],
      unverifiedQuotes: ["one of four researchers"], guidance: "Cap at two pages.", evidence: "thin",
      stillNeeded: ["a second independent award"],
    }],
    facts, style: "Lead with the selectivity of the award, then its national reach.",
    rules: [{ rule: "Always name the awarding body in full on first mention.", why: "officers check the body" }],
    directives: ["Do not draft the awards section until the client sends the selection letter."],
    form: null, recommender: null, instruction: "Address the reviewer's note: show the selection rate from the letter.",
    ...over,
  };
}

describe("composeBrief", () => {
  it("gives the drafter the facts with exhibit numbers, the style, the rules, the directive, the draft and the landing calls", () => {
    const b = composeBrief("drafter", ctx());
    expect(b.title).toBe("Drafter · Nationally or internationally recognized prizes or awards");
    expect(b.prompt).toContain("[f1] Exhibit 3");
    expect(b.prompt).toContain("Verbatim: \"given to fewer than five researchers worldwide each year\"");
    expect(b.prompt).toContain("Lead with the selectivity of the award");
    expect(b.prompt).toContain("Always name the awarding body in full");
    expect(b.prompt).toContain("Do not draft the awards section");
    expect(b.prompt).toContain("Current draft (drafted)");
    expect(b.prompt).toContain("The reviewer's notes");
    expect(b.prompt).toContain("Quotes the verifier could not find");
    expect(b.prompt).toContain("await p.write(\"awards\", body, citedFactIds)");
    expect(b.prompt).toContain("delegations/drafter-awards.md");
    expect(b.prompt).toContain("Address the reviewer's note");
  });

  it("keeps the house register: no em dashes, en dashes, double hyphens or semicolons in the prose", () => {
    for (const role of SPECIALIST_ROLES) {
      const scope = role === "forms_filler" ? { kind: "form" as const, code: "I-140" }
        : role === "letter_writer" ? { kind: "recommender" as const, id: "r1" }
        : role === "drafter" ? { kind: "section" as const, key: "awards" }
        : { kind: "matter" as const };
      const b = composeBrief(role, ctx({
        scope, instruction: null,
        form: { code: "I-140", title: "Immigrant Petition for Alien Workers", fields: [{ name: "p1_family", label: "Family name", value: null }] },
        recommender: { id: "r1", name: "Wei Chen", title: "Professor", organization: "Stanford", relationship: "doctoral advisor", basis: "cited her work" },
      }));
      // The facts and drafts carry the record's own words and the numbered landing steps carry
      // code; the brief's own prose keeps the register.
      const offending = b.prompt.split("\n")
        .filter(l => !l.startsWith("- [") && !l.startsWith("Current draft") && !/^\d+\. /.test(l) && !l.includes("await "))
        .filter(l => /[—–]|--|;/.test(l));
      expect(offending).toEqual([]);
    }
  });

  it("names the officer's and gap analyst's jobs without a scope suffix and gives them every section", () => {
    const officer = composeBrief("officer", ctx({ scope: { kind: "matter" } }));
    expect(officer.title).toBe("Officer's review");
    expect(officer.prompt).toContain("The letter, section by section");
    expect(officer.prompt).toContain("await p.review(key, score, weaknesses)");
    const gap = composeBrief("gap_analyst", ctx({ scope: { kind: "matter" } }));
    expect(gap.title).toBe("Gap analyst");
    expect(gap.prompt).not.toContain("Current draft");
    expect(gap.prompt).toContain("readiness()");
  });

  it("gives the forms filler the fields and the letter writer the recommender", () => {
    const forms = composeBrief("forms_filler", ctx({
      scope: { kind: "form", code: "I-140" }, sections: [],
      form: { code: "I-140", title: "Immigrant Petition for Alien Workers", fields: [{ name: "p1_family", label: "Family name", value: null }] },
    }));
    expect(forms.prompt).toContain("p1_family: Family name");
    expect(forms.prompt).toContain("await f.fill(\"I-140\", values)");
    const letter = composeBrief("letter_writer", ctx({
      scope: { kind: "recommender", id: "r1" }, sections: [],
      recommender: { id: "r1", name: "Wei Chen", title: "Professor", organization: "Stanford", relationship: "doctoral advisor", basis: "cited her work" },
    }));
    expect(letter.title).toBe("Letter writer · Wei Chen");
    expect(letter.prompt).toContain("r.writeLetter(\"r1\", body, citedFactIds)");
  });
});

describe("specialistRunning", () => {
  const now = new Date("2026-09-02T12:00:00Z");
  it("is true while the specialist's desk file is fresh and false once it is old or absent", () => {
    const scope = { kind: "section" as const, key: "awards" };
    expect(delegationPath("drafter", scope)).toBe("delegations/drafter-awards.md");
    expect(specialistRunning([], "drafter", scope, now)).toBe(false);
    expect(specialistRunning([{ path: "delegations/drafter-awards.md", updatedAt: "2026-09-02T11:50:00Z" }], "drafter", scope, now)).toBe(true);
    expect(specialistRunning([{ path: "delegations/drafter-awards.md", updatedAt: "2026-09-02T10:00:00Z" }], "drafter", scope, now)).toBe(false);
    expect(specialistRunning([{ path: "delegations/drafter-awards.md", updatedAt: "2026-09-02T11:50:00Z" }], "officer", { kind: "matter" }, now)).toBe(false);
  });
});
