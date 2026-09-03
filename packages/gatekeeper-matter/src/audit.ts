// The matter's audit export (WP-16): everything a firm must be able to hand to a regulator, an
// auditor, or a departing client, as one zip the firm owns. Dependency-free: the "stored" zip
// method with a hand-written CRC-32, streamed from R2 behind a signed, time-limited link.
//
// The pure parts (the zip writer, the manifest shaping, the CSV) live here so the tests run in
// Node; the R2 and signing parts take `env`.

import type { Deadline, MatterDirective, MemoryNote, PetitionVersion } from "@gadgets/workshop-shared/legal";
import type { ActivityEntry, Decision, DocumentSummary } from "./types.js";

// ---- CRC-32 (IEEE 802.3), table driven ----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- The zip writer (stored, no compression) ------------------------------------------------------

export type ZipEntry = { name: string; data: Uint8Array; modified?: Date };

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

/**
 * A zip archive with every entry stored (method 0). Readable by every unzip tool; the entries
 * are text (JSON, CSV, markdown) and PDFs that are already compressed, so storing loses nothing.
 * Entry names are UTF-8 (general purpose bit 11 set).
 */
export function zipStored(entries: ZipEntry[], now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const { time, date } = dosDateTime(e.modified ?? now);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);        // version needed: 2.0
    lv.setUint16(6, 0x0800, true);    // flags: UTF-8 names
    lv.setUint16(8, 0, true);         // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);        // extra length
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);        // made by: 2.0
    cv.setUint16(6, 20, true);        // needed: 2.0
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);        // extra
    cv.setUint16(32, 0, true);        // comment
    cv.setUint16(34, 0, true);        // disk
    cv.setUint16(36, 0, true);        // internal attrs
    cv.setUint32(38, 0, true);        // external attrs
    cv.setUint32(42, offset, true);   // local header offset
    central.set(name, 46);
    locals.push(local, e.data);
    centrals.push(central);
    offset += local.length + e.data.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) { out.set(part, p); p += part.length; }
  return out;
}

