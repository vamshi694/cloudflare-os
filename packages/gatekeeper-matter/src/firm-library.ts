// The firm's method, reached over the FIRM_LIBRARY service binding to the firm gatekeeper's
// FirmLibraryApi entrypoint. Every read here is best effort: a missing binding (tests, a dev run
// without the firm worker) or a hiccup falls back to the case-type catalog, and the caller says
// nothing about the playbook rather than something wrong.

import type { CaseTypeSpec } from "@gadgets/workshop-shared/legal";

export type FirmGuidance = { key: string; title: string; heading: string; guidance: string };
export type FirmRule = { slug: string; rule: string; why: string | null };
export type FirmLibraryEntry = {
  slug: string; title: string; category: "firm" | "case-type" | "work-type" | "reference"; scope: string;
  description: string; layer: "firm" | "personal"; updatedAt: string;
};

/** The shape of the FirmLibraryApi entrypoint (custom-gatekeeper/src/firm-library-api.ts), structurally. */
export interface FirmLibraryBinding {
  list(layer?: string): Promise<FirmLibraryEntry[]>;
  read(slug: string, layer?: string): Promise<{ slug: string; title: string; markdown: string; layer: "firm" | "personal" } | null>;
  cartridge(caseType: string, layer?: string): Promise<string>;
  criteriaGuidance(caseType: string, sections: { key: string; title: string }[], layer?: string): Promise<FirmGuidance[]>;
  sectionPlan(caseType: string, layer?: string): Promise<string[] | null>;
  rules(scope: string, layer?: string): Promise<FirmRule[]>;
  method(caseType: string | null, layer?: string): Promise<{ documents: FirmLibraryEntry[]; rules: FirmRule[] }>;
  rememberRule(scope: string, rule: string, rationale: string, by: string, layer?: string): Promise<{ slug: string }>;
  exemplars(caseType: string, section?: { title: string } | null, limit?: number): Promise<FirmExemplar[]>;
}

/** A passage from one of the firm's past filings that argued a criterion (WP-14). */
export type FirmExemplar = { precedentSlug: string; precedentTitle: string; caseType: string; outcome: string | null; heading: string; passage: string };

type Env = { FIRM_LIBRARY?: FirmLibraryBinding };

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Forget cached reads (after the firm learned a rule, so the next readiness read shows it). */
export function forgetFirmCache(): void { cache.clear(); }

async function quiet<T>(label: string, fallback: T, load: () => Promise<T>): Promise<T> {
  try { return await load(); }
  catch (error) {
    console.warn(`[firm-library] ${label} unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
}

/** Per-section guidance from the playbook, keyed by section key. Empty when the firm has none. */
export async function firmGuidance(env: Env, spec: CaseTypeSpec | null): Promise<Map<string, FirmGuidance>> {
  const lib = env.FIRM_LIBRARY;
  if (!lib || !spec) return new Map();
  const sections = spec.sections.filter(s => s.evidentiary).map(s => ({ key: s.key, title: s.title }));
  const rows = await quiet("criteriaGuidance", [] as FirmGuidance[], () =>
    cached(`guidance:${spec.key}`, () => lib.criteriaGuidance(spec.key, sections)));
  return new Map(rows.map(g => [g.key, g]));
}

/** The letter's section order from the style guide, or null. */
export async function firmSectionPlan(env: Env, spec: CaseTypeSpec | null): Promise<string[] | null> {
  const lib = env.FIRM_LIBRARY;
  if (!lib || !spec) return null;
  return quiet("sectionPlan", null as string[] | null, () => cached(`plan:${spec.key}`, () => lib.sectionPlan(spec.key)));
}

export async function firmRules(env: Env, scope: string): Promise<FirmRule[]> {
  const lib = env.FIRM_LIBRARY;
  if (!lib) return [];
  return quiet("rules", [] as FirmRule[], () => cached(`rules:${scope}`, () => lib.rules(scope)));
}

export async function firmMethod(env: Env, caseType: string | null): Promise<{ documents: FirmLibraryEntry[]; rules: FirmRule[] } | null> {
  const lib = env.FIRM_LIBRARY;
  if (!lib) return null;
  return quiet("method", null, () => lib.method(caseType));
}

/** Record a standing rule in the firm's method. Returns null when the firm library is unreachable. */
export async function firmRemember(env: Env, scope: string, rule: string, rationale: string, by: string): Promise<{ slug: string } | null> {
  const lib = env.FIRM_LIBRARY;
  if (!lib) return null;
  const r = await quiet("rememberRule", null as { slug: string } | null, () => lib.rememberRule(scope, rule, rationale, by));
  forgetFirmCache();
  return r;
}

/**
 * The letter's section order: the style guide's plan when it defines one (with "criteria" standing
 * for every evidentiary section, strongest first by the evidence verdict), else the catalog order.
 */
export function orderSections(spec: CaseTypeSpec, plan: string[] | null, evidenceRank: (key: string) => number): CaseTypeSpec["sections"] {
  if (!plan) return spec.sections;
  const byKey = new Map(spec.sections.map(s => [s.key, s]));
  const evidentiary = spec.sections.filter(s => s.evidentiary).slice().sort((a, b) => evidenceRank(a.key) - evidenceRank(b.key));
  const out: CaseTypeSpec["sections"] = [];
  const seen = new Set<string>();
  for (const key of plan) {
    if (key === "criteria") { for (const s of evidentiary) if (!seen.has(s.key)) { out.push(s); seen.add(s.key); } }
    else { const s = byKey.get(key); if (s && !seen.has(key)) { out.push(s); seen.add(key); } }
  }
  for (const s of spec.sections) if (!seen.has(s.key)) out.push(s);
  return out;
}

/** The firm's past-filing passages for a section of this case type, best two first. Empty without the firm or precedents. */
export async function firmExemplars(env: Env, caseType: string | null, sectionTitle: string | null): Promise<FirmExemplar[]> {
  const lib = env.FIRM_LIBRARY;
  if (!lib || !caseType) return [];
  return quiet("exemplars", [] as FirmExemplar[], () =>
    cached(`exemplars:${caseType}:${sectionTitle ?? ""}`, () => lib.exemplars(caseType, sectionTitle ? { title: sectionTitle } : null, 2)));
}
