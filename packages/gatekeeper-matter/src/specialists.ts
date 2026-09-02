// The counsel's specialists: the roster Ellis ran under its lead counsel, rebuilt on the agent
// spawner. This module is pure: it composes the brief a spawned specialist starts from, in the
// house register, with the scope's facts (exhibit numbers included), the playbook passage, the
// attorney's guidance and standing rules, and the exact calls that land the work. The store reads
// the context; matter.ts hands the brief to the counsel; the counsel spawns.

export type SpecialistRole = "gap_analyst" | "drafter" | "officer" | "forms_filler" | "letter_writer";

export const SPECIALIST_ROLES: SpecialistRole[] = ["gap_analyst", "drafter", "officer", "forms_filler", "letter_writer"];

export type BriefFact = {
  id: string;
  exhibitNo: number | null;
  documentTitle: string;
  page: number | null;
  statement: string;
  quote: string;
};

export type BriefSection = {
  key: string;
  title: string;
  criterion: string;
  purpose: string;
  status: string;
  draft: string;
  weaknesses: { severity: string; issue: string; fix: string }[];
  unverifiedQuotes: string[];
  guidance: string | null;
  evidence: string;
  stillNeeded: string[];
};

export type SpecialistScope =
  | { kind: "matter" }
  | { kind: "section"; key: string }
  | { kind: "letter" }
  | { kind: "form"; code: string }
  | { kind: "recommender"; id: string };

export type SpecialistContext = {
  matterTitle: string;
  clientName: string;
  caseType: string | null;
  petitionTitle: string | null;
  scope: SpecialistScope;
  /** The section in scope, or every section for the whole letter. */
  sections: BriefSection[];
  /** Facts the specialist may quote, with the exhibit each rests in. */
  facts: BriefFact[];
  /** The playbook's passage for the scope, when the firm wrote one. */
  style: string | null;
  /** Standing rules for this case type and the firm. */
  rules: { rule: string; why: string | null }[];
  /** The attorney's directives on this matter. */
  directives: string[];
  /** The form in scope, when any. */
  form: { code: string; title: string; fields: { name: string; label: string; value: string | null }[] } | null;
  /** The recommender in scope, when any. */
  recommender: { id: string; name: string; title: string | null; organization: string | null; relationship: string | null; basis: string | null } | null;
  /** What the counsel asked for, in its words (an attorney instruction, a reviewer note). */
  instruction: string | null;
};

/** The desk file a specialist writes its work product to; also the "not twice" guard's key. */
export function delegationPath(role: SpecialistRole, scope: SpecialistScope): string {
  const name = role.replace(/_/g, "-");
  const key = scope.kind === "matter" ? "matter"
    : scope.kind === "section" ? scope.key
    : scope.kind === "letter" ? "letter"
    : scope.kind === "form" ? scope.code.toLowerCase()
    : scope.id;
  return `delegations/${name}-${key.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.md`;
}

/**
 * True when a specialist for this role and scope is already at work: its desk file exists and was
 * touched inside the window. The counsel must not brief the same specialist twice on the same job.
 */
export function specialistRunning(
  deskFiles: { path: string; updatedAt: string }[], role: SpecialistRole, scope: SpecialistScope,
  now: Date, windowMs = 30 * 60 * 1000,
): boolean {
  const path = delegationPath(role, scope);
  const file = deskFiles.find(f => f.path === path);
  if (!file) return false;
  const age = now.getTime() - Date.parse(file.updatedAt);
  if (!Number.isFinite(age)) return false;
  return age >= 0 && age < windowMs;
}

const ROLE_TITLE: Record<SpecialistRole, string> = {
  gap_analyst: "Gap analyst",
  drafter: "Drafter",
  officer: "Officer's review",
  forms_filler: "Forms filler",
  letter_writer: "Letter writer",
};

