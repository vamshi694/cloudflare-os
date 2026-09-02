// The filing's integrity record: a canonical manifest of what the packet contains (the letter's
// hash, every exhibit's fingerprint, the forms), signed with the firm's Ed25519 key so a version
// downloaded today can be shown, years later, to be exactly what was filed. The key is generated
// once per deployment with WebCrypto and kept in the firm's private bucket; the public half rides
// inside every manifest and is served at /manifest-key. Also here: the signed, time-limited links
// for packets and exports (the same HMAC discipline as the document links in portal.ts).

export type ManifestExhibit = { exhibitNo: number; documentId: string; filename: string; sha256: string; bytes: number };

export type FilingManifest = {
  format: "legal-os-filing-manifest/1";
  matterId: string;
  versionId: string;
  at: string;
  petitionTitle: string;
  beneficiary: string;
  /** SHA-256 of the letter markdown the packet was rendered from. */
  letterSha256: string;
  /** SHA-256 of the packet PDF bytes. */
  packetSha256: string;
  pages: number;
  draft: boolean;
  exhibits: ManifestExhibit[];
  forms: string[];
  publicKeyJwk: JsonWebKey;
};

export type SignedManifest = { manifest: FilingManifest; canonical: string; signature: string; algorithm: "Ed25519" };

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const b of view) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return hex(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

/** JSON with keys sorted at every level, so the same manifest always signs the same bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type FirmKeyPair = { publicKeyJwk: JsonWebKey; privateKeyJwk: JsonWebKey; createdAt: string };

export async function generateFirmKeyPair(): Promise<FirmKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  return {
    publicKeyJwk: (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey,
    privateKeyJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey,
    createdAt: new Date().toISOString(),
  };
}

export async function signManifest(manifest: FilingManifest, privateKeyJwk: JsonWebKey): Promise<SignedManifest> {
  const key = await crypto.subtle.importKey("jwk", privateKeyJwk, { name: "Ed25519" }, false, ["sign"]);
  const canonical = canonicalJson(manifest);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(canonical));
  return { manifest, canonical, signature: toBase64(sig), algorithm: "Ed25519" };
}

export async function verifyManifest(signed: { canonical: string; signature: string }, publicKeyJwk: JsonWebKey): Promise<boolean> {
  const key = await crypto.subtle.importKey("jwk", publicKeyJwk, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "Ed25519" }, key, fromBase64(signed.signature) as BufferSource, new TextEncoder().encode(signed.canonical));
}

const FIRM_KEY_R2 = "firm/keys/ed25519.json";
let keyCache: FirmKeyPair | null = null;

/**
 * The firm's signing key, created on first use. Two isolates racing on first use could each
 * generate one; the one that lands last wins and every manifest carries its own public key, so a
 * signature always verifies against the key inside the manifest it signs.
 */
export async function firmKeyPair(env: Cloudflare.Env): Promise<FirmKeyPair> {
  if (keyCache) return keyCache;
  const existing = await env.MATTER_FILES.get(FIRM_KEY_R2);
  if (existing) {
    keyCache = await existing.json<FirmKeyPair>();
    return keyCache;
  }
  const fresh = await generateFirmKeyPair();
  await env.MATTER_FILES.put(FIRM_KEY_R2, JSON.stringify(fresh), { httpMetadata: { contentType: "application/json" } });
  const stored = await env.MATTER_FILES.get(FIRM_KEY_R2);
  keyCache = stored ? await stored.json<FirmKeyPair>() : fresh;
  return keyCache;
}

// ---- signed links for packets and exports -----------------------------------------------------

const ARTIFACT_TTL_MS = 15 * 60 * 1000;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function artifactSecret(env: Cloudflare.Env, matterId: string): string {
  return `${env.PORTAL_SECRET ?? ""}:${matterId}:legal-os-artifact`;
}

/** Only these subtrees of a matter's bucket prefix are ever linked publicly. */
export const ARTIFACT_PATH = /^(filings\/[0-9a-f]{32}\/(packet\.pdf|manifest\.json|letter\.docx)|exports\/[A-Za-z0-9._-]{1,120}\.docx)$/;

/** R2 key of an artifact under its matter. */
export function artifactKey(matterId: string, path: string): string { return `matters/${matterId}/${path}`; }

export async function signArtifactUrl(env: Cloudflare.Env, matterId: string, path: string, nowMs = Date.now()): Promise<string> {
  if (!ARTIFACT_PATH.test(path)) throw new Error(`Not a linkable artifact: ${path}`);
  const exp = String(nowMs + ARTIFACT_TTL_MS);
  const sig = await hmacHex(artifactSecret(env, matterId), `${matterId}:${path}:${exp}`);
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/gatekeeper/matter/artifact/${matterId}/${path}?exp=${exp}&sig=${sig}`;
}

export async function verifyArtifactSig(env: Cloudflare.Env, matterId: string, path: string, exp: string, sig: string, nowMs = Date.now()): Promise<boolean> {
  if (!ARTIFACT_PATH.test(path) || !/^\d+$/.test(exp) || Number(exp) < nowMs) return false;
  const expected = await hmacHex(artifactSecret(env, matterId), `${matterId}:${path}:${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ---- public routes: signed artifact links and the firm's public key --------------------------------

const PREFIX = /^\/gatekeeper\/matter(?=\/)/;

/** GET /artifact/:matterId/<path>?exp&sig streams a packet or export; GET /manifest-key serves the public key. */
export async function handleFilingRoutes(request: Request, env: Cloudflare.Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(PREFIX, "");
  if (request.method !== "GET") return null;
  if (path === "/manifest-key") {
    const keys = await firmKeyPair(env);
    return new Response(JSON.stringify({ algorithm: "Ed25519", publicKeyJwk: keys.publicKeyJwk, createdAt: keys.createdAt }, null, 2),
      { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
  }
  const m = /^\/artifact\/([0-9a-f]{32})\/(.+)$/.exec(path);
  if (!m) return null;
  const [, matterId, artifactPath] = m;
  const exp = url.searchParams.get("exp") ?? ""; const sig = url.searchParams.get("sig") ?? "";
  if (!(await verifyArtifactSig(env, matterId, artifactPath, exp, sig))) return new Response("This link has expired.", { status: 403 });
  const obj = await env.MATTER_FILES.get(artifactKey(matterId, artifactPath));
  if (!obj) return new Response("Not found.", { status: 404 });
  const name = artifactPath.split("/").pop() ?? "download";
  const type = name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".json") ? "application/json; charset=utf-8"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return new Response(obj.body, {
    headers: {
      "content-type": type, "content-length": String(obj.size), "cache-control": "private, max-age=300",
      "content-disposition": `${name.endsWith(".pdf") ? "inline" : "attachment"}; filename="${name}"`,
    },
  });
}
