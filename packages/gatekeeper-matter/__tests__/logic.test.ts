// The smallest checks that fail if the deterministic logic breaks: text folding for exact search,
// the filename family used for version dedup, desk path normalization, and the reader's parser
// (quote binding, malformed input). No workerd needed; these are pure functions.

import { describe, expect, it } from "vitest";
import { filenameFamily, foldText, normalizePath, parseMatterUrl, parseUnderstanding, ReadError } from "../src/pure.js";

describe("foldText", () => {
  it("folds typography, case and whitespace so OCR'd text still matches", () => {
    expect(foldText("“Senior  Member” – IEEE")).toBe('"senior member" - ieee');
  });
});

describe("filenameFamily", () => {
  it("treats renamed copies as one family", () => {
    const base = filenameFamily("Resume.pdf");
    expect(filenameFamily("resume_final (1).pdf")).toBe(base);
    expect(filenameFamily("resume v2.PDF")).toBe(base);
    expect(filenameFamily("cover letter.pdf")).not.toBe(base);
  });
});

describe("normalizePath", () => {
  it("accepts nested paths and rejects traversal", () => {
    expect(normalizePath("notes/criteria.md")).toBe("notes/criteria.md");
    expect(() => normalizePath("../plan.md")).toThrow();
    expect(() => normalizePath(".hidden")).toThrow();
  });
});

describe("parseMatterUrl", () => {
  it("accepts only 32-hex matter ids", () => {
    const id = "0123456789abcdef0123456789abcdef";
    expect(parseMatterUrl(`legal://matter/${id}`)).toBe(id);
    expect(() => parseMatterUrl("legal://matter/nope")).toThrow();
  });
});

describe("parseUnderstanding", () => {
  const text = "Dr. Rao received the 2019 IEEE Fellow award for contributions to signal processing.";

  it("keeps bound quotes at their confidence and demotes unbound ones", () => {
    const raw = JSON.stringify({
      doc_type: "award_letter",
      display_title: "2019 IEEE Fellow letter",
      facts: [
        { statement: "Rao is an IEEE Fellow (2019).", quote: "received the 2019 IEEE Fellow award", confidence: 0.9 },
        { statement: "Rao won a Nobel prize.", quote: "won the Nobel prize", confidence: 0.9 },
      ],
    });
    const u = parseUnderstanding(raw, text);
    expect(u.docType).toBe("award_letter");
    expect(u.facts[0].confidence).toBe(0.9);
    expect(u.facts[1].confidence).toBeLessThanOrEqual(0.4);
  });

  it("treats a non-JSON reply as a retryable read error", () => {
    expect(() => parseUnderstanding("Sorry, I cannot help.", text)).toThrow(ReadError);
  });
});
