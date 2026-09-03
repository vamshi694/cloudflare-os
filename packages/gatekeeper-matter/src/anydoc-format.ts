// Which uploads anydoc (Firecrawl's document-to-Markdown converter, WebAssembly in the worker)
// reads, and under which format name. Pure, so it is testable without the wasm module.

export type AnydocFormat = "doc" | "docx" | "odt" | "pdf" | "ppt" | "pptx" | "rtf" | "epub" | "xlsx" | "ods" | "odp" | "csv";

const BY_EXTENSION: Record<string, AnydocFormat> = {
  doc: "doc", docx: "docx", docm: "docx", dot: "doc", dotx: "docx",
  odt: "odt", ods: "ods", odp: "odp",
  ppt: "ppt", pptx: "pptx", pptm: "pptx", ppsx: "pptx", ppsm: "pptx", pps: "ppt", pot: "ppt",
  xls: "xlsx", xlsx: "xlsx", xlsm: "xlsx", xlsb: "xlsx",
  rtf: "rtf", epub: "epub", csv: "csv", pdf: "pdf",
};

const BY_MIME: Record<string, AnydocFormat> = {
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-excel": "xlsx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/rtf": "rtf", "text/rtf": "rtf",
  "application/epub+zip": "epub",
  "text/csv": "csv",
  "application/pdf": "pdf",
};

/** The anydoc format for an upload, from its extension first (the mime is often generic), else its mime; undefined when anydoc does not read it. */
export function anydocFormatFor(filename: string, mime: string): AnydocFormat | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (ext && BY_EXTENSION[ext]) return BY_EXTENSION[ext];
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  return BY_MIME[m];
}

/** Office, OpenDocument, RTF, EPUB and CSV: anydoc is the first reader. PDFs are pdf.js's first. */
export function anydocReadsFirst(format: AnydocFormat | undefined): boolean {
  return format !== undefined && format !== "pdf";
}
