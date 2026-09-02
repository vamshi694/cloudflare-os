import { describe, expect, it } from "vitest";
import { evidenceVocabulary, hasTextLayer, pageAt, pagesToText } from "../src/pure.js";

describe("page-exact text", () => {
  it("joins pages under the record's markers and finds a page by offset", () => {
    const text = pagesToText(["First page words.  \n", "Second page words."]);
    expect(text.startsWith("=== page 1 ===\nFirst page words.")).toBe(true);
    expect(text).toContain("\n\n=== page 2 ===\nSecond page words.");
    expect(pageAt(text, text.indexOf("Second"))).toBe(2);
    expect(pageAt(text, text.indexOf("First"))).toBe(1);
    expect(pageAt("no markers here", 5)).toBeNull();
  });

  it("treats a scan (no words per page) as having no text layer", () => {
    expect(hasTextLayer([])).toBe(false);
    expect(hasTextLayer(["", "  ", "a b"])).toBe(false);
    const digital = Array.from({ length: 3 }, () => "The letter states that the candidate was elevated to Fellow in recognition of contributions.");
    expect(hasTextLayer(digital)).toBe(true);
    // One typed cover sheet in front of a 40-page scan is still a scan.
    const mostlyScan = [digital[0], ...Array.from({ length: 40 }, () => "")];
    expect(hasTextLayer(mostlyScan)).toBe(false);
  });
});

describe("evidence vocabulary", () => {
  it("adds the case type's document kinds and always keeps other last", () => {
    const eb1a = evidenceVocabulary("EB1A");
    expect(eb1a).toContain("award_letter");
    expect(eb1a).toContain("exhibition_record");
    expect(eb1a[eb1a.length - 1]).toBe("other");
    expect(evidenceVocabulary("eb2 niw")).toContain("proposed_endeavor_statement");
    expect(evidenceVocabulary(null)).not.toContain("lca");
    expect(evidenceVocabulary("H1B")).toContain("lca");
  });
});
