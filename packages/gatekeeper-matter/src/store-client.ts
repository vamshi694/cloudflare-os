// The client on the matter, the messages between the firm and the client, the client's own words
// from the portal, the portal token, and the docket.

import type { ClientMessage, ClientRecord, Deadline } from "@gadgets/workshop-shared/legal";
import { daysBetween, deadlineUrgency } from "./rules.js";
import { parseJson, type Db } from "./store-db.js";

export const CLIENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, direction TEXT NOT NULL, subject TEXT, body TEXT NOT NULL, at TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, at TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deadlines (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, due_on TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL,
  met INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
`;

type StoredClient = {
  name: string; email: string | null; phone: string | null; portalToken: string | null;
  invitedAt: string | null; lastSeenAt: string | null;
};

function stored(db: Db, fallbackName: string): StoredClient {
  return parseJson<StoredClient>(db.metaGet("client"), { name: fallbackName, email: null, phone: null, portalToken: null, invitedAt: null, lastSeenAt: null });
}

function save(db: Db, c: StoredClient): void { db.metaSet("client", JSON.stringify(c)); }

export function clientRecord(db: Db, fallbackName: string, portalUrl: (token: string) => string): ClientRecord {
  const c = stored(db, fallbackName);
  const sent = db.sql<{ n: number }>("SELECT COUNT(*) AS n FROM documents WHERE uploaded_by = 'client' AND status != 'superseded'")[0]?.n ?? 0;
  const expired = c.invitedAt !== null && !c.lastSeenAt && Date.now() - Date.parse(c.invitedAt) > 30 * 86_400_000;
  return {
    name: c.name, email: c.email, phone: c.phone,
    portal: !c.portalToken ? "not_invited" : c.lastSeenAt ? "signed_in" : expired ? "expired" : "invited",
    portalUrl: c.portalToken ? portalUrl(c.portalToken) : null,
    documentsSent: sent, invitedAt: c.invitedAt, lastSeenAt: c.lastSeenAt,
  };
}

export function setClient(db: Db, fallbackName: string, input: { name?: string; email?: string | null; phone?: string | null }): void {
  const c = stored(db, fallbackName);
  save(db, {
    ...c,
    name: input.name?.trim() || c.name,
    email: input.email === undefined ? c.email : (input.email?.trim() || null),
    phone: input.phone === undefined ? c.phone : (input.phone?.trim() || null),
  });
}

/** Mint a fresh portal token; the old one dies in the same act. */
export function mintPortalToken(db: Db, fallbackName: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  const c = stored(db, fallbackName);
  save(db, { ...c, portalToken: token, invitedAt: db.now(), lastSeenAt: null });
  db.log("lawyer", "Sent the client a fresh sign-in link to the portal.");
  return token;
}

export function portalToken(db: Db, fallbackName: string): string | null { return stored(db, fallbackName).portalToken; }

export function touchPortal(db: Db, fallbackName: string): void {
  const c = stored(db, fallbackName);
  save(db, { ...c, lastSeenAt: db.now() });
}

// ---- messages ----------------------------------------------------------------------------------

export function listMessages(db: Db): ClientMessage[] {
  return db.sql("SELECT * FROM messages ORDER BY at").map(r => ({
    id: r.id as string, direction: r.direction as "outbound" | "inbound", subject: (r.subject as string | null) ?? null,
    body: r.body as string, at: r.at as string, sent: Boolean(r.sent), source: r.source as ClientMessage["source"],
  }));
}

export function addMessage(db: Db, m: { direction: "outbound" | "inbound"; subject: string | null; body: string; sent: boolean; source: ClientMessage["source"] }): ClientMessage {
  const id = db.id();
  const at = db.now();
  db.sql("INSERT INTO messages(id, direction, subject, body, at, sent, source) VALUES(?, ?, ?, ?, ?, ?, ?)",
    id, m.direction, m.subject, m.body, at, m.sent ? 1 : 0, m.source);
  return { id, direction: m.direction, subject: m.subject, body: m.body, at, sent: m.sent, source: m.source };
}

export function markMessageSent(db: Db, id: string): void {
  db.sql("UPDATE messages SET sent = 1, at = ? WHERE id = ?", db.now(), id);
}

export function deleteMessage(db: Db, id: string): void { db.sql("DELETE FROM messages WHERE id = ?", id); }

export function sentOutbound(db: Db): { id: string; body: string; at: string }[] {
  return db.sql<{ id: string; body: string; at: string }>("SELECT id, body, at FROM messages WHERE direction = 'outbound' AND sent = 1 ORDER BY at DESC");
}

// ---- the client's own words --------------------------------------------------------------------

export function addSubmission(db: Db, text: string): { id: string } {
  const id = db.id();
  db.sql("INSERT INTO submissions(id, at, text) VALUES(?, ?, ?)", id, db.now(), text);
  db.log("client", "The client shared context in their own words through the portal.");
  return { id };
}

export function listSubmissions(db: Db): { id: string; at: string; text: string }[] {
  return db.sql<{ id: string; at: string; text: string }>("SELECT id, at, text FROM submissions ORDER BY at DESC");
}

// ---- the docket --------------------------------------------------------------------------------

export function listDeadlines(db: Db, today: string): Deadline[] {
  return db.sql("SELECT * FROM deadlines ORDER BY met, due_on").map(r => {
    const daysLeft = daysBetween(today, r.due_on as string);
    const met = Boolean(r.met);
    return {
      id: r.id as string, title: r.title as string, dueOn: r.due_on as string, kind: r.kind as Deadline["kind"],
      source: r.source as string, met, daysLeft, urgency: deadlineUrgency(daysLeft, met),
    };
  });
}

export function addDeadline(db: Db, input: { title: string; dueOn: string; kind: Deadline["kind"] }, source: string, today: string): Deadline {
  const title = input.title.trim();
  if (!title) throw new Error("A deadline needs a title.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) throw new Error("A deadline needs an ISO date (YYYY-MM-DD).");
  const id = db.id();
  db.sql("INSERT INTO deadlines(id, title, due_on, kind, source, created_at) VALUES(?, ?, ?, ?, ?, ?)", id, title, input.dueOn, input.kind, source, db.now());
  db.log(source === "attorney" ? "lawyer" : "agent", `Docketed "${title}" for ${input.dueOn}.`);
  const daysLeft = daysBetween(today, input.dueOn);
  return { id, title, dueOn: input.dueOn, kind: input.kind, source, met: false, daysLeft, urgency: deadlineUrgency(daysLeft, false) };
}

export function markDeadlineMet(db: Db, id: string, actor: string): void {
  const row = db.sql("SELECT title FROM deadlines WHERE id = ?", id)[0];
  if (!row) throw new Error("That deadline is not on the docket.");
  db.sql("UPDATE deadlines SET met = 1 WHERE id = ?", id);
  db.log(actor, `Marked "${row.title}" as met.`);
}
