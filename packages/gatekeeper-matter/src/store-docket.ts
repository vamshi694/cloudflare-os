// The docket: the dates the firm must not miss. Three kinds of item share one list: deadlines the
// attorney or the counsel docketed (the `deadlines` table, from store-client.ts), windows derived
// from the matter's key dates (I-94 expiry, status end, EAD expiry, the H-1B cap, the premium
// processing clock), and RFE clocks (this module's tables). Reminders fire once per threshold
// per item, ledgered, so a lawyer is never told the same thing twice and never not told.

import type { Deadline } from "@gadgets/workshop-shared/legal";
import { daysBetween, deadlineUrgency } from "./rules.js";
import { listDeadlines } from "./store-client.js";
import { parseJson, type Db, type Row } from "./store-db.js";

export const DOCKET_SCHEMA = `
CREATE TABLE IF NOT EXISTS deadline_reminders (
  deadline_id TEXT NOT NULL, threshold INTEGER NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (deadline_id, threshold));
CREATE TABLE IF NOT EXISTS rfes (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL, received_on TEXT, response_due TEXT, summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rfe_asks (
  id TEXT PRIMARY KEY, rfe_id TEXT NOT NULL, n INTEGER NOT NULL, title TEXT NOT NULL, ask TEXT NOT NULL,
  criterion TEXT, evidence_requested TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rfe_responses (
  ask_id TEXT PRIMARY KEY, body TEXT NOT NULL, cited_fact_ids TEXT NOT NULL DEFAULT '[]', unverified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'drafted', version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
`;

// ── Key dates and derived windows ───────────────────────────────────────────────────────────────

/** The dates a matter turns on, entered by the attorney or learned from the client's intake. All ISO dates or null. */
export type KeyDates = {
  i94Expiry: string | null;
  statusEnd: string | null;
  eadExpiry: string | null;
  /** The fiscal year of the H-1B cap the matter targets (e.g. 2027), or null. */
  h1bCapYear: number | null;
  /** The date the premium processing request was filed, or null. */
  premiumFiledOn: string | null;
  /** The priority date and the preference category, for the Visa Bulletin. */
  priorityDate: string | null;
  preferenceCategory: string | null;
  chargeability: string | null;
};

/**
 * The research worker's ResearchApi entrypoint (legal_agent/packages/research-gatekeeper/src/api.ts),
 * structurally, so this module compiles and degrades honestly without the binding.
 */
