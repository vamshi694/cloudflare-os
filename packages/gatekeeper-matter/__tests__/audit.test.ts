import { describe, expect, it } from "vitest";
import { crc32 as nodeCrc32 } from "node:zlib";
import { activityCsv, auditEntries, auditFileName, auditManifest, crc32, readZipDirectory, zipStored, type AuditInputs } from "../src/audit.js";
import { findConflicts, namesMatch, normalizeName } from "../src/conflicts.js";

const enc = new TextEncoder();

describe("crc32", () => {
  it("matches the known vector and Node's implementation", () => {
    const fox = enc.encode("The quick brown fox jumps over the lazy dog");
    expect(crc32(fox)).toBe(0x414fa339);
    expect(crc32(enc.encode(""))).toBe(0);
    const bytes = enc.encode("Legal OS audit export, with unicode: Ünïcødé ✓");
    expect(crc32(bytes)).toBe(nodeCrc32(bytes) >>> 0);
  });
});

describe("zipStored", () => {
  it("writes a directory that reads back with the right names, sizes, CRCs and offsets", () => {
    const entries = [
      { name: "manifest.json", data: enc.encode("{\"format\":\"legal-os-audit/1\"}\n") },
      { name: "activity.csv", data: enc.encode("at,actor,summary\n2026-09-02T00:00:00Z,lawyer,Opened\n") },
      { name: "filings/abc/manifest.json", data: enc.encode("{}") },
    ];
    const archive = zipStored(entries, new Date("2026-09-02T12:34:56Z"));
    // Local header signature first, end-of-directory last.
    expect(Array.from(archive.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(archive.subarray(archive.length - 22, archive.length - 18))).toEqual([0x50, 0x4b, 0x05, 0x06]);
    const dir = readZipDirectory(archive);
    expect(dir.map(d => d.name)).toEqual(entries.map(e => e.name));
    for (const [i, d] of dir.entries()) {
      expect(d.size).toBe(entries[i].data.length);
      expect(d.crc).toBe(nodeCrc32(entries[i].data) >>> 0);
      // The local header at the recorded offset carries the same name and the stored data follows it.
      const v = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
      expect(v.getUint32(d.offset, true)).toBe(0x04034b50);
      const nameLen = v.getUint16(d.offset + 26, true);
      const data = archive.subarray(d.offset + 30 + nameLen, d.offset + 30 + nameLen + d.size);
      expect(Array.from(data)).toEqual(Array.from(entries[i].data));
    }
    // Total size is exactly headers + data + directory + EOCD.
    const expected = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length + 46 + e.name.length, 0) + 22;
    expect(archive.length).toBe(expected);
  });

  it("handles an empty archive", () => {
    const archive = zipStored([]);
    expect(archive.length).toBe(22);
    expect(readZipDirectory(archive)).toEqual([]);
  });
});

const inputs: AuditInputs = {
  matter: { id: "m1", title: "Dr. Test Client EB-1A", clientName: "Dr. Test Client", caseType: "EB1A", status: "open", createdAt: "2026-09-02T09:00:00Z", ownerUserId: "vamshi" },
  exportedAt: "2026-09-02T15:00:00Z",
  exportedBy: "vamshi",
  activity: [{ at: "2026-09-02T09:00:00Z", actor: "lawyer", summary: "Opened the matter \"Dr. Test Client EB-1A\" for Dr. Test Client." }, { at: "2026-09-02T09:05:00Z", actor: "system", summary: "The record settled: 7 documents read, 0 empty, 1 unreadable." }],
  decisions: [{ id: "d1", question: "Exclude award-letter.pdf?", options: ["Exclude it", "Keep it"], status: "answered", answer: "Exclude it", raisedAt: "2026-09-02T10:00:00Z", answeredAt: "2026-09-02T10:05:00Z" }],
  directives: [], memory: [],
  documents: [{ id: "doc1", filename: "cv.txt", displayTitle: "CV", docType: "cv", mime: "text/plain", bytes: 927, pageCount: 1, status: "ready", uploadedBy: "lawyer", relevance: "included", factCount: 12, exhibitNo: 1, note: null, uploadedAt: "2026-09-02T09:01:00Z", sha256: "ab".repeat(32) }],
  deadlines: [], versions: [], filings: [], forms: [], signatures: [],
  deskFiles: [{ path: "plan.md", rev: 2, updatedAt: "2026-09-02T11:00:00Z", updatedBy: "agent" }],
};

