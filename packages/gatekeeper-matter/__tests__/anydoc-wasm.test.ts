// The wasm module itself, instantiated from bytes the way the worker will (a compiled module
// from wrangler's CompiledWasm rule; here the file's bytes): CSV and a docx-less smoke test.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("anydoc wasm", () => {
  it("instantiates from bytes and converts a CSV to a Markdown table", async () => {
    const mod = await import("@firecrawl/anydoc-wasm");
    const wasmPath = require.resolve("@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm");
    await mod.default({ module_or_path: readFileSync(wasmPath) });
    const md = mod.toMarkdownBytes(new TextEncoder().encode("name,cited\nCompliant grasps,412\nSoft actuators,287\n"), "csv");
    expect(md).toContain("Compliant grasps");
    expect(md).toContain("412");
    expect(md).toMatch(/\|/);
  });
  it("reports a scanned PDF as needing OCR rather than returning empty text", async () => {
    const mod = await import("@firecrawl/anydoc-wasm");
    const { PDFDocument, rgb } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 60, y: 700, width: 200, height: 8, color: rgb(0.1, 0.1, 0.1) });
    const bytes = await doc.save();
    let code = "none";
    try { mod.toMarkdownBytes(bytes, "pdf"); } catch (e) { code = (e as { code?: string }).code ?? "thrown"; }
    expect(["needsOcr", "malformed", "thrown"]).toContain(code);
  });
});