const DOCTRINE: Record<SpecialistRole, string> = {
  gap_analyst:
    "You are the firm's gap analyst on this matter. Your job is one thing: say, criterion by criterion, what the record proves, what it lacks, and what the client must send to close each gap. Judge only from the facts below and the readiness verdict. The readiness verdict is the firm's evidence ruling, never second guess it with a count of your own. Write the asks in plain words a client can act on (what document, from whom, showing what).",
  drafter:
    "You are the firm's drafter for one section of the petition letter. Write the section as the firm's petition style says, from the facts below and nothing else. Every quoted phrase must be the verbatim words of a fact. Cite exhibits as \"Exhibit N\" using the numbers given. Argue the criterion, do not summarize the record. When the counsel's instruction below names a change, make exactly that change and keep the rest.",
  officer:
    "You are the adjudicating officer reading this letter as USCIS will. Read every drafted section for the point an officer would seize on: an unsupported claim, a quote that does not say what the letter says it says, a criterion argued with the wrong kind of evidence, a comparison that proves nothing. For each, state the weakness, its severity, and the fix a drafter can execute in one pass.",
  forms_filler:
    "You are the firm's forms filler. Fill every field of the form below from a fact on the record, one fact id per value. A field with no fact on the record stays empty and becomes an ask to the attorney, never a guess. Names, dates and addresses are copied exactly as the document states them.",
  letter_writer:
    "You are writing a letter of recommendation in the voice of the recommender below, for their signature. First person, their vantage point, their relationship to the beneficiary as the record states it. Every claim about the beneficiary rests on a fact below and every quoted phrase is the verbatim words of a fact. No praise the record cannot carry.",
};

const REGISTER =
  "House register: plain legal English. Never em dashes, en dashes, double hyphens or semicolons. Never invent a fact, a date, a name or a number. A quote you cannot find below is not a quote. Say what you could not do instead of papering over it.";

function factLines(facts: BriefFact[]): string {
  if (facts.length === 0) return "(no facts on the record for this scope yet)";
  return facts.map(f =>
    `- [${f.id}] ${f.exhibitNo !== null ? `Exhibit ${f.exhibitNo}` : "no exhibit"}, "${f.documentTitle}"${f.page !== null ? ` p. ${f.page}` : ""}: ${f.statement} Verbatim: "${f.quote}"`,
  ).join("\n");
}

function sectionBlock(s: BriefSection, withDraft: boolean): string {
  const lines = [
    `Section "${s.title}" (key ${s.key}). Criterion: ${s.criterion}. It argues: ${s.purpose}`,
    `Evidence in the record: ${s.evidence}.` + (s.stillNeeded.length ? ` Still needed: ${s.stillNeeded.join("; ").replace(/;/g, ",")}` : ""),
  ];
  if (s.guidance) lines.push(`The attorney's standing guidance for this section: ${s.guidance}`);
  if (withDraft && s.draft.trim()) lines.push(`Current draft (${s.status}):\n${s.draft.trim()}`);
  if (s.weaknesses.length) lines.push("The reviewer's notes:\n" + s.weaknesses.map(w => `- ${w.severity}: ${w.issue} Fix: ${w.fix}`).join("\n"));
  if (s.unverifiedQuotes.length) lines.push("Quotes the verifier could not find:\n" + s.unverifiedQuotes.map(q => `- "${q}"`).join("\n"));
  return lines.join("\n");
}

function landing(role: SpecialistRole, ctx: SpecialistContext): string {
  const path = delegationPath(role, ctx.scope);
  const desk = `Write your work product to the desk with (await env.MATTER.desk()).write("${path}", markdown) so the attorney can read it.`;
  switch (role) {
    case "gap_analyst":
      return [
        "Land the work like this:",
        "1. Read (await env.MATTER.knowledge()).readiness() and the facts below.",
        `2. ${desk} Structure: one heading per criterion, then what the record proves, what it lacks, and the client ask.`,
        "3. Return, as your final answer, one paragraph: the three gaps that matter most and the single most useful thing to ask the client for first.",
      ].join("\n");
    case "drafter": {
      const key = ctx.scope.kind === "section" ? ctx.scope.key : "<section key>";
      return [
        "Land the work like this:",
        `1. const p = await env.MATTER.petition(); await p.begin("${key}").`,
        `2. Write the section, then const r = await p.write("${key}", body, citedFactIds) with the ids of every fact you relied on.`,
        "3. If r.unverifiedQuotes is above zero, find each quote's exact wording with (await env.MATTER.files()).find(reference, query), fix the draft, and write again. Repeat until it is zero or you can say why it cannot be.",
        `4. ${desk} Put a two line note on what you changed and why.`,
        "5. Return one paragraph: what the section now argues, its length in pages, and anything the attorney must decide.",
      ].join("\n");
    }
    case "officer":
      return [
        "Land the work like this:",
        "1. const p = await env.MATTER.petition(); read every drafted section with p.sections().",
        "2. For each drafted section, await p.review(key, score, weaknesses) with a score from 0 to 100 and weaknesses of the shape {severity: \"high\" or \"medium\" or \"low\", issue, fix}. Score as an officer would grade the argument, not the prose.",
        `3. ${desk} One heading per section, the weaknesses under it, the two sections most likely to draw a request for evidence at the top.`,
        "4. Return one paragraph: the two points an officer would seize on first, and whether the letter is filing ready as written.",
      ].join("\n");
    case "forms_filler": {
      const code = ctx.scope.kind === "form" ? ctx.scope.code : "<form code>";
      return [
        "Land the work like this:",
        `1. const f = await env.MATTER.forms(); read the form with f.list() and find "${code}".`,
        `2. await f.fill("${code}", values) where every value is {name, value, sourceFactId} and sourceFactId is the id of the fact the value came from. A field with no fact gets value null and sourceFactId null.`,
        `3. ${desk} List the fields you filled with their sources, and the fields the attorney must supply.`,
        "4. Return one paragraph: how many fields are filled from the record and which ones need the attorney.",
      ].join("\n");
    }
    case "letter_writer": {
      const id = ctx.scope.kind === "recommender" ? ctx.scope.id : "<recommender id>";
      return [
        "Land the work like this:",
        `1. const r = await env.MATTER.recommenders(); const l = await r.writeLetter("${id}", body, citedFactIds) with the ids of every fact the letter relies on.`,
        "2. If l.unverifiedQuotes is above zero, fix the wording against the facts and write again until it is zero.",
        `3. ${desk} Note the facts the letter leans on hardest.`,
        "4. Return one paragraph: what the letter attests to and what the recommender must confirm before signing.",
      ].join("\n");
    }
  }
}