/** Read back the central directory of an archive `zipStored` wrote (for tests and self-checks). */
export function readZipDirectory(archive: Uint8Array): { name: string; crc: number; size: number; offset: number }[] {
  const v = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocdAt = archive.length - 22;
  if (v.getUint32(eocdAt, true) !== 0x06054b50) throw new Error("Not a zip archive (no end-of-directory record).");
  const count = v.getUint16(eocdAt + 10, true);
  let p = v.getUint32(eocdAt + 16, true);
  const dec = new TextDecoder();
  const out: { name: string; crc: number; size: number; offset: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt central directory.");
    const nameLen = v.getUint16(p + 28, true);
    out.push({
      name: dec.decode(archive.subarray(p + 46, p + 46 + nameLen)),
      crc: v.getUint32(p + 16, true), size: v.getUint32(p + 20, true), offset: v.getUint32(p + 42, true),
    });
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
}

// ---- The audit manifest: what the export holds -----------------------------------------------------

export type AuditInputs = {
  matter: { id: string; title: string; clientName: string; caseType: string | null; status: string; createdAt: string; ownerUserId: string | null };
  exportedAt: string;
  exportedBy: string;
  activity: ActivityEntry[];
  decisions: Decision[];
  directives: MatterDirective[];
  memory: MemoryNote[];
  documents: (DocumentSummary & { sha256: string })[];
  deadlines: Deadline[];
  versions: PetitionVersion[];
  filings: { versionId: string; at: string; pages: number; exhibits: number; draft: boolean; packetSha256: string }[];
  forms: { code: string; title: string; status: string; fields: { name: string; label: string; value: string | null; sourceFactId: string | null; review: string | null; acceptedBy: string | null }[] }[];
  signatures: { id: string; code: string; requestedAt: string; signedAt: string | null; signedName: string | null }[];
  deskFiles: { path: string; rev: number; updatedAt: string; updatedBy: string }[];
};

export type AuditManifest = {
  format: "legal-os-audit/1";
  matter: AuditInputs["matter"];
  exportedAt: string;
  exportedBy: string;
  counts: { activity: number; decisions: number; directives: number; memory: number; documents: number; deadlines: number; versions: number; filings: number; forms: number; signatures: number; deskFiles: number };
  files: string[];
};

const AUDIT_FILES = [
  "manifest.json", "activity.json", "activity.csv", "decisions.json", "directives.json", "memory.json",
  "documents.json", "deadlines.json", "petition-versions.json", "filings.json", "forms.json",
  "signatures.json", "desk-files.json",
];

/** The manifest names every file in the archive and the counts an auditor checks first. */
export function auditManifest(inputs: AuditInputs, extraFiles: string[] = []): AuditManifest {
  return {
    format: "legal-os-audit/1",
    matter: inputs.matter,
    exportedAt: inputs.exportedAt,
    exportedBy: inputs.exportedBy,
    counts: {
      activity: inputs.activity.length, decisions: inputs.decisions.length, directives: inputs.directives.length,
      memory: inputs.memory.length, documents: inputs.documents.length, deadlines: inputs.deadlines.length,
      versions: inputs.versions.length, filings: inputs.filings.length, forms: inputs.forms.length,
      signatures: inputs.signatures.length, deskFiles: inputs.deskFiles.length,
    },
    files: [...AUDIT_FILES, ...extraFiles],
  };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

/** The activity trail as CSV: at, actor, summary. RFC 4180 quoting; UTF-8; LF line endings. */
export function activityCsv(activity: ActivityEntry[]): string {
  return ["at,actor,summary", ...activity.map(a => [a.at, a.actor, a.summary].map(csvCell).join(","))].join("\n") + "\n";
}

/** Every file of the archive from the gathered inputs; `extra` carries binary artifacts (manifests, packets). */
export function auditEntries(inputs: AuditInputs, extra: ZipEntry[] = []): ZipEntry[] {
  const enc = new TextEncoder();
  const json = (name: string, value: unknown): ZipEntry => ({ name, data: enc.encode(JSON.stringify(value, null, 2) + "\n") });
  const manifest = auditManifest(inputs, extra.map(e => e.name));
  return [
    json("manifest.json", manifest),
    json("activity.json", inputs.activity),
    { name: "activity.csv", data: enc.encode(activityCsv(inputs.activity)) },
    json("decisions.json", inputs.decisions),
    json("directives.json", inputs.directives),
    json("memory.json", inputs.memory),
    json("documents.json", inputs.documents),
    json("deadlines.json", inputs.deadlines),
    json("petition-versions.json", inputs.versions),
    json("filings.json", inputs.filings),
    json("forms.json", inputs.forms),
    json("signatures.json", inputs.signatures),
    json("desk-files.json", inputs.deskFiles),
    ...extra,
  ];
}

// ---- Signed links and the public route ------------------------------------------------------------

const AUDIT_TTL_MS = 15 * 60 * 1000;
const AUDIT_FILE = /^audit-\d{8}T\d{6}Z\.zip$/;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function auditSecret(env: Cloudflare.Env, matterId: string): string {
  return `${env.PORTAL_SECRET ?? ""}:${matterId}:legal-os-audit`;
}

/** R2 key of an audit archive under its matter. */
export function auditKey(matterId: string, file: string): string { return `matters/${matterId}/audit/${file}`; }

/** The archive's file name for an export at `at`. */
export function auditFileName(at: Date): string {
  return `audit-${at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.zip`;
}

export async function signAuditUrl(env: Cloudflare.Env, matterId: string, file: string, nowMs = Date.now()): Promise<string> {
  if (!AUDIT_FILE.test(file)) throw new Error(`Not an audit archive: ${file}`);
  const exp = String(nowMs + AUDIT_TTL_MS);
  const sig = await hmacHex(auditSecret(env, matterId), `${matterId}:${file}:${exp}`);
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/gatekeeper/matter/audit/${matterId}/${file}?exp=${exp}&sig=${sig}`;
}

async function verifyAuditSig(env: Cloudflare.Env, matterId: string, file: string, exp: string, sig: string, nowMs = Date.now()): Promise<boolean> {
  if (!AUDIT_FILE.test(file) || !/^\d+$/.test(exp) || Number(exp) < nowMs) return false;
  const expected = await hmacHex(auditSecret(env, matterId), `${matterId}:${file}:${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

const PREFIX = /^\/gatekeeper\/matter(?=\/)/;

/** GET /audit/:matterId/audit-<stamp>.zip?exp&sig streams the archive. */
export async function handleAuditRoutes(request: Request, env: Cloudflare.Env): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const m = /^\/audit\/([0-9a-f]{32})\/(audit-\d{8}T\d{6}Z\.zip)$/.exec(url.pathname.replace(PREFIX, ""));
  if (!m) return null;
  const [, matterId, file] = m;
  const exp = url.searchParams.get("exp") ?? ""; const sig = url.searchParams.get("sig") ?? "";
  if (!(await verifyAuditSig(env, matterId, file, exp, sig))) return new Response("This link has expired.", { status: 403 });
  const obj = await env.MATTER_FILES.get(auditKey(matterId, file));
  if (!obj) return new Response("Not found.", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": "application/zip", "content-length": String(obj.size), "cache-control": "private, max-age=300",
      "content-disposition": `attachment; filename="${file}"`,
    },
  });
}
