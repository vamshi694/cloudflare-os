// The worker's public routes: the client portal (token-addressed, no session) and the signed
// file route the DocViewer opens. The router forwards ocios.app/gatekeeper/matter/* here with the
// path unchanged, so every route matches with and without that prefix.

import type { MatterStore } from "./store.js";

const PREFIX = /^\/gatekeeper\/matter(?=\/)/;
const FILE_TTL_MS = 15 * 60 * 1000;
const MAX_PORTAL_UPLOAD = 100 * 1024 * 1024;

function storeFor(env: Cloudflare.Env, matterId: string): DurableObjectStub<MatterStore> {
  return env.MATTER_STORE.get(env.MATTER_STORE.idFromName(matterId));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return [...sig].map(b => b.toString(16).padStart(2, "0")).join("");
}

function fileSecret(env: Cloudflare.Env, matterId: string): string {
  return `${env.PORTAL_SECRET ?? ""}:${matterId}:legal-os-file`;
}

/** A signed, time-limited URL for a document's original bytes. Relative when no public base is set. */
export async function signFileUrl(env: Cloudflare.Env, matterId: string, documentId: string, nowMs = Date.now()): Promise<string> {
  const exp = String(nowMs + FILE_TTL_MS);
  const sig = await hmac(fileSecret(env, matterId), `${matterId}:${documentId}:${exp}`);
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/gatekeeper/matter/file/${matterId}/${documentId}?exp=${exp}&sig=${sig}`;
}

export async function verifyFileSig(env: Cloudflare.Env, matterId: string, documentId: string, exp: string, sig: string, nowMs = Date.now()): Promise<boolean> {
  if (!/^\d+$/.test(exp) || Number(exp) < nowMs) return false;
  const expected = await hmac(fileSecret(env, matterId), `${matterId}:${documentId}:${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/** A signed, time-limited URL for a rendered government form (see forms-pdf.ts handleFormRoutes). */
export async function signFormUrl(env: Cloudflare.Env, matterId: string, code: string, nowMs = Date.now()): Promise<string> {
  const exp = String(nowMs + FILE_TTL_MS);
  const sig = await hmac(fileSecret(env, matterId), `${matterId}:form:${code}:${exp}`);
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/gatekeeper/matter/form/${matterId}/${encodeURIComponent(code)}.pdf?exp=${exp}&sig=${sig}`;
}

export async function verifyFormSig(env: Cloudflare.Env, matterId: string, code: string, exp: string, sig: string, nowMs = Date.now()): Promise<boolean> {
  if (!/^\d+$/.test(exp) || Number(exp) < nowMs) return false;
  const expected = await hmac(fileSecret(env, matterId), `${matterId}:form:${code}:${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

const TOKEN = /^[0-9a-f]{32}$/;
const ID = /^[0-9a-f]{32}$/;

/** Resolve a portal token: the first 32 hex characters are the matter id, the rest the secret the matter minted. */
async function matterForToken(env: Cloudflare.Env, matterId: string, token: string): Promise<DurableObjectStub<MatterStore> | null> {
  if (!ID.test(matterId) || !TOKEN.test(token)) return null;
  const store = storeFor(env, matterId);
  return (await store.portalTokenValid(token)) ? store : null;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Handle a public route, or return null when the path is not one of ours. */
export async function handlePublic(request: Request, env: Cloudflare.Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(PREFIX, "");

  const file = /^\/file\/([0-9a-f]{32})\/([0-9a-f]{32})$/.exec(path);
  if (file && request.method === "GET") {
    const [, matterId, documentId] = file;
    const exp = url.searchParams.get("exp") ?? ""; const sig = url.searchParams.get("sig") ?? "";
    if (!(await verifyFileSig(env, matterId, documentId, exp, sig))) return new Response("This link has expired.", { status: 403 });
    const info = await storeFor(env, matterId).fileInfo(documentId);
    if (!info) return new Response("Not found.", { status: 404 });
    const obj = await env.MATTER_FILES.get(info.r2Key);
    if (!obj) return new Response("The file is missing from storage.", { status: 404 });
    return new Response(obj.body, {
      headers: {
        "content-type": info.mime, "content-length": String(obj.size), "cache-control": "private, max-age=300",
        "content-disposition": `inline; filename="${info.filename.replace(/["\r\n]/g, "")}"`,
      },
    });
  }

  // Portal routes: /portal/<64 hex: matter id + secret>[/upload|/words|/reply|/sign|/forms/<id>.pdf].
  const portal = /^\/portal\/([0-9a-f]{32})([0-9a-f]{32})(\/upload|\/words|\/reply|\/sign|\/forms\/[0-9a-f]{32}\.pdf)?$/.exec(path);
  if (!portal) return null;
  const [, matterId, token, action] = portal;
  const store = await matterForToken(env, matterId, token);
  if (!store) return json({ error: "This link isn't valid." }, 404);

  if (!action && request.method === "GET") {
    await store.touchPortal();
    return json(await store.portalView());
  }
  // The filled form the client reviews before signing: the client never signs what they could not read.
  if (action?.startsWith("/forms/") && request.method === "GET") {
    const id = action.slice("/forms/".length, -".pdf".length);
    const sig = await store.signatureRender(id);
    if (!sig) return new Response("This form is no longer waiting for a signature.", { status: 404 });
    const obj = await env.MATTER_FILES.get(sig.renderKey);
    if (!obj) return new Response("The form could not be found. Your legal team has been told.", { status: 404 });
    return new Response(obj.body, { headers: { "content-type": "application/pdf", "cache-control": "private, no-store", "content-disposition": `inline; filename="${sig.code}.pdf"` } });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (action === "/sign") {
    const body = await request.json().catch(() => ({})) as { id?: unknown; name?: unknown };
    if (typeof body.id !== "string" || !/^[0-9a-f]{32}$/.test(body.id)) return json({ error: "Which form?" }, 400);
    if (typeof body.name !== "string" || body.name.trim().length < 3) return json({ error: "Type your full legal name to sign." }, 400);
    try {
      await store.signForm(body.id, body.name);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "That signature was not recorded." }, 409);
    }
    return json({ ok: true, signedAt: new Date().toISOString() });
  }

  if (action === "/upload") {
    const form = await request.formData();
    const received: { id: string; name: string }[] = [];
    for (const entry of form.getAll("file")) {
      if (!(entry instanceof File)) continue;
      if (entry.size > MAX_PORTAL_UPLOAD) return json({ error: `"${entry.name}" is larger than the 100 MB limit.` }, 413);
      const bytes = await entry.arrayBuffer();
      const name = entry.name.replace(/[\r\n\\/]/g, "_").slice(0, 200) || "document";
      const id = crypto.randomUUID().replace(/-/g, "");
      const r2Key = `matters/${matterId}/docs/${id}/${name}`;
      await env.MATTER_FILES.put(r2Key, bytes, { httpMetadata: { contentType: entry.type || "application/octet-stream" } });
      const r = await store.registerUpload({ filename: name, mime: entry.type || "application/octet-stream", bytes: bytes.byteLength, sha256: await sha256Hex(bytes), r2Key, uploadedBy: "client" });
      received.push({ id: r.id, name });
    }
    return json({ received });
  }
  const body = await request.json().catch(() => ({})) as { text?: unknown; body?: unknown };
  if (action === "/words") {
    if (typeof body.text !== "string" || !body.text.trim()) return json({ error: "Nothing to share." }, 400);
    await store.addSubmission(body.text.slice(0, 20_000));
    return json({ ok: true });
  }
  if (action === "/reply") {
    if (typeof body.body !== "string" || !body.body.trim()) return json({ error: "A message needs words." }, 400);
    const m = await store.sendMessage(body.body.slice(0, 5000), null, "client");
    return json({ id: m.id, at: m.at });
  }
  return null;
}
