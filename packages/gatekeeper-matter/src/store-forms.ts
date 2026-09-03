// The government forms on a matter: the firm's values per field with their sources and the
// attorney's rulings, the official template on file, the rendered PDF, and the client's signature.
// The `forms` table is the same one store-petition.ts created; the tables below extend it.

import type { CaseTypeSpec, FormFieldValue, GovernmentForm } from "@gadgets/workshop-shared/legal";
import { FORM_FIELDS } from "./case-types.js";
import { nextStatus, type FormStatus } from "./forms-pdf.js";
import { parseJson, type Db, type Row } from "./store-db.js";

export const FORMS_SCHEMA = `
CREATE TABLE IF NOT EXISTS form_templates (
  code TEXT PRIMARY KEY, state TEXT NOT NULL, note TEXT, r2_key TEXT, fields TEXT NOT NULL DEFAULT '[]',
  mapping TEXT NOT NULL DEFAULT '{}', unmapped TEXT NOT NULL DEFAULT '[]', fetched_at TEXT);
CREATE TABLE IF NOT EXISTS form_renders (code TEXT PRIMARY KEY, r2_key TEXT NOT NULL, rendered_at TEXT NOT NULL, flattened INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS form_signatures (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, requested_at TEXT NOT NULL, signed_at TEXT, signed_name TEXT, render_key TEXT NOT NULL);
`;

export type StoredField = {
  name: string; label: string; value: string | null; sourceFactId: string | null; acceptedBy: "attorney" | null;
  review?: FormFieldValue["review"]; pdfField?: string | null;
  /** WP-11: where a value without a fact came from: the client's intake, or the firm's own entry. */
  sourceKind?: FormFieldValue["sourceKind"];
};

export type TemplateRecord = {
  state: "none" | "ready" | "failed"; note: string | null; r2Key: string | null;
  fields: { name: string; type: string }[]; mapping: Record<string, string | null>; unmapped: string[]; fetchedAt: string | null;
};

function seedFields(code: string): StoredField[] {
  return (FORM_FIELDS[code] ?? []).map(f => ({ ...f, value: null, sourceFactId: null, acceptedBy: null, review: "proposed" as const, pdfField: null }));
}

function readForm(db: Db, code: string): { status: FormStatus; fields: StoredField[] } {
  const r = db.sql("SELECT * FROM forms WHERE code = ?", code)[0];
  return r ? { status: r.status as FormStatus, fields: parseJson<StoredField[]>(r.fields, []) } : { status: "not_started", fields: seedFields(code) };
}

function writeForm(db: Db, code: string, status: FormStatus, fields: StoredField[]): void {
  db.sql(`INSERT INTO forms(code, status, fields, updated_at) VALUES(?, ?, ?, ?)
          ON CONFLICT(code) DO UPDATE SET status = excluded.status, fields = excluded.fields, updated_at = excluded.updated_at`,
    code, status, JSON.stringify(fields), db.now());
}

export function templateRecord(db: Db, code: string): TemplateRecord {
  const r = db.sql("SELECT * FROM form_templates WHERE code = ?", code)[0];
  if (!r) return { state: "none", note: null, r2Key: null, fields: [], mapping: {}, unmapped: [], fetchedAt: null };
  return {
    state: r.state as TemplateRecord["state"], note: (r.note as string | null) ?? null, r2Key: (r.r2_key as string | null) ?? null,
    fields: parseJson(r.fields, []), mapping: parseJson(r.mapping, {}), unmapped: parseJson(r.unmapped, []), fetchedAt: (r.fetched_at as string | null) ?? null,
  };
}

export function setTemplate(db: Db, code: string, t: Omit<TemplateRecord, "fetchedAt">): void {
  db.sql(`INSERT INTO form_templates(code, state, note, r2_key, fields, mapping, unmapped, fetched_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(code) DO UPDATE SET state = excluded.state, note = excluded.note, r2_key = excluded.r2_key, fields = excluded.fields,
          mapping = excluded.mapping, unmapped = excluded.unmapped, fetched_at = excluded.fetched_at`,
    code, t.state, t.note, t.r2Key, JSON.stringify(t.fields), JSON.stringify(t.mapping), JSON.stringify(t.unmapped), db.now());
  // The mapping lands on each field so the room can say where a value goes.
  const f = readForm(db, code);
  writeForm(db, code, f.status, f.fields.map(x => ({ ...x, pdfField: t.mapping[x.name] ?? null })));
}

