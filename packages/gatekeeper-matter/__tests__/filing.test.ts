import { describe, expect, it } from "vitest";
import { canonicalJson, generateFirmKeyPair, sha256Hex, signManifest, verifyManifest, type FilingManifest } from "../src/manifest.js";
import { buildPacket, markdownBlocks, numberEntries, safeText, shouldStampDraft, tocPageCount, wrapLine, type TocEntry } from "../src/packet.js";
import { normName, reconcileRecommenders, upsertRecommender, listRecommenders, FILING_SCHEMA, deliverableTitle } from "../src/store-filing.js";
import type { Db } from "../src/store-db.js";

function manifest(over: Partial<FilingManifest> = {}): FilingManifest {
  return {
    format: "legal-os-filing-manifest/1", matterId: "a".repeat(32), versionId: "b".repeat(32), at: "2026-09-02T00:00:00.000Z",
    petitionTitle: "I-140 Immigrant Petition for Alien of Extraordinary Ability (EB-1A)", beneficiary: "Dr. Test Client",
    letterSha256: "00", packetSha256: "11", pages: 12, draft: false,
    exhibits: [{ exhibitNo: 1, documentId: "c".repeat(32), filename: "award.pdf", sha256: "22", bytes: 100 }],
    forms: ["I-140"], publicKeyJwk: {}, ...over,
  };
}

describe("the signed manifest", () => {
  it("canonical JSON sorts keys at every level so the same content always signs the same bytes", () => {
    expect(canonicalJson({ b: 1, a: { z: [3, { y: 1, x: 2 }], m: null } })).toBe('{"a":{"m":null,"z":[3,{"x":2,"y":1}]},"b":1}');
  });

  it("signs with Ed25519 and verifies with the public key carried inside the manifest", async () => {
    const keys = await generateFirmKeyPair();
    const m = manifest({ publicKeyJwk: keys.publicKeyJwk });
    const signed = await signManifest(m, keys.privateKeyJwk);
    expect(signed.algorithm).toBe("Ed25519");
    expect(await verifyManifest(signed, m.publicKeyJwk)).toBe(true);
    // One changed byte of the content, and the signature no longer holds.
    expect(await verifyManifest({ ...signed, canonical: signed.canonical.replace('"pages":12', '"pages":13') }, m.publicKeyJwk)).toBe(false);
    // Another firm's key never verifies it.
    const other = await generateFirmKeyPair();
    expect(await verifyManifest(signed, other.publicKeyJwk)).toBe(false);
  });

  it("hashes bytes and strings alike", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(await sha256Hex("abc"));
  });
});

