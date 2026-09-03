// anydoc in the worker: Firecrawl's converter (MIT, Rust compiled to WebAssembly) turns Word,
// PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV and text-layer PDFs into Markdown in a few
// milliseconds, with no model and no network. Scans and images are not its job (it has no OCR);
// they stay on the Workers AI lane in ingest.ts. The module is instantiated once per isolate.

import wasmModule from "@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm";
import init, { toMarkdownBytes } from "@firecrawl/anydoc-wasm";
import type { AnydocFormat } from "./anydoc-format.js";

let ready: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  if (!ready) {
    ready = init({ module_or_path: wasmModule }).then(() => undefined).catch(err => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

export type AnydocFailure = { code: string; message: string; needsOcrPages?: number[]; pageCount?: number };

/**
 * Convert one document to Markdown. Throws an `AnydocFailure`-shaped Error (`code` set) when
 * anydoc cannot produce complete Markdown: "needsOcr" for scanned PDF pages (with the pages),
 * "unsupported", "malformed", "encrypted", "resourceLimit", "missingPart".
 */
export async function anydocToMarkdown(bytes: ArrayBuffer, format: AnydocFormat): Promise<string> {
  await ensureReady();
  try {
    return toMarkdownBytes(new Uint8Array(bytes), format);
  } catch (error) {
    const e = error as Error & { code?: string; pages?: number[]; pageCount?: number };
    const failure: AnydocFailure = {
      code: e?.code ?? "unknown",
      message: e instanceof Error ? e.message : String(error),
      needsOcrPages: e?.pages, pageCount: e?.pageCount,
    };
    const wrapped = new Error(failure.message) as Error & AnydocFailure;
    Object.assign(wrapped, failure);
    throw wrapped;
  }
}