export function renderRecord(db: Db, code: string): { r2Key: string; renderedAt: string; flattened: boolean } | null {
  const r = db.sql("SELECT * FROM form_renders WHERE code = ?", code)[0];
  return r ? { r2Key: r.r2_key as string, renderedAt: r.rendered_at as string, flattened: Boolean(r.flattened) } : null;
}

export function setRender(db: Db, code: string, r2Key: string, flattened: boolean): string {
  const at = db.now();
  db.sql(`INSERT INTO form_renders(code, r2_key, rendered_at, flattened) VALUES(?, ?, ?, ?)
          ON CONFLICT(code) DO UPDATE SET r2_key = excluded.r2_key, rendered_at = excluded.rendered_at, flattened = excluded.flattened`,
    code, r2Key, at, flattened ? 1 : 0);
  return at;
}

function signatureRow(db: Db, code: string): Row | undefined {
  return db.sql("SELECT * FROM form_signatures WHERE code = ? ORDER BY requested_at DESC LIMIT 1", code)[0];
}

export function listForms(db: Db, spec: CaseTypeSpec | null): GovernmentForm[] {
  return (spec?.forms ?? []).map(f => {
    const stored = readForm(db, f.code);
    const t = templateRecord(db, f.code);
    const render = renderRecord(db, f.code);
    const sig = signatureRow(db, f.code);
    const fields: FormFieldValue[] = stored.fields.map(x => ({
      name: x.name, label: x.label, value: x.value, sourceFactId: x.sourceFactId, acceptedBy: x.acceptedBy,
      review: x.review ?? (x.acceptedBy ? "accepted" : "proposed"), pdfField: x.pdfField ?? t.mapping[x.name] ?? null,
      sourceKind: x.sourceFactId ? "fact" : x.sourceKind ?? (x.value ? "firm" : null),
    }));
    return {
      code: f.code, title: f.title, filedOnline: f.filedOnline, status: stored.status, fields,
      filled: fields.filter(x => x.value !== null && x.value !== "" && x.review !== "rejected").length,
      accepted: fields.filter(x => x.review === "accepted").length,
      template: { state: t.state, note: t.note, fetchedAt: t.fetchedAt, fillable: t.fields.filter(x => x.type === "text").length, unmapped: t.unmapped },
      renderedAt: render?.renderedAt ?? null,
      signature: sig
        ? { state: sig.signed_at ? "signed" : "requested", requestedAt: sig.requested_at as string, signedAt: (sig.signed_at as string | null) ?? null, signedName: (sig.signed_name as string | null) ?? null }
        : { state: "none", requestedAt: null, signedAt: null, signedName: null },
    };
  });
}

/** The values that go onto the PDF: everything the attorney has not rejected, mapped to a field. */
export function renderableValues(db: Db, code: string): { pdfField: string; value: string }[] {
  const f = readForm(db, code);
  const mapping = templateRecord(db, code).mapping;
  return f.fields
    .filter(x => x.value && x.review !== "rejected")
    .map(x => ({ pdfField: x.pdfField ?? mapping[x.name] ?? null, value: x.value as string }))
    .filter((x): x is { pdfField: string; value: string } => !!x.pdfField);
}

export function formStatus(db: Db, code: string): FormStatus { return readForm(db, code).status; }

export function prepareForm(db: Db, code: string, prefill: { name: string; value: string; sourceKind?: FormFieldValue["sourceKind"] }[]): void {
  const f = readForm(db, code);
  const fields = f.fields.map(x => {
    const p = prefill.find(v => v.name === x.name);
    return p && !x.value ? { ...x, value: p.value, sourceFactId: null, sourceKind: p.sourceKind ?? "firm", review: "proposed" as const } : x;
  });
  writeForm(db, code, nextStatus(f.status, "prepare"), fields);
}

/** WP-11: the client's intake landed after the form was opened; fill what is still blank. */
export function applyIntakePrefill(db: Db, code: string, prefill: { name: string; value: string }[]): number {
  const f = readForm(db, code);
  let changed = 0;
  const fields = f.fields.map(x => {
    const p = prefill.find(v => v.name === x.name);
    if (!p || x.value) return x;
    changed += 1;
    return { ...x, value: p.value, sourceFactId: null, sourceKind: "intake" as const, review: "proposed" as const };
  });
  if (changed > 0) { writeForm(db, code, f.status, fields); invalidateRender(db, code); }
  return changed;
}