describe("packet planning", () => {
  it("stamps DRAFT only when a drafted section still carries an unverified quote", () => {
    expect(shouldStampDraft([{ status: "drafted", unverifiedQuotes: [] }, { status: "held", unverifiedQuotes: [{}] }])).toBe(false);
    expect(shouldStampDraft([{ status: "drafted", unverifiedQuotes: [{}] }])).toBe(true);
  });

  it("numbers the contents after the cover and the contents pages themselves", () => {
    const body: TocEntry[] = [{ label: "The petition letter", page: 1, indent: 0 }, { label: "Exhibit 1 - Award", page: 4, indent: 1 }];
    const { entries, front } = numberEntries(body, 36);
    expect(front).toBe(2);
    expect(entries.map(e => e.page)).toEqual([3, 6]);
    expect(tocPageCount(37, 36)).toBe(2);
    expect(tocPageCount(0)).toBe(1);
    // Enough exhibits to spill the contents onto a second page shifts everything by one more.
    const many = Array.from({ length: 40 }, (_, i) => ({ label: `Exhibit ${i + 1}`, page: i + 2, indent: 1 as const }));
    expect(numberEntries(many, 36).front).toBe(3);
  });

  it("reads the letter's markdown into headings, paragraphs and items", () => {
    const blocks = markdownBlocks("## INTRODUCTION\n\nThis **petition** seeks.\nMore of it.\n\n- one\n- two\n\n\n");
    expect(blocks.map(b => b.kind)).toEqual(["heading", "blank", "paragraph", "blank", "item", "item"]);
    expect(blocks[2].text).toBe("This petition seeks. More of it.");
  });

  it("wraps on measured width and never loses a word", () => {
    const lines = wrapLine("the quick brown fox jumps over the lazy dog", 10, s => s.length);
    expect(lines).toEqual(["the quick", "brown fox", "jumps over", "the lazy", "dog"]);
    expect(wrapLine("supercalifragilistic word", 5, s => s.length)).toEqual(["supercalifragilistic", "word"]);
  });

  it("keeps typography the standard fonts can set and drops the rest", () => {
    expect(safeText("“Fellow” — élan … 日本")).toBe("\"Fellow\"  -  élan ... ");
  });

  it("binds a real packet: cover, contents, letter, an exhibit tab with a placeholder, page numbers, DRAFT stamp", async () => {
    const r = await buildPacket({
      petitionTitle: "I-140 Immigrant Petition (EB-1A)", beneficiary: "Dr. Test Client", date: "2026-09-02",
      letterMarkdown: "## INTRODUCTION\n\nThe beneficiary is elevated to IEEE Fellow (Exhibit 1).\n\n## CONCLUSION\n\nApproval is warranted.",
      exhibits: [{ exhibitNo: 1, title: "IEEE Fellow letter", filename: "fellow.txt", mime: "text/plain", bytes: new TextEncoder().encode("hello") }],
      attachments: [{ title: "Form I-140", note: "Approved." }],
      draft: true,
    });
    expect(r.draft).toBe(true);
    // cover + contents + letter page + form page + tab page + placeholder page
    expect(r.pages).toBe(6);
    expect(r.toc).toEqual([
      { label: "The petition letter", page: 3, indent: 0 },
      { label: "Form I-140", page: 4, indent: 0 },
      { label: "Exhibit 1 - IEEE Fellow letter", page: 5, indent: 1 },
    ]);
    expect(r.bytes.slice(0, 5)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
  });
});

/** A tiny in-memory Db over better-sqlite-less arrays is overkill; drive the pure name logic and the reconcile rules with a fake. */
function fakeDb(): Db & { rows: Record<string, unknown>[]; logs: string[] } {
  const rows: Record<string, unknown>[] = [];
  const logs: string[] = [];
  let n = 0;
  const db: Db & { rows: typeof rows; logs: string[] } = {
    rows, logs,
    now: () => "2026-09-02T00:00:00.000Z", id: () => `id${++n}`,
    log: (_a, s) => { logs.push(s); },
    metaGet: () => null, metaSet: () => {}, metaDelete: () => {},
    sql: <T,>(q: string, ...p: unknown[]): T[] => {
      if (q.startsWith("SELECT * FROM recommenders WHERE norm = ?")) return rows.filter(r => r.norm === p[0]) as T[];
      if (q.startsWith("SELECT * FROM recommenders WHERE id = ?")) return rows.filter(r => r.id === p[0]) as T[];
      if (q.startsWith("SELECT id FROM recommenders WHERE norm = ?")) return rows.filter(r => r.norm === p[0]).map(r => ({ id: r.id })) as T[];
      if (q.startsWith("SELECT id, norm FROM recommenders WHERE status = 'suggested'")) return rows.filter(r => r.status === "suggested").map(r => ({ id: r.id, norm: r.norm })) as T[];
      if (q.startsWith("SELECT * FROM recommenders ORDER BY")) return [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name))) as T[];
      if (q.startsWith("INSERT INTO recommenders")) {
        const [id, name, norm, title, organization, relationship, basis, status, source, entity_id, created_at, updated_at] = p;
        rows.push({ id, name, norm, title, organization, relationship, basis, status, source, entity_id, created_at, updated_at });
        return [];
      }
      if (q.startsWith("UPDATE recommenders SET title = COALESCE")) {
        const [title, organization, relationship, basis, entity_id, status, updated_at, id] = p;
        const r = rows.find(x => x.id === id)!;
        Object.assign(r, { title: title ?? r.title, organization: organization ?? r.organization, relationship: relationship ?? r.relationship, basis: basis ?? r.basis, entity_id: entity_id ?? r.entity_id, status, updated_at });
        return [];
      }
      if (q.startsWith("UPDATE recommenders SET name = ?")) {
        const [name, norm, title, organization, relationship, basis, status, updated_at, id] = p;
        const r = rows.find(x => x.id === id)!;
        Object.assign(r, { name, norm, title, organization, relationship, basis, status, updated_at });
        return [];
      }
      throw new Error(`unexpected sql in test: ${q}`);
    },
  };
  return db;
}

describe("recommenders", () => {
  it("normalizes names so 'Dr. Maria Lopez' and 'maria lopez' are one person", () => {
    expect(normName("Dr. Maria Lopez")).toBe(normName("maria  lopez"));
    expect(normName("Prof. J. Smith, PhD")).toBe("j smith");
  });

  it("reconciles against the attorney's list: named ones confirmed or added, unnamed suggestions set aside", () => {
    const db = fakeDb();
    upsertRecommender(db, { name: "Dr. Maria Lopez", organization: "IEEE" }, "firm", "suggested");
    upsertRecommender(db, { name: "Prof. Alan Turing" }, "firm", "suggested");
    const r = reconcileRecommenders(db, ["maria lopez", "Grace Hopper"]);
    expect(r).toEqual({ confirmed: 1, added: 1, declined: 1 });
    const byName = Object.fromEntries(listRecommenders(db).map(x => [x.name, x]));
    expect(byName["Dr. Maria Lopez"].status).toBe("confirmed");
    expect(byName["Dr. Maria Lopez"].organization).toBe("IEEE");
    expect(byName["Grace Hopper"].source).toBe("attorney");
    expect(byName["Prof. Alan Turing"].status).toBe("declined");
    // A later suggestion never demotes what the attorney confirmed.
    upsertRecommender(db, { name: "Maria Lopez", title: "Fellow" }, "firm", "suggested");
    expect(listRecommenders(db).find(x => x.name === "Dr. Maria Lopez")?.status).toBe("confirmed");
  });

  it("names deliverables in lawyer language and declares its tables", () => {
    expect(deliverableTitle("deliverables/timeline-of-awards.md")).toBe("timeline of awards");
    expect(FILING_SCHEMA).toContain("CREATE TABLE IF NOT EXISTS filings");
  });
});
