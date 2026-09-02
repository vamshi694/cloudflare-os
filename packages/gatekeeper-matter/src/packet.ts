// The USCIS packet binder and the Word export. One PDF: a cover, a table of contents with real
// page numbers, the letter set in a serif on letter-size paper, then every numbered exhibit behind
// its own tab page (PDF exhibits merged page by page, images embedded, anything else a page that
// names the file). Every page carries "Page N of M"; when a quote in the letter is unverified the
// whole packet is stamped DRAFT, because an adjudicator reads an unverifiable quote as fabrication.
//
// The planning functions are pure (tested); only `buildPacket` and `letterDocx` touch pdf-lib/docx.

import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type PacketExhibit = { exhibitNo: number; title: string; filename: string; mime: string; bytes: Uint8Array | null };
export type PacketAttachment = { title: string; note: string };

export type PacketInput = {
  petitionTitle: string;
  beneficiary: string;
  date: string;
  letterMarkdown: string;
  exhibits: PacketExhibit[];
  /** Approved government forms that ride with the filing but are rendered elsewhere. */
  attachments: PacketAttachment[];
  draft: boolean;
};

export type TocEntry = { label: string; page: number; indent: 0 | 1 };
export type PacketResult = { bytes: Uint8Array; pages: number; toc: TocEntry[]; draft: boolean };

const PAGE = { width: 612, height: 792, margin: 72 } as const;
const BODY_SIZE = 12;
const LINE = 16;
export const TOC_LINES_PER_PAGE = 36;

// ---- pure planning ------------------------------------------------------------------------------

export type Block = { kind: "heading" | "paragraph" | "item" | "blank"; text: string };

/** Markdown the letter uses (## headings, **bold**, - items, blank lines) into typeset blocks. */
export function markdownBlocks(markdown: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ kind: "paragraph", text: para.join(" ") }); para = []; } };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|\s)_([^_]+)_(\s|$)/g, "$1$2$3").trimEnd();
    if (!line.trim()) { flush(); if (out.length && out[out.length - 1].kind !== "blank") out.push({ kind: "blank", text: "" }); continue; }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { flush(); out.push({ kind: "heading", text: h[1].trim() }); continue; }
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) { flush(); out.push({ kind: "item", text: li[1].trim() }); continue; }
    para.push(line.trim());
  }
  flush();
  while (out.length && out[out.length - 1].kind === "blank") out.pop();
  return out;
}

/** Greedy word wrap against a measuring function; a single word wider than the line stands alone. */
export function wrapLine(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (measure(candidate) <= maxWidth || !current) current = candidate;
    else { lines.push(current); current = w; }
  }
  if (current) lines.push(current);
  return lines;
}

/** How many contents pages a list of entries needs. */
export function tocPageCount(entries: number, perPage = TOC_LINES_PER_PAGE): number {
  return Math.max(1, Math.ceil(entries / perPage));
}

/**
 * Final page numbers. The body (letter, exhibits) is laid out first, its entries carrying body
 * page indexes (1-based); the cover and the contents pages sit in front, so every number shifts.
 */
export function numberEntries(bodyEntries: TocEntry[], perPage = TOC_LINES_PER_PAGE): { entries: TocEntry[]; front: number } {
  const front = 1 + tocPageCount(bodyEntries.length, perPage);
  return { entries: bodyEntries.map(e => ({ ...e, page: e.page + front })), front };
}

/** The DRAFT stamp is a fact of the letter, never a mood: any unverified quote stamps the packet. */
export function shouldStampDraft(sections: { status: string; unverifiedQuotes: unknown[] }[]): boolean {
  return sections.some(s => s.status === "drafted" && s.unverifiedQuotes.length > 0);
}