/** The title and the prompt a spawned specialist starts from. */
export function composeBrief(role: SpecialistRole, ctx: SpecialistContext): { title: string; prompt: string } {
  const scopeTitle = ctx.scope.kind === "section" ? ctx.sections[0]?.title ?? ctx.scope.key
    : ctx.scope.kind === "form" ? (ctx.form?.title ?? ctx.scope.code)
    : ctx.scope.kind === "recommender" ? (ctx.recommender?.name ?? "recommender")
    : ctx.scope.kind === "letter" ? "the letter"
    : "the matter";
  const title = role === "officer" || (role === "gap_analyst" && ctx.scope.kind === "matter")
    ? ROLE_TITLE[role]
    : `${ROLE_TITLE[role]} · ${scopeTitle}`;

  const parts: string[] = [];
  parts.push(DOCTRINE[role]);
  parts.push(`The matter: ${ctx.matterTitle}, for ${ctx.clientName}. Case type: ${ctx.caseType ?? "not yet set"}.${ctx.petitionTitle ? ` The filing: ${ctx.petitionTitle}.` : ""}`);
  if (ctx.instruction) parts.push(`The counsel's instruction for this job: ${ctx.instruction}`);
  if (ctx.directives.length) parts.push("The attorney's standing directives on this matter, which outrank everything below:\n" + ctx.directives.map(d => `- ${d}`).join("\n"));
  if (ctx.style) parts.push("The firm's petition style for this scope, from its playbook:\n" + ctx.style);
  if (ctx.rules.length) parts.push("The firm's standing rules:\n" + ctx.rules.map(r => `- ${r.rule}${r.why ? ` (why: ${r.why})` : ""}`).join("\n"));
  if (ctx.sections.length) {
    const withDraft = role !== "gap_analyst";
    parts.push((ctx.scope.kind === "section" ? "The section in scope:\n" : "The letter, section by section:\n") + ctx.sections.map(s => sectionBlock(s, withDraft)).join("\n\n"));
  }
  if (ctx.form) {
    parts.push(`The form: ${ctx.form.code}, ${ctx.form.title}. Fields:\n` + ctx.form.fields.map(f => `- ${f.name}: ${f.label}${f.value ? ` (currently "${f.value}")` : ""}`).join("\n"));
  }
  if (ctx.recommender) {
    const r = ctx.recommender;
    parts.push(`The recommender: ${r.name}${r.title ? `, ${r.title}` : ""}${r.organization ? `, ${r.organization}` : ""}.${r.relationship ? ` Relationship: ${r.relationship}.` : ""}${r.basis ? ` Why they are credible: ${r.basis}.` : ""}`);
  }
  parts.push("The facts you may rely on (id, exhibit, document, page, the fact, the verbatim words):\n" + factLines(ctx.facts));
  parts.push(landing(role, ctx));
  parts.push(REGISTER);
  return { title, prompt: parts.join("\n\n") };
}
