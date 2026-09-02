// The petition's model-facing and document-facing work: the quote verifier around a section
// write, the letter export in the filing frame, and the adversarial RFE read. The store calls
// these with its database and its text loader; nothing here reaches storage on its own.

import type { CaseTypeSpec } from "@gadgets/workshop-shared/legal";
import { petitionTitleFor } from "./case-types.js";
import { citedExhibitNumbers, verifyQuotes, type QuoteCheck } from "./rules.js";
import { assignExhibits, writeSection } from "./store-petition.js";
import { parseJson, type Db } from "./store-db.js";

export type TextLoader = (documentId: string) => Promise<string | undefined>;

/** Land a draft: number the cited documents as exhibits, verify every quoted span, then store. */
export async function writeWithVerification(db: Db, key: string, title: string, body: string, citedFactIds: string[], loadText: TextLoader): Promise<{ version: number; unverifiedQuotes: number }> {
  const ids = [...new Set(citedFactIds)];
  const facts = ids.length
    ? db.sql<{ id: string; quote: string; document_id: string }>(`SELECT id, quote, document_id FROM facts WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids)
    : [];
  // Exhibits in order of first citation, so the numbering reads like the letter.
  const orderedDocs: string[] = [];
  for (const id of ids) { const f = facts.find(x => x.id === id); if (f && !orderedDocs.includes(f.document_id)) orderedDocs.push(f.document_id); }
  const numbers = assignExhibits(db, orderedDocs);
  const cited = [...new Set([...citedExhibitNumbers(body), ...orderedDocs.map(d => numbers.get(d)!)])];
  const docByNo = new Map<number, string>();
  for (const r of db.sql<{ id: string; exhibit_no: number }>("SELECT id, exhibit_no FROM documents WHERE exhibit_no IS NOT NULL")) docByNo.set(r.exhibit_no, r.id);
  const texts = new Map<number, string | undefined>();
  for (const n of cited) {
    const doc = docByNo.get(n);
    texts.set(n, doc ? await loadText(doc) : undefined);
  }
  const unverified: QuoteCheck[] = verifyQuotes(body, facts.map(f => f.quote), texts, cited);
  const { version } = writeSection(db, key, body, ids, unverified, title);
  return { version, unverifiedQuotes: unverified.length };
}

/** The whole letter as one markdown document in the filing frame the export renders. */
export function letterMarkdown(db: Db, spec: CaseTypeSpec | null, clientName: string, today: string): string {
  const rows = new Map(db.sql<{ key: string; body: string; status: string }>("SELECT key, body, status FROM sections").map(r => [r.key, r]));
  const parts: string[] = [
    "[LETTERHEAD]", "", today, "", "U.S. Citizenship and Immigration Services", "[SERVICE CENTER ADDRESS]", "",
    `**Re: ${petitionTitleFor(spec?.key ?? null)}**`, `Petitioner / Beneficiary: ${clientName}`, "", "Dear Sir or Madam:", "",
  ];
  for (const s of spec?.sections ?? []) {
    const r = rows.get(s.key);
    if (!r || r.status !== "drafted" || !r.body.trim()) continue;
    const body = r.body.replace(new RegExp(`^#+\\s*${s.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n`, "i"), "");
    parts.push(`## ${s.title.toUpperCase()}`, "", body.trim(), "");
  }
  parts.push("Should additional information be required, please do not hesitate to contact my office.", "", "Sincerely,", "", "[ATTORNEY NAME]", "Counsel for the Petitioner");
  return parts.join("\n");
}

type RfeResult = {
  risk: "high" | "medium" | "low"; summary: string;
  issues: { severity: "high" | "medium" | "low"; section: string; issue: string; uscisWouldAsk: string; fix: string }[];
  cached: boolean;
};

const RFE_SYSTEM = `You are a senior USCIS adjudicator reviewing an immigration petition letter as filed. Read as the officer will: skeptical, regulation-first, looking for unsupported assertions, missing criteria, weak evidence, and internal contradictions.
Return ONLY a JSON object: {"risk":"high|medium|low","summary":"<two sentences>","issues":[{"severity":"high|medium|low","section":"<section title>","issue":"<what an officer would seize on>","uscisWouldAsk":"<the RFE language they would use>","fix":"<what the firm should add or change>"}]}
If the letter reads airtight, return an empty issues array and risk "low".`;

async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function simulateRfe(db: Db, env: Cloudflare.Env, spec: CaseTypeSpec | null, letter: string): Promise<RfeResult> {
  const key = await digest(letter);
  const cached = parseJson<{ key: string; result: RfeResult } | null>(db.metaGet("rfe_cache"), null);
  if (cached && cached.key === key) return { ...cached.result, cached: true };
  if (!letter.trim() || !db.sql("SELECT 1 FROM sections WHERE status = 'drafted' LIMIT 1").length) {
    return { risk: "high", summary: "Nothing is drafted yet, so there is no letter for an adjudicator to read.", issues: [], cached: false };
  }
  const out = await env.AI.run((env.READER_MODEL || "@cf/zai-org/glm-5.3-flash") as Parameters<Ai["run"]>[0], {
    messages: [
      { role: "system", content: RFE_SYSTEM },
      { role: "user", content: `Classification: ${spec?.title ?? "unknown"}.\n\n<letter>\n${letter}\n</letter>` },
    ],
    max_tokens: 4096,
    response_format: { type: "json_object" },
  }) as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  const raw = typeof out.response === "string" ? out.response
    : typeof out.choices?.[0]?.message?.content === "string" ? out.choices[0].message.content : JSON.stringify(out);
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  let parsed: Partial<RfeResult> = {};
  try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { throw new Error("The adjudicator's read did not come back in a usable form. Try again."); }
  const sev = (x: unknown): "high" | "medium" | "low" => x === "high" || x === "medium" || x === "low" ? x : "medium";
  const result: RfeResult = {
    risk: sev(parsed.risk), summary: typeof parsed.summary === "string" ? parsed.summary : "",
    issues: (Array.isArray(parsed.issues) ? parsed.issues : []).map(i => ({
      severity: sev(i.severity), section: String(i.section ?? ""), issue: String(i.issue ?? ""),
      uscisWouldAsk: String(i.uscisWouldAsk ?? ""), fix: String(i.fix ?? ""),
    })),
    cached: false,
  };
  db.metaSet("rfe_cache", JSON.stringify({ key, result }));
  db.log("agent", `Simulated the RFE an adjudicator would send: ${result.risk} risk, ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}.`);
  return result;
}