/** Standard PDF fonts cover WinAnsi only; keep the typography, drop what cannot be set. */
export function safeText(s: string): string {
  return s
    .replace(/[‘’‚]/g, "'").replace(/[“”„]/g, "\"")
    .replace(/—/g, " - ").replace(/–/g, "-").replace(/…/g, "...").replace(/ /g, " ")
    .replace(/[•●]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

// ---- pdf-lib rendering ---------------------------------------------------------------------------

type Fonts = { serif: PDFFont; bold: PDFFont; sans: PDFFont };

class Typesetter {
  page: PDFPage;
  y: number;
  readonly pages: PDFPage[] = [];
  constructor(private readonly doc: PDFDocument, private readonly fonts: Fonts) {
    this.page = this.newPage();
    this.y = PAGE.height - PAGE.margin;
  }
  newPage(): PDFPage {
    const p = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(p);
    this.page = p;
    this.y = PAGE.height - PAGE.margin;
    return p;
  }
  ensure(lines: number): void {
    if (this.y - lines * LINE < PAGE.margin) this.newPage();
  }
  get width(): number { return PAGE.width - 2 * PAGE.margin; }
  text(line: string, opts: { font?: PDFFont; size?: number; x?: number; center?: boolean } = {}): void {
    const font = opts.font ?? this.fonts.serif; const size = opts.size ?? BODY_SIZE;
    const t = safeText(line);
    const w = font.widthOfTextAtSize(t, size);
    const x = opts.center ? (PAGE.width - w) / 2 : (opts.x ?? PAGE.margin);
    this.page.drawText(t, { x, y: this.y - size, size, font, color: rgb(0.11, 0.11, 0.12) });
    this.y -= LINE;
  }
  paragraph(text: string, opts: { indent?: number; font?: PDFFont; size?: number } = {}): void {
    const font = opts.font ?? this.fonts.serif; const size = opts.size ?? BODY_SIZE;
    const indent = opts.indent ?? 0;
    const lines = wrapLine(safeText(text), this.width - indent, s => font.widthOfTextAtSize(s, size));
    for (const l of lines) { this.ensure(1); this.text(l, { font, size, x: PAGE.margin + indent }); }
  }
  gap(n = 1): void { this.y -= LINE * n; if (this.y < PAGE.margin) this.newPage(); }
}

function drawLetter(ts: Typesetter, fonts: Fonts, markdown: string): void {
  for (const b of markdownBlocks(markdown)) {
    if (b.kind === "blank") { ts.gap(0.6); continue; }
    if (b.kind === "heading") {
      ts.ensure(3); ts.gap(0.4);
      ts.text(b.text.toUpperCase(), { font: fonts.bold, size: 12, center: true });
      const w = fonts.bold.widthOfTextAtSize(safeText(b.text.toUpperCase()), 12);
      ts.page.drawLine({ start: { x: (PAGE.width - w) / 2, y: ts.y + 3 }, end: { x: (PAGE.width + w) / 2, y: ts.y + 3 }, thickness: 0.6, color: rgb(0.11, 0.11, 0.12) });
      ts.gap(0.4);
      continue;
    }
    if (b.kind === "item") { ts.paragraph(`- ${b.text}`, { indent: 18 }); continue; }
    ts.paragraph(b.text);
  }
}

function tabPage(doc: PDFDocument, fonts: Fonts, exhibitNo: number, title: string, filename: string): PDFPage {
  const p = doc.addPage([PAGE.width, PAGE.height]);
  const head = `EXHIBIT ${exhibitNo}`;
  p.drawText(head, { x: (PAGE.width - fonts.bold.widthOfTextAtSize(head, 34)) / 2, y: PAGE.height / 2 + 30, size: 34, font: fonts.bold, color: rgb(0.11, 0.11, 0.12) });
  let y = PAGE.height / 2 - 6;
  for (const line of wrapLine(safeText(title), PAGE.width - 2 * PAGE.margin, s => fonts.serif.widthOfTextAtSize(s, 14))) {
    p.drawText(line, { x: (PAGE.width - fonts.serif.widthOfTextAtSize(line, 14)) / 2, y, size: 14, font: fonts.serif, color: rgb(0.11, 0.11, 0.12) });
    y -= 20;
  }
  const fn = safeText(filename);
  p.drawText(fn, { x: (PAGE.width - fonts.sans.widthOfTextAtSize(fn, 9)) / 2, y: y - 6, size: 9, font: fonts.sans, color: rgb(0.45, 0.45, 0.47) });
  return p;
}

async function exhibitPages(doc: PDFDocument, fonts: Fonts, ex: PacketExhibit): Promise<number> {
  if (ex.bytes && ex.mime === "application/pdf") {
    try {
      const src = await PDFDocument.load(ex.bytes, { ignoreEncryption: true });
      const pages = await doc.copyPages(src, src.getPageIndices());
      for (const p of pages) doc.addPage(p);
      if (pages.length) return pages.length;
    } catch { /* fall through to the placeholder: the packet must never fail on one exhibit */ }
  }
  if (ex.bytes && (ex.mime === "image/png" || ex.mime === "image/jpeg")) {
    try {
      const img = ex.mime === "image/png" ? await doc.embedPng(ex.bytes) : await doc.embedJpg(ex.bytes);
      const p = doc.addPage([PAGE.width, PAGE.height]);
      const maxW = PAGE.width - 2 * PAGE.margin, maxH = PAGE.height - 2 * PAGE.margin;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale, h = img.height * scale;
      p.drawImage(img, { x: (PAGE.width - w) / 2, y: (PAGE.height - h) / 2, width: w, height: h });
      return 1;
    } catch { /* placeholder below */ }
  }
  const p = doc.addPage([PAGE.width, PAGE.height]);
  const lines = [
    `Exhibit ${ex.exhibitNo} is the file "${ex.filename}" (${ex.mime}).`,
    ex.bytes ? "It cannot be rendered into this binder; it accompanies the packet as a separate file." : "Its bytes were not available when this packet was assembled; it accompanies the packet as a separate file.",
  ];
  let y = PAGE.height - PAGE.margin - 40;
  for (const l of lines) for (const w of wrapLine(safeText(l), PAGE.width - 2 * PAGE.margin, s => fonts.serif.widthOfTextAtSize(s, 12))) {
    p.drawText(w, { x: PAGE.margin, y, size: 12, font: fonts.serif, color: rgb(0.11, 0.11, 0.12) }); y -= LINE;
  }
  return 1;
}

function stampAll(pages: PDFPage[], fonts: Fonts, draft: boolean): void {
  const total = pages.length;
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${total}`;
    p.drawText(label, { x: (PAGE.width - fonts.sans.widthOfTextAtSize(label, 9)) / 2, y: 36, size: 9, font: fonts.sans, color: rgb(0.45, 0.45, 0.47) });
    if (draft) {
      p.drawText("DRAFT", { x: 150, y: 250, size: 110, font: fonts.bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.16, rotate: degrees(40) });
      p.drawText("DRAFT - quotes in the letter await verification", { x: PAGE.margin, y: PAGE.height - 30, size: 8, font: fonts.sans, color: rgb(0.7, 0.2, 0.2) });
    }
  });
}

export async function buildPacket(input: PacketInput): Promise<PacketResult> {
  // The body first, so the contents can carry real numbers.
  const body = await PDFDocument.create();
  const fonts: Fonts = {
    serif: await body.embedFont(StandardFonts.TimesRoman),
    bold: await body.embedFont(StandardFonts.TimesRomanBold),
    sans: await body.embedFont(StandardFonts.Helvetica),
  };
  const bodyEntries: TocEntry[] = [];
  const ts = new Typesetter(body, fonts);
  bodyEntries.push({ label: "The petition letter", page: 1, indent: 0 });
  drawLetter(ts, fonts, input.letterMarkdown);
  for (const a of input.attachments) {
    const p = body.addPage([PAGE.width, PAGE.height]);
    bodyEntries.push({ label: a.title, page: body.getPageCount(), indent: 0 });
    let y = PAGE.height - PAGE.margin - 20;
    for (const l of wrapLine(safeText(`${a.title}. ${a.note}`), PAGE.width - 2 * PAGE.margin, s => fonts.serif.widthOfTextAtSize(s, 12))) {
      p.drawText(l, { x: PAGE.margin, y, size: 12, font: fonts.serif, color: rgb(0.11, 0.11, 0.12) }); y -= LINE;
    }
  }
  for (const ex of [...input.exhibits].sort((a, b) => a.exhibitNo - b.exhibitNo)) {
    tabPage(body, fonts, ex.exhibitNo, ex.title, ex.filename);
    bodyEntries.push({ label: `Exhibit ${ex.exhibitNo} - ${ex.title}`, page: body.getPageCount(), indent: 1 });
    await exhibitPages(body, fonts, ex);
  }

  // Then the binder: cover, contents, the body copied behind them.
  const { entries, front } = numberEntries(bodyEntries);
  const out = await PDFDocument.create();
  const f: Fonts = {
    serif: await out.embedFont(StandardFonts.TimesRoman),
    bold: await out.embedFont(StandardFonts.TimesRomanBold),
    sans: await out.embedFont(StandardFonts.Helvetica),
  };
  out.setTitle(`${input.petitionTitle} - ${input.beneficiary}`);
  out.setProducer("Legal OS");
  const cover = out.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - 220;
  const centered = (page: PDFPage, text: string, size: number, font: PDFFont, color = rgb(0.11, 0.11, 0.12)) => {
    for (const l of wrapLine(safeText(text), PAGE.width - 2 * PAGE.margin, s => font.widthOfTextAtSize(s, size))) {
      page.drawText(l, { x: (PAGE.width - font.widthOfTextAtSize(l, size)) / 2, y, size, font, color }); y -= size * 1.4;
    }
  };
  centered(cover, "U.S. Citizenship and Immigration Services", 12, f.sans, rgb(0.45, 0.45, 0.47));
  y -= 18;
  centered(cover, input.petitionTitle, 20, f.bold);
  y -= 10;
  centered(cover, `Beneficiary: ${input.beneficiary}`, 13, f.serif);
  centered(cover, input.date, 12, f.serif);
  y -= 30;
  centered(cover, "Prepared by [ATTORNEY NAME], Counsel for the Petitioner", 11, f.serif, rgb(0.35, 0.35, 0.37));
  centered(cover, `${entries.filter(e => e.indent === 1).length} exhibits`, 11, f.serif, rgb(0.35, 0.35, 0.37));

  const perPage = TOC_LINES_PER_PAGE;
  for (let i = 0; i < front - 1; i++) {
    const p = out.addPage([PAGE.width, PAGE.height]);
    let ty = PAGE.height - PAGE.margin;
    if (i === 0) {
      p.drawText("CONTENTS", { x: (PAGE.width - f.bold.widthOfTextAtSize("CONTENTS", 13)) / 2, y: ty - 13, size: 13, font: f.bold, color: rgb(0.11, 0.11, 0.12) });
      ty -= 30;
    }
    for (const e of entries.slice(i * perPage, (i + 1) * perPage)) {
      const num = String(e.page);
      const numW = f.serif.widthOfTextAtSize(num, 11);
      const x = PAGE.margin + (e.indent ? 18 : 0);
      const maxLabel = PAGE.width - PAGE.margin - numW - 24 - x;
      let label = safeText(e.label);
      while (f.serif.widthOfTextAtSize(label, 11) > maxLabel && label.length > 8) label = `${label.slice(0, -4).trimEnd()}...`;
      p.drawText(label, { x, y: ty - 11, size: 11, font: f.serif, color: rgb(0.11, 0.11, 0.12) });
      const lw = f.serif.widthOfTextAtSize(label, 11);
      const dotStart = x + lw + 6, dotEnd = PAGE.width - PAGE.margin - numW - 6;
      for (let dx = dotStart; dx < dotEnd; dx += 6) p.drawText(".", { x: dx, y: ty - 11, size: 11, font: f.serif, color: rgb(0.6, 0.6, 0.62) });
      p.drawText(num, { x: PAGE.width - PAGE.margin - numW, y: ty - 11, size: 11, font: f.serif, color: rgb(0.11, 0.11, 0.12) });
      ty -= 18;
    }
  }
  const copied = await out.copyPages(body, body.getPageIndices());
  for (const p of copied) out.addPage(p);
  stampAll(out.getPages(), f, input.draft);
  return { bytes: await out.save(), pages: out.getPageCount(), toc: entries, draft: input.draft };
}

// ---- Word export --------------------------------------------------------------------------------

/** The letter (or any desk document) as a .docx. Returns null when the docx library is unavailable. */
export async function markdownDocx(markdown: string, title: string): Promise<Uint8Array | null> {
  let docx: typeof import("docx");
  try { docx = await import("docx"); } catch { return null; }
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;
  const children = markdownBlocks(markdown).map(b => {
    if (b.kind === "heading") return new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 } });
    if (b.kind === "item") return new Paragraph({ children: [new TextRun(b.text)], bullet: { level: 0 } });
    if (b.kind === "blank") return new Paragraph({ text: "" });
    return new Paragraph({ children: [new TextRun({ text: b.text, font: "Times New Roman", size: 24 })], alignment: AlignmentType.JUSTIFIED, spacing: { after: 160 } });
  });
  const doc = new Document({ title, creator: "Legal OS", sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