export type BulletinEntry = {
  category: string; chargeability: string;
  /** "C" (current), "U" (unavailable), or an ISO cutoff date. */
  finalAction: string; datesForFiling: string | null;
};
export interface ResearchBinding {
  visaBulletin(category?: string, chargeability?: string): Promise<{
    ok: boolean; note: string | null;
    result: { month: string; url: string; entries: BulletinEntry[] } | null;
  }>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PriorityStanding = { current: boolean | null; note: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The bulletin row for a category and chargeability; "All other"/"ROW"/blank mean the all-chargeability row. */
export function pickBulletinEntry(entries: BulletinEntry[], category: string, chargeability: string | null): BulletinEntry | null {
  const cat = norm(category);
  const want = !chargeability || /^(all|row|rest|other)/i.test(chargeability.trim()) ? "all" : norm(chargeability);
  const rows = entries.filter(e => norm(e.category) === cat);
  return rows.find(e => (want === "all" ? norm(e.chargeability).startsWith("all") : norm(e.chargeability).startsWith(want))) ?? null;
}

/** Where a priority date stands against one bulletin row: true when current, false when not, null when the cutoff is unreadable. */
export function standingAgainst(priorityDate: string, entry: BulletinEntry): boolean | null {
  const fa = entry.finalAction.trim().toUpperCase();
  if (fa === "C") return true;
  if (fa === "U") return false;
  // The priority date must fall before the cutoff (not on it) to be current.
  return ISO_DATE.test(fa) ? priorityDate < fa : null;
}

/** Where the priority date stands against the bulletin; null when the key dates or the service are missing. */
export async function priorityStanding(k: KeyDates, research: ResearchBinding | undefined): Promise<PriorityStanding | null> {
  if (!k.priorityDate || !k.preferenceCategory) return null;
  if (!research) return { current: null, note: "The Visa Bulletin service is not connected on this deployment; the priority date stands as entered." };
  try {
    const answer = await research.visaBulletin(k.preferenceCategory, k.chargeability ?? undefined);
    if (!answer.ok || !answer.result) return { current: null, note: answer.note ?? "The Visa Bulletin did not answer." };
    const entry = pickBulletinEntry(answer.result.entries, k.preferenceCategory, k.chargeability);
    if (!entry) return { current: null, note: `The ${answer.result.month} bulletin has no ${k.preferenceCategory} row for ${k.chargeability ?? "all chargeability areas"}.` };
    const current = standingAgainst(k.priorityDate, entry);
    const cutoff = entry.finalAction.toUpperCase() === "C" ? "current" : entry.finalAction.toUpperCase() === "U" ? "unavailable" : entry.finalAction;
    return {
      current,
      note: current === null
        ? `The ${answer.result.month} bulletin lists final action "${entry.finalAction}" for ${entry.category} (${entry.chargeability}); the cutoff could not be compared.`
        : current
          ? `Priority date ${k.priorityDate} is current under the ${answer.result.month} bulletin (final action ${cutoff}).`
          : `Priority date ${k.priorityDate} is not yet current under the ${answer.result.month} bulletin (final action ${cutoff}; dates for filing ${entry.datesForFiling ?? "unavailable"}).`,
    };
  } catch (error) {
    return { current: null, note: `The Visa Bulletin could not be read just now: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const EMPTY_KEY_DATES: KeyDates = {
  i94Expiry: null, statusEnd: null, eadExpiry: null, h1bCapYear: null, premiumFiledOn: null,
  priorityDate: null, preferenceCategory: null, chargeability: null,
};


function isoAfterDays(iso: string, days: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** N business days after an ISO date (weekends skipped; federal holidays are not modeled and the title says so). */
export function businessDaysAfter(iso: string, days: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

export type DerivedWindow = { id: string; title: string; dueOn: string; kind: Deadline["kind"]; derivedFrom: string };

/**
 * The windows the key dates imply. Pure: the same dates always derive the same windows, with
 * stable ids so a window can be marked met and stay met.
 */
export function deriveWindows(k: KeyDates): DerivedWindow[] {
  const out: DerivedWindow[] = [];
  if (k.i94Expiry && ISO_DATE.test(k.i94Expiry)) {
    out.push({ id: "derived:i94", title: "I-94 admission expires", dueOn: k.i94Expiry, kind: "filing", derivedFrom: "I-94 expiry" });
  }
  if (k.statusEnd && ISO_DATE.test(k.statusEnd)) {
    out.push({ id: "derived:status", title: "Status ends: file the extension or change of status before this date", dueOn: k.statusEnd, kind: "filing", derivedFrom: "status end" });
  }
  if (k.eadExpiry && ISO_DATE.test(k.eadExpiry)) {
    out.push({ id: "derived:ead-window", title: "EAD renewal window opens (180 days before expiry)", dueOn: isoAfterDays(k.eadExpiry, -180), kind: "filing", derivedFrom: "EAD expiry" });
    out.push({ id: "derived:ead", title: "EAD expires", dueOn: k.eadExpiry, kind: "filing", derivedFrom: "EAD expiry" });
  }
  if (k.h1bCapYear && Number.isInteger(k.h1bCapYear)) {
    // The registration window opens in March of the calendar year before the fiscal year; the exact
    // days are announced each year, so this is the month the firm must watch, not a promise.
    out.push({ id: "derived:h1b-cap", title: `H-1B cap registration for FY${k.h1bCapYear} (window announced for March ${k.h1bCapYear - 1})`, dueOn: `${k.h1bCapYear - 1}-03-01`, kind: "filing", derivedFrom: "H-1B cap year" });
  }
  if (k.premiumFiledOn && ISO_DATE.test(k.premiumFiledOn)) {
    out.push({ id: "derived:premium", title: "Premium processing clock: 15 business days from filing (holidays not counted here)", dueOn: businessDaysAfter(k.premiumFiledOn, 15), kind: "internal", derivedFrom: "premium processing filing date" });
  }
  return out;
}

export function readKeyDates(db: Db): KeyDates {
  return { ...EMPTY_KEY_DATES, ...parseJson<Partial<KeyDates>>(db.metaGet("key_dates"), {}) };
}

export function writeKeyDates(db: Db, input: Partial<KeyDates>, by: string): KeyDates {
  const next = { ...readKeyDates(db) };
  for (const [key, value] of Object.entries(input) as [keyof KeyDates, unknown][]) {
    if (!(key in EMPTY_KEY_DATES)) continue;
    if (key === "h1bCapYear") {
      (next as Record<string, unknown>)[key] = typeof value === "number" && Number.isInteger(value) && value > 2000 && value < 2100 ? value : null;
    } else if (value === null || value === "") {
      (next as Record<string, unknown>)[key] = null;
    } else if (typeof value === "string") {
      if (["priorityDate", "i94Expiry", "statusEnd", "eadExpiry", "premiumFiledOn"].includes(key) && !ISO_DATE.test(value)) {
        throw new Error(`${key} needs an ISO date (YYYY-MM-DD).`);
      }
      (next as Record<string, unknown>)[key] = value.trim();
    }
  }
  db.metaSet("key_dates", JSON.stringify(next));
  db.log(by, "Updated the matter's key dates.");
  return next;
}

/** Derived items the attorney marked met keep their id in meta so they stay met across recomputes. */
function metDerived(db: Db): Set<string> {
  return new Set(parseJson<string[]>(db.metaGet("derived_met"), []));
}

export function markDerivedMet(db: Db, id: string, by: string): void {
  const set = metDerived(db);
  set.add(id);
  db.metaSet("derived_met", JSON.stringify([...set]));
  db.log(by, `Marked "${id.replace(/^derived:/, "")}" as met.`);
}

export type DocketItem = Deadline & { provenance: "docketed" | "derived" | "rfe"; derivedFrom: string | null };

/** The whole docket as one list: docketed deadlines, derived windows, RFE clocks. Unmet first, soonest first. */
export function listDocket(db: Db, today: string): DocketItem[] {
  const met = metDerived(db);
  const stored: DocketItem[] = listDeadlines(db, today).map(d => ({
    ...d, provenance: d.source === "rfe" ? "rfe" : "docketed", derivedFrom: null,
  }));
  const derived: DocketItem[] = deriveWindows(readKeyDates(db)).map(w => {
    const isMet = met.has(w.id);
    const daysLeft = daysBetween(today, w.dueOn);
    return { id: w.id, title: w.title, dueOn: w.dueOn, kind: w.kind, source: "derived", met: isMet, daysLeft, urgency: deadlineUrgency(daysLeft, isMet), provenance: "derived", derivedFrom: w.derivedFrom };
  });
  return [...stored, ...derived].sort((a, b) => Number(a.met) - Number(b.met) || a.dueOn.localeCompare(b.dueOn));
}

// ── Reminders: once per threshold, never twice, never silently skipped ──────────────────────────

export const REMINDER_THRESHOLDS = [30, 14, 7, 1, 0] as const;

export type ReminderDue = { item: DocketItem; threshold: number };

/**
 * Which reminders are due today. For each unmet item the smallest threshold its days-left has
 * crossed fires, unless it already fired; an item ten days out whose 14-day reminder was never
 * sent gets that one now (late is better than never), then the 7 and 1 in their turn.
 */
export function remindersDue(items: DocketItem[], sent: Set<string>): ReminderDue[] {
  const due: ReminderDue[] = [];
  for (const item of items) {
    if (item.met) continue;
    const crossed = REMINDER_THRESHOLDS.filter(t => item.daysLeft <= t);
    if (crossed.length === 0) continue;
    // The smallest crossed threshold is the most urgent truthful one; once it (or anything more
    // urgent) has been sent, the larger ones are moot.
    const threshold = Math.min(...crossed);
    if (REMINDER_THRESHOLDS.some(t => t <= threshold && sent.has(`${item.id}:${t}`))) continue;
    due.push({ item, threshold });
  }
  return due;
}

export function sentReminders(db: Db): Set<string> {
  return new Set(db.sql<{ deadline_id: string; threshold: number }>("SELECT deadline_id, threshold FROM deadline_reminders")
    .map(r => `${r.deadline_id}:${r.threshold}`));
}

export function recordReminders(db: Db, due: ReminderDue[]): void {
  for (const d of due) {
    // Every threshold at or above the fired one counts as sent: the 30-day note is moot once the 7-day one went out.
    for (const t of REMINDER_THRESHOLDS) {
      if (t >= d.threshold) db.sql("INSERT OR IGNORE INTO deadline_reminders(deadline_id, threshold, sent_at) VALUES(?, ?, ?)", d.item.id, t, db.now());
    }
  }
}

export function reminderLine(d: ReminderDue): string {
  const when = d.item.daysLeft < 0 ? `${Math.abs(d.item.daysLeft)} days overdue`
    : d.item.daysLeft === 0 ? "due today"
    : `due in ${d.item.daysLeft} day${d.item.daysLeft === 1 ? "" : "s"}`;
  return `${d.item.title}: ${when} (${d.item.dueOn}).`;
}

// ── RFEs ────────────────────────────────────────────────────────────────────────────────────────

export type RfeAskRow = { id: string; n: number; title: string; ask: string; criterion: string | null; evidenceRequested: string };
export type RfeResponseRow = { askId: string; body: string; citedFactIds: string[]; unverified: number; status: "drafted" | "approved"; version: number; updatedAt: string; updatedBy: string };
export type RfeRow = { id: string; documentId: string; receivedOn: string | null; responseDue: string | null; summary: string; status: "open" | "responded" | "closed"; createdAt: string };

export function recordRfe(db: Db, input: { documentId: string; receivedOn: string | null; responseDue: string | null; summary: string; asks: { title: string; ask: string; criterion: string | null; evidenceRequested: string }[] }): RfeRow {
  const existing = db.sql<{ id: string }>("SELECT id FROM rfes WHERE document_id = ?", input.documentId)[0];
  const id = existing?.id ?? db.id();
  const createdAt = db.now();
  if (existing) {
    db.sql("UPDATE rfes SET received_on = ?, response_due = ?, summary = ?, status = 'open' WHERE id = ?", input.receivedOn, input.responseDue, input.summary, id);
    db.sql("DELETE FROM rfe_asks WHERE rfe_id = ?", id);
  } else {
    db.sql("INSERT INTO rfes(id, document_id, received_on, response_due, summary, status, created_at) VALUES(?, ?, ?, ?, ?, 'open', ?)",
      id, input.documentId, input.receivedOn, input.responseDue, input.summary, createdAt);
  }
  input.asks.forEach((a, i) => {
    db.sql("INSERT INTO rfe_asks(id, rfe_id, n, title, ask, criterion, evidence_requested, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
      db.id(), id, i + 1, a.title, a.ask, a.criterion, a.evidenceRequested, createdAt);
  });
  return { id, documentId: input.documentId, receivedOn: input.receivedOn, responseDue: input.responseDue, summary: input.summary, status: "open", createdAt };
}

function toRfe(r: Row): RfeRow {
  return {
    id: r.id as string, documentId: r.document_id as string, receivedOn: (r.received_on as string | null) ?? null,
    responseDue: (r.response_due as string | null) ?? null, summary: r.summary as string,
    status: r.status as RfeRow["status"], createdAt: r.created_at as string,
  };
}

export function currentRfe(db: Db): RfeRow | null {
  const r = db.sql("SELECT * FROM rfes WHERE status != 'closed' ORDER BY created_at DESC LIMIT 1")[0];
  return r ? toRfe(r) : null;
}

export function listRfeAsks(db: Db, rfeId: string): RfeAskRow[] {
  return db.sql("SELECT * FROM rfe_asks WHERE rfe_id = ? ORDER BY n", rfeId).map(r => ({
    id: r.id as string, n: r.n as number, title: r.title as string, ask: r.ask as string,
    criterion: (r.criterion as string | null) ?? null, evidenceRequested: r.evidence_requested as string,
  }));
}

export function rfeAsk(db: Db, askId: string): (RfeAskRow & { rfeId: string }) | null {
  const r = db.sql("SELECT * FROM rfe_asks WHERE id = ?", askId)[0];
  return r ? {
    id: r.id as string, rfeId: r.rfe_id as string, n: r.n as number, title: r.title as string, ask: r.ask as string,
    criterion: (r.criterion as string | null) ?? null, evidenceRequested: r.evidence_requested as string,
  } : null;
}

export function listRfeResponses(db: Db, rfeId: string): RfeResponseRow[] {
  return db.sql(`SELECT r.* FROM rfe_responses r JOIN rfe_asks a ON a.id = r.ask_id WHERE a.rfe_id = ? ORDER BY a.n`, rfeId).map(r => ({
    askId: r.ask_id as string, body: r.body as string, citedFactIds: parseJson<string[]>(r.cited_fact_ids, []),
    unverified: r.unverified as number, status: r.status as RfeResponseRow["status"], version: r.version as number,
    updatedAt: r.updated_at as string, updatedBy: r.updated_by as string,
  }));
}

export function saveRfeResponse(db: Db, askId: string, body: string, citedFactIds: string[], unverified: number, by: string): RfeResponseRow {
  const prev = db.sql<{ version: number }>("SELECT version FROM rfe_responses WHERE ask_id = ?", askId)[0];
  const version = (prev?.version ?? 0) + 1;
  db.sql(`INSERT INTO rfe_responses(ask_id, body, cited_fact_ids, unverified, status, version, updated_at, updated_by) VALUES(?, ?, ?, ?, 'drafted', ?, ?, ?)
          ON CONFLICT(ask_id) DO UPDATE SET body = excluded.body, cited_fact_ids = excluded.cited_fact_ids, unverified = excluded.unverified,
          status = 'drafted', version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    askId, body, JSON.stringify(citedFactIds), unverified, version, db.now(), by);
  return { askId, body, citedFactIds, unverified, status: "drafted", version, updatedAt: db.now(), updatedBy: by };
}

export function approveRfeResponse(db: Db, askId: string, by: string): void {
  const r = db.sql<{ unverified: number }>("SELECT unverified FROM rfe_responses WHERE ask_id = ?", askId)[0];
  if (!r) throw new Error("There is no draft response for that ask yet.");
  if (r.unverified > 0) throw new Error("This response quotes words the record does not contain; rewrite it until every quote verifies.");
  db.sql("UPDATE rfe_responses SET status = 'approved', updated_at = ?, updated_by = ? WHERE ask_id = ?", db.now(), by, askId);
  db.log(by, "Approved an RFE response.");
}

export function closeRfe(db: Db, rfeId: string, status: "responded" | "closed", by: string): void {
  db.sql("UPDATE rfes SET status = ? WHERE id = ?", status, rfeId);
  db.log(by, status === "responded" ? "Marked the RFE as responded." : "Closed the RFE.");
}
