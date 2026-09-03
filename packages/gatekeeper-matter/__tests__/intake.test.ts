import { describe, expect, it } from "vitest";
import { INTAKE_BY_CASE, INTAKE_CORE, INTAKE_FORM_KEYS, feedsForms, intakeCompletion, intakeSchema, prefillFromIntake } from "../src/intake.js";
import { FORM_FIELDS } from "../src/case-types.js";
import { FIELD_MAP } from "../src/forms-pdf.js";

const allKeys = new Set([...INTAKE_CORE, ...Object.values(INTAKE_BY_CASE).flat()].flatMap(s => s.questions.map(q => q.key)));

describe("intake schema", () => {
  it("keys are unique across the core and every category", () => {
    const seen = new Map<string, number>();
    for (const s of [...INTAKE_CORE, ...Object.values(INTAKE_BY_CASE).flat()]) for (const q of s.questions) seen.set(q.key, (seen.get(q.key) ?? 0) + 1);
    // Category blocks may repeat a key across categories (awards, contributions) but never within the core plus one category.
    for (const [ct, blocks] of Object.entries(INTAKE_BY_CASE)) {
      const keys = [...INTAKE_CORE, ...blocks].flatMap(s => s.questions.map(q => q.key));
      expect(new Set(keys).size, ct).toBe(keys.length);
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it("every showWhen points at an existing key", () => {
    for (const s of intakeSchema("EB1A")) for (const q of s.questions) if (q.showWhen) expect(allKeys.has(q.showWhen.key), q.key).toBe(true);
  });

  it("every intake key that feeds a form exists in the schema, and every target field is in the form's catalog", () => {
    for (const [code, map] of Object.entries(INTAKE_FORM_KEYS)) {
      const catalog = new Set((FORM_FIELDS[code] ?? []).map(f => f.name));
      for (const [field, source] of Object.entries(map)) {
        expect(catalog.has(field), `${code}.${field} in FORM_FIELDS`).toBe(true);
        for (const k of Array.isArray(source) ? source : [source]) expect(allKeys.has(k), `${code}.${field} ← ${k}`).toBe(true);
      }
    }
  });

  it("every catalog field the intake feeds has a pattern to find it on the official PDF", () => {
    for (const [code, map] of Object.entries(INTAKE_FORM_KEYS)) {
      for (const field of Object.keys(map)) expect(FIELD_MAP[code]?.[field]?.length ?? 0, `${code}.${field}`).toBeGreaterThan(0);
    }
  });

  it("selects the category block by case type, with the usual spellings", () => {
    expect(intakeSchema("EB1A").some(s => s.key === "eb1a")).toBe(true);
    expect(intakeSchema("EB-1A").some(s => s.key === "eb1a")).toBe(true);
    expect(intakeSchema("EB2-NIW").some(s => s.key === "niw")).toBe(true);
    expect(intakeSchema(null).length).toBe(INTAKE_CORE.length);
  });
});

describe("completion", () => {
  it("counts only required questions that apply, and names the sections still open", () => {
    const schema = intakeSchema("EB1A");
    const empty = intakeCompletion(schema, {});
    expect(empty.done).toBe(0);
    expect(empty.complete).toBe(false);
    expect(empty.sectionsLeft).toContain("Your name");
    const answers: Record<string, string> = {};
    for (const s of schema) for (const q of s.questions) if (q.required && !q.showWhen) answers[q.key] = "x";
    answers.in_us = "no";
    answers.ever_denied = "no"; answers.ever_removal = "no"; answers.ever_arrested = "no"; answers.marital_status = "Single";
    const full = intakeCompletion(schema, answers);
    expect(full.complete).toBe(true);
    expect(full.sectionsLeft).toEqual([]);
    // A conditional required question opens its section only when it applies.
    const c = intakeCompletion(schema, { ...answers, in_us: "yes" });
    expect(c.complete).toBe(true); // status questions are optional even when shown
  });
});

describe("prefill from intake", () => {
  it("composes names and addresses and skips empty targets", () => {
    const answers = { given_name: "Anaya", middle_name: "", family_name: "Raghunathan", address_street: "1 Main St", address_unit: "Apt 4", address_city: "Palo Alto", address_state: "CA", address_zip: "94301", address_country: "United States", date_of_birth: "1988-02-01" };
    const i140 = Object.fromEntries(prefillFromIntake("I-140", answers).map(v => [v.name, v.value]));
    expect(i140.beneficiary_given_name).toBe("Anaya");
    expect(i140.beneficiary_family_name).toBe("Raghunathan");
    expect(i140.beneficiary_middle_name).toBeUndefined();
    expect(i140.address_street).toBe("1 Main St Apt 4");
    expect(i140.beneficiary_dob).toBe("1988-02-01");
    const g28 = Object.fromEntries(prefillFromIntake("G-28", answers).map(v => [v.name, v.value]));
    expect(g28.client_name).toBe("Anaya Raghunathan");
    expect(g28.client_address).toBe("1 Main St, Apt 4, Palo Alto, CA, 94301, United States");
    expect(prefillFromIntake("I-907", {})).toEqual([]);
  });

  it("says which forms an answer feeds", () => {
    expect(feedsForms("family_name")).toEqual(expect.arrayContaining(["I-140", "G-28", "I-907", "I-129"]));
    expect(feedsForms("awards")).toEqual([]);
  });
});