export function fillForm(db: Db, code: string, values: { name: string; value: string | null; sourceFactId: string | null }[]): void {
  const f = readForm(db, code);
  const fields = f.fields.map(x => {
    const v = values.find(y => y.name === x.name);
    if (!v) return x;
    // A field the attorney already accepted keeps its ruling when the value is unchanged.
    const unchanged = x.value === v.value;
    return { ...x, value: v.value, sourceFactId: v.sourceFactId, acceptedBy: unchanged ? x.acceptedBy : null, review: unchanged ? x.review : "proposed" as const };
  });
  for (const v of values) if (!fields.some(x => x.name === v.name)) {
    fields.push({ name: v.name, label: v.name.replace(/_/g, " "), value: v.value, sourceFactId: v.sourceFactId, acceptedBy: null, review: "proposed", pdfField: null });
  }
  writeForm(db, code, nextStatus(f.status, "fill"), fields);
  invalidateRender(db, code);
}

function rule(db: Db, code: string, name: string, change: (x: StoredField) => StoredField): void {
  const f = readForm(db, code);
  let found = false;
  const fields = f.fields.map(x => { if (x.name !== name) return x; found = true; return change(x); });
  if (!found) fields.push(change({ name, label: name.replace(/_/g, " "), value: null, sourceFactId: null, acceptedBy: null, review: "proposed", pdfField: null }));
  writeForm(db, code, nextStatus(f.status, "rule"), fields);
  invalidateRender(db, code);
}

export function acceptField(db: Db, code: string, name: string, value: string): void {
  rule(db, code, name, x => ({ ...x, value, acceptedBy: "attorney", review: "accepted" }));
}

export function askField(db: Db, code: string, name: string): void {
  rule(db, code, name, x => ({ ...x, review: "asked" }));
}

export function rejectField(db: Db, code: string, name: string): void {
  rule(db, code, name, x => ({ ...x, acceptedBy: null, review: "rejected" }));
}

export function approveForm(db: Db, code: string): void {
  const f = readForm(db, code);
  writeForm(db, code, nextStatus(f.status, "approve"), f.fields);
}

/** A render is stale once any value changes; the next preview rebuilds it. */
function invalidateRender(db: Db, code: string): void {
  db.sql("DELETE FROM form_renders WHERE code = ?", code);
}

export function requestSignature(db: Db, code: string, renderKey: string): { id: string } {
  const f = readForm(db, code);
  const status = nextStatus(f.status, "request_signature");
  const id = db.id();
  db.sql("INSERT INTO form_signatures(id, code, requested_at, render_key) VALUES(?, ?, ?, ?)", id, code, db.now(), renderKey);
  writeForm(db, code, status, f.fields);
  return { id };
}

export function pendingSignatures(db: Db): { id: string; code: string; requestedAt: string; renderKey: string }[] {
  return db.sql("SELECT * FROM form_signatures WHERE signed_at IS NULL ORDER BY requested_at").map(r => ({
    id: r.id as string, code: r.code as string, requestedAt: r.requested_at as string, renderKey: r.render_key as string,
  }));
}

export function signatureRender(db: Db, id: string): { code: string; renderKey: string; signed: boolean } | null {
  const r = db.sql("SELECT * FROM form_signatures WHERE id = ?", id)[0];
  return r ? { code: r.code as string, renderKey: r.render_key as string, signed: !!r.signed_at } : null;
}

/** The client signs by typing their full legal name; the record keeps the name and the moment. */
export function signForm(db: Db, id: string, signedName: string): { code: string } {
  const r = db.sql("SELECT * FROM form_signatures WHERE id = ? AND signed_at IS NULL", id)[0];
  if (!r) throw new Error("This signature request is no longer open.");
  const code = r.code as string;
  const f = readForm(db, code);
  const status = nextStatus(f.status, "sign");
  db.sql("UPDATE form_signatures SET signed_at = ?, signed_name = ? WHERE id = ?", db.now(), signedName, id);
  writeForm(db, code, status, f.fields);
  return { code };
}
