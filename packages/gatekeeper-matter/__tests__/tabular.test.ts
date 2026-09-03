// Tabular review (WP-14): the pure parts. Cells are honest (a guess never becomes an answer), the
// CSV round-trips the grid with pages, and a lawyer's question gets a stable column key.
import { describe, expect, it } from "vitest";
import type { TableView } from "@gadgets/workshop-shared/legal";
import { cellOf, questionKey, shapeAnswers, toCsv } from "../src/store-tabular.js";

describe("shapeAnswers", () => {
  it("keeps only known keys, one answer per key, with sane pages", () => {
    const out = shapeAnswers([
      { key: "date", answer: "14 January 2019", page: 1, quote: "14 January 2019" },
      { key: "date", answer: "duplicate", page: 1, quote: null },
      { key: "issuer", answer: "IEEE", page: 9, quote: "INSTITUTE OF ELECTRICAL" },
      { key: "unknownKey", answer: "x", page: null, quote: null },
      { key: "proves", answer: "  Elevation   to Fellow  ", page: 0, quote: "" },
    ], ["date", "issuer", "proves"], 2);
    expect(out).toEqual([
      { key: "date", answer: "14 January 2019", page: 1, quote: "14 January 2019" },
      { key: "issuer", answer: "IEEE", page: null, quote: "INSTITUTE OF ELECTRICAL" },
      { key: "proves", answer: "Elevation to Fellow", page: null, quote: null },
    ]);
  });

  it("turns a model's non-answers into null, never a guess, and drops the quote with the answer", () => {
    const out = shapeAnswers([
      { key: "date", answer: "Not stated", page: 2, quote: "something" },
      { key: "issuer", answer: "N/A", page: null, quote: null },
    ], ["date", "issuer"], null);
    expect(out).toEqual([
      { key: "date", answer: null, page: 2, quote: null },
      { key: "issuer", answer: null, page: null, quote: null },
    ]);
  });

  it("ignores garbage", () => {
    expect(shapeAnswers("nope", ["date"], null)).toEqual([]);
    expect(shapeAnswers([null, 3, { key: 4 }], ["date"], null)).toEqual([]);
  });
});

describe("cellOf", () => {
  it("is pending when nothing was asked and carries the failure note", () => {
    expect(cellOf(undefined)).toEqual({ status: "pending", answer: null, page: null, quote: null, note: null });
    expect(cellOf({ status: "failed", answer: null, page: null, quote: null, note: "timed out" })).toMatchObject({ status: "failed", note: "timed out" });
  });
});

describe("toCsv", () => {
  const view: TableView = {
    columns: [
      { key: "date", question: "What date does this document carry?", custom: false, askedBy: null },
      { key: "q-who-signed", question: "Who signed it, \"exactly\"?", custom: true, askedBy: "lawyer" },
    ],
    rows: [
      {
        documentId: "d1", title: "Letter, IEEE", docType: "award_letter", mime: "application/pdf",
        cells: {
          date: { status: "answered", answer: "14 January 2019", page: 1, quote: "14 January 2019", note: null },
          "q-who-signed": { status: "answered", answer: null, page: null, quote: null, note: null },
        },
      },
      {
        documentId: "d2", title: "CV", docType: "cv", mime: "text/plain",
        cells: {
          date: { status: "failed", answer: null, page: null, quote: null, note: "no text" },
          "q-who-signed": { status: "running", answer: null, page: null, quote: null, note: null },
        },
      },
    ],
    running: 1, total: 4,
  };

  it("writes a header of questions and one row per document, quoting what needs quoting", () => {
    const csv = toCsv(view);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe('Document,What date does this document carry?,"Who signed it, ""exactly""?"');
    expect(lines[1]).toBe('"Letter, IEEE",14 January 2019 (p. 1),not stated');
    expect(lines[2]).toBe("CV,(no text),");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("questionKey", () => {
  it("is stable, readable, and distinct for different questions", () => {
    const a = questionKey("Who signed it?");
    expect(a).toBe(questionKey("Who signed it?"));
    expect(a.startsWith("q-who-signed-it-")).toBe(true);
    expect(a).not.toBe(questionKey("Who issued it?"));
  });
});
