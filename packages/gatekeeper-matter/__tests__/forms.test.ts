// Government forms: the pure parts that decide what lands on the official PDF and how a form
// moves from the firm's fill to the client's signature. No workerd, no pdf-lib I/O.

import { describe, expect, it } from "vitest";
import { mapFieldNames, nextStatus, prefillValues, type DiscoveredField } from "../src/forms-pdf.js";

const uscisLike = (names: string[], type: DiscoveredField["type"] = "text"): DiscoveredField[] =>
  names.map(n => ({ name: n, type }));

describe("mapFieldNames", () => {
  it("matches the firm's fields to USCIS AcroForm names by the tail of the name, first pattern first", () => {
    const discovered = uscisLike([
      "form1[0].#subform[0].Pt1Line1a_FamilyName[0]",
      "form1[0].#subform[2].Pt3Line1a_FamilyName[0]",
      "form1[0].#subform[2].Pt3Line1b_GivenName[0]",
      "form1[0].#subform[2].Pt3Line6_DateOfBirth[0]",
      "form1[0].#subform[5].SomethingElse[0]",
    ]);
    const { mapped, unmapped } = mapFieldNames("I-140", ["petitioner_name", "beneficiary_family_name", "beneficiary_given_name", "beneficiary_dob", "occupation"], discovered);
    expect(mapped.petitioner_name).toBe("form1[0].#subform[0].Pt1Line1a_FamilyName[0]");
    expect(mapped.beneficiary_family_name).toBe("form1[0].#subform[2].Pt3Line1a_FamilyName[0]");
    expect(mapped.beneficiary_given_name).toBe("form1[0].#subform[2].Pt3Line1b_GivenName[0]");
    expect(mapped.beneficiary_dob).toBe("form1[0].#subform[2].Pt3Line6_DateOfBirth[0]");
    expect(mapped.occupation).toBeNull();
    expect(unmapped).toEqual(["form1[0].#subform[5].SomethingElse[0]"]);
  });

  it("never gives two of the firm's fields the same official field, and skips non-text fields", () => {
    const discovered = [...uscisLike(["Pt1Line1a_FamilyName[0]"]), ...uscisLike(["Pt3Line1a_FamilyName[0]"], "checkbox")];
    const { mapped } = mapFieldNames("I-140", ["petitioner_name", "beneficiary_family_name"], discovered);
    expect(mapped.petitioner_name).toBe("Pt1Line1a_FamilyName[0]");
    expect(mapped.beneficiary_family_name).toBeNull();
  });

  it("returns every catalog field as null for a form with no mapping", () => {
    const { mapped, unmapped } = mapFieldNames("ETA-9089", ["employer_name"], uscisLike(["A[0]"]));
    expect(mapped).toEqual({ employer_name: null });
    expect(unmapped).toEqual(["A[0]"]);
  });
});

describe("prefillValues", () => {
  it("splits the client's name without the honorific and names the classification", () => {
    const v = prefillValues("I-140", { clientName: "Dr. Anand Rao", caseType: "EB1A" });
    expect(v).toContainEqual({ name: "beneficiary_family_name", value: "Rao" });
    expect(v).toContainEqual({ name: "beneficiary_given_name", value: "Anand" });
    expect(v.find(x => x.name === "classification")?.value).toMatch(/203\(b\)\(1\)\(A\)/);
    expect(v).toContainEqual({ name: "petitioner_name", value: "Dr. Anand Rao" });
  });

  it("gives I-907 the underlying form by case type and nothing when the case type is unknown", () => {
    expect(prefillValues("I-907", { clientName: "Test Client", caseType: "O1A" })).toContainEqual({ name: "form_type", value: "I-129" });
    expect(prefillValues("I-907", { clientName: "Test Client", caseType: null }).find(x => x.name === "classification")).toBeUndefined();
  });
});

describe("nextStatus", () => {
  it("walks review → approve → awaiting signature → signed, and refuses to skip steps", () => {
    expect(nextStatus("not_started", "prepare")).toBe("opened");
    expect(nextStatus("opened", "fill")).toBe("for_review");
    expect(nextStatus("for_review", "approve")).toBe("approved");
    expect(() => nextStatus("for_review", "request_signature")).toThrow(/Approve the form/);
    expect(nextStatus("approved", "request_signature")).toBe("awaiting_signature");
    expect(() => nextStatus("approved", "sign")).toThrow(/not waiting/);
    expect(nextStatus("awaiting_signature", "sign")).toBe("signed");
  });

  it("keeps a signed form signed when the firm refills or the attorney rules again", () => {
    expect(nextStatus("signed", "fill")).toBe("signed");
    expect(nextStatus("signed", "rule")).toBe("signed");
    expect(nextStatus("signed", "approve")).toBe("signed");
    expect(nextStatus("awaiting_signature", "approve")).toBe("awaiting_signature");
  });
});
