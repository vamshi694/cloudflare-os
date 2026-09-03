// anydoc routing: which uploads it reads first and under which format name. Pure; the wasm
// module is never loaded here.
import { describe, expect, it } from "vitest";
import { anydocFormatFor, anydocReadsFirst } from "../src/anydoc-format.js";

describe("anydoc routing", () => {
  it("names Office, OpenDocument, RTF, EPUB and CSV by extension, whatever the mime says", () => {
    expect(anydocFormatFor("letter.docx", "application/octet-stream")).toBe("docx");
    expect(anydocFormatFor("deck.PPTX", "")).toBe("pptx");
    expect(anydocFormatFor("citations.xlsm", "")).toBe("xlsx");
    expect(anydocFormatFor("cv.odt", "")).toBe("odt");
    expect(anydocFormatFor("memo.rtf", "")).toBe("rtf");
    expect(anydocFormatFor("book.epub", "")).toBe("epub");
    expect(anydocFormatFor("report.csv", "text/csv")).toBe("csv");
  });
  it("falls back to the mime when the filename has no useful extension", () => {
    expect(anydocFormatFor("upload", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(anydocFormatFor("upload", "application/rtf; charset=utf-8")).toBe("rtf");
  });
  it("does not claim scans, images or unknown types", () => {
    expect(anydocFormatFor("scan.png", "image/png")).toBeUndefined();
    expect(anydocFormatFor("photo.jpg", "")).toBeUndefined();
    expect(anydocFormatFor("archive.zip", "application/zip")).toBeUndefined();
  });
  it("reads Office first but leaves PDFs to pdf.js first", () => {
    expect(anydocReadsFirst("docx")).toBe(true);
    expect(anydocReadsFirst("csv")).toBe(true);
    expect(anydocReadsFirst("pdf")).toBe(false);
    expect(anydocReadsFirst(undefined)).toBe(false);
  });
});