describe("audit manifest", () => {
  it("names every file and counts every list", () => {
    const m = auditManifest(inputs, ["filings/v1/manifest.json"]);
    expect(m.format).toBe("legal-os-audit/1");
    expect(m.counts).toEqual({ activity: 2, decisions: 1, directives: 0, memory: 0, documents: 1, deadlines: 0, versions: 0, filings: 0, forms: 0, signatures: 0, deskFiles: 1 });
    expect(m.files).toContain("manifest.json");
    expect(m.files).toContain("activity.csv");
    expect(m.files[m.files.length - 1]).toBe("filings/v1/manifest.json");
    expect(m.matter.ownerUserId).toBe("vamshi");
  });

  it("builds the archive entries with the manifest first and the extras last", () => {
    const entries = auditEntries(inputs, [{ name: "filings/v1/manifest.json", data: enc.encode("{}") }]);
    expect(entries[0].name).toBe("manifest.json");
    expect(entries[entries.length - 1].name).toBe("filings/v1/manifest.json");
    const manifest = JSON.parse(new TextDecoder().decode(entries[0].data));
    expect(manifest.files).toContain("filings/v1/manifest.json");
    const archive = zipStored(entries);
    expect(readZipDirectory(archive).map(d => d.name)).toEqual(entries.map(e => e.name));
  });

  it("quotes CSV cells that carry commas, quotes or newlines", () => {
    const csv = activityCsv(inputs.activity);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("at,actor,summary");
    expect(lines[1]).toBe("2026-09-02T09:00:00Z,lawyer,\"Opened the matter \"\"Dr. Test Client EB-1A\"\" for Dr. Test Client.\"");
    expect(lines[2]).toBe("2026-09-02T09:05:00Z,system,\"The record settled: 7 documents read, 0 empty, 1 unreadable.\"");
  });

  it("names the archive by its UTC stamp", () => {
    expect(auditFileName(new Date("2026-09-02T15:04:05.123Z"))).toBe("audit-20260902T150405Z.zip");
  });
});

describe("conflict check", () => {
  const matters = [
    { matterId: "m1", title: "Dr. Anand Rao EB-1A", clientName: "Dr. Anand Rao", ownerUserId: "vamshi",
      entities: [{ name: "Institute of Electrical and Electronics Engineers", kind: "organization" }, { name: "Stanford University", kind: "organization" }] },
    { matterId: "m2", title: "Binding check EB-1A", clientName: "Test Client", ownerUserId: null,
      entities: [{ name: "Acme Robotics Laboratory", kind: "organization" }] },
  ];

  it("normalizes case, punctuation, accents and honorifics", () => {
    expect(normalizeName("Dr. Anand Rao, Ph.D.")).toEqual(["anand", "rao"]);
    expect(normalizeName("José Núñez")).toEqual(["jose", "nunez"]);
    expect(normalizeName("The IEEE")).toEqual(["ieee"]);
  });

  it("matches full names, partial distinctive names, and the other way round", () => {
    expect(namesMatch("Anand Rao", "Dr. Anand Rao")).toBe(true);
    expect(namesMatch("Rao", "Dr. Anand Rao")).toBe(false);          // three letters: not distinctive
    expect(namesMatch("Anand", "Dr. Anand Rao")).toBe(true);
    expect(namesMatch("Dr. Anand Rao and family", "Anand Rao")).toBe(true);
    expect(namesMatch("Dr.", "Dr. Anand Rao")).toBe(false);
    expect(namesMatch("Priya Nair", "Dr. Anand Rao")).toBe(false);
  });

  it("finds hits on the client, the title, and case-map entities, with the role named", () => {
    const hits = findConflicts(["Anand Rao", "Acme Robotics"], matters);
    expect(hits.map(h => [h.matterId, h.role, h.query])).toEqual([
      ["m1", "client", "Anand Rao"], ["m1", "title", "Anand Rao"], ["m2", "organization", "Acme Robotics"],
    ]);
    expect(hits[2].matched).toBe("Acme Robotics Laboratory");
    expect(hits[0].ownerUserId).toBe("vamshi");
  });

  it("can exclude the matter being checked, and ignores blank queries", () => {
    expect(findConflicts(["Anand Rao"], matters, { excludeMatterId: "m1" })).toEqual([]);
    expect(findConflicts(["", "   "], matters)).toEqual([]);
  });
});
