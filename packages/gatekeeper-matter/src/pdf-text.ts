// Page-exact text for PDFs that carry a text layer. pdf.js (unpdf's serverless build) runs inside
// the worker, one page at a time, so every fact the reader records can name its page. Scans have
// no text layer; the caller falls back to the OCR lane (AI.toMarkdown) when this returns nothing.

import { extractText, getDocumentProxy } from "unpdf";

export async function pdfPages(bytes: ArrayBuffer): Promise<{ pages: string[]; totalPages: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    return { pages: text, totalPages };
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.()?.catch(() => {});
  }
}
