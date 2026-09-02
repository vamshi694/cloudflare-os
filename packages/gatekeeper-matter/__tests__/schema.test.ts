// Every module's schema must be composed into the store's SCHEMA: a table that a module reads but
// the store never creates surfaces as "no such table" on a live matter (caught live: gap_items).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(__dirname, "..", "src");
const store = readFileSync(join(src, "store.ts"), "utf8");
const composition = store.split("\n").find(l => l.includes("D.DESK_SCHEMA")) ?? "";

describe("store schema composition", () => {
  const modules = readdirSync(src).filter(f => /^store-.*\.ts$/.test(f));
  for (const file of modules) {
    const text = readFileSync(join(src, file), "utf8");
    const exported = [...text.matchAll(/export const ([A-Z_]+_SCHEMA)\b/g)].map(m => m[1]);
    for (const name of exported) {
      it(`${file} exports ${name} and store.ts composes it`, () => {
        expect(composition).toContain(name);
      });
    }
  }
  it("every table a module reads is created by some schema", () => {
    const schemas = readdirSync(src).filter(f => /^store-.*\.ts$/.test(f) || f === "store.ts")
      .map(f => readFileSync(join(src, f), "utf8")).join("\n");
    const created = new Set([...schemas.matchAll(/CREATE (?:VIRTUAL )?TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]));
    const read = new Set([...schemas.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)\b/g)].map(m => m[1]));
    const missing = [...read].filter(t => !created.has(t) && !["sqlite_master", "excluded"].includes(t));
    expect(missing).toEqual([]);
  });
});
