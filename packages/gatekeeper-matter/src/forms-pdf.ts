// Government forms as PDFs: the official USCIS templates, their fillable fields, and the filled
// render. Pure helpers (field mapping, status transitions, prefill) live here without any I/O so
// they can be tested; the R2 and pdf-lib work is in the exported async functions.
//
// Honest limits, stated where the attorney reads them: USCIS publishes several forms as XFA
// documents, which no open PDF library fills. Those come back as template.state "failed" with the
// reason, and the firm's values stay on the record for hand entry.

import { PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFName, PDFRadioGroup, PDFTextField } from "pdf-lib";
import type { GovernmentForm } from "@gadgets/workshop-shared/legal";

/** Where USCIS publishes each form. G-28, I-140, I-907, I-129 and its supplements are one PDF each. */
export const FORM_TEMPLATES: Record<string, { url: string; title: string }> = {
  "I-140": { url: "https://www.uscis.gov/sites/default/files/document/forms/i-140.pdf", title: "Immigrant Petition for Alien Workers" },
  "G-28": { url: "https://www.uscis.gov/sites/default/files/document/forms/g-28.pdf", title: "Notice of Entry of Appearance as Attorney or Accredited Representative" },
  "I-907": { url: "https://www.uscis.gov/sites/default/files/document/forms/i-907.pdf", title: "Request for Premium Processing Service" },
  "I-129": { url: "https://www.uscis.gov/sites/default/files/document/forms/i-129.pdf", title: "Petition for a Nonimmigrant Worker" },
  "I-129-O": { url: "https://www.uscis.gov/sites/default/files/document/forms/i-129.pdf", title: "O and P Classifications Supplement (inside Form I-129)" },
  "I-129-H": { url: "https://www.uscis.gov/sites/default/files/document/forms/i-129.pdf", title: "H Classification Supplement (inside Form I-129)" },
  "I-129-HDC": { url: "https://www.uscis.gov/sites/default/files/document/forms/i-129.pdf", title: "H-1B Data Collection Supplement (inside Form I-129)" },
  "ETA-9089": { url: "https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/ETA_Form_9089.pdf", title: "Application for Permanent Employment Certification" },
};

/**
 * Our field names → substrings that identify the official AcroForm field. USCIS names fields like
 * `form1[0].#subform[0].Pt1Line1a_FamilyName[0]`; the match is case-insensitive on the tail of
 * the name, first pattern wins, and every candidate must be a text field (or a checkbox for
 * `checkbox:` patterns). Unmatched fields stay on the record and are listed as unmapped.
 */
export const FIELD_MAP: Record<string, Record<string, string[]>> = {
  "I-140": {
    petitioner_name: ["Pt1Line1_FamilyName", "Pt1Line1a_FamilyName", "Pt1Line1_CompanyName", "Pt1Line2_CompanyName"],
    beneficiary_family_name: ["Pt3Line1a_FamilyName", "Pt3Line1_FamilyName"],
    beneficiary_given_name: ["Pt3Line1b_GivenName", "Pt3Line1_GivenName"],
    beneficiary_dob: ["Pt3Line6_DateOfBirth", "Pt3Line6_DOB", "DateOfBirth"],
    country_of_birth: ["Pt3Line8_CountryOfBirth", "CountryOfBirth"],
    country_of_citizenship: ["Pt3Line9_CountryOfCitzOrNationality", "CountryOfCitizenship", "Citizenship"],
    classification: ["Pt2Line1", "Classification"],
    occupation: ["Pt6Line1_JobTitle", "JobTitle", "Occupation"],
    highest_degree: ["HighestDegree", "Degree"],
    current_employer: ["Pt6Line2_Employer", "EmployerName", "Employer"],
    // WP-11: fields the client's intake fills. Patterns follow USCIS's Pt<part>Line<n>_<Name> tails.
    beneficiary_middle_name: ["Pt3Line1c_MiddleName", "Pt3Line1_MiddleName", "MiddleName"],
    city_of_birth: ["Pt3Line7_CityTownOfBirth", "CityTownOfBirth", "CityOfBirth"],
    alien_number: ["Pt3Line2_AlienNumber", "AlienNumber", "ANumber"],
    ssn: ["Pt3Line3_SSN", "SSN", "SocialSecurityNumber"],
    address_street: ["Pt3Line4_StreetNumberName", "StreetNumberName", "StreetName"],
    address_city: ["Pt3Line4_CityOrTown", "CityOrTown", "CityTown"],
    address_state: ["Pt3Line4_State", "Pt3Line4_Province", "State"],
    address_zip: ["Pt3Line4_ZipCode", "ZipCode", "PostalCode"],
    address_country: ["Pt3Line4_Country", "Country"],
    arrival_date: ["Pt3Line11_DateOfArrival", "DateOfArrival", "DateofArrival", "ArrivalDate"],
    i94_number: ["Pt3Line12_I94", "I94Number", "ArrivalDepartureRecord"],
    current_status: ["Pt3Line13_CurrentNonimmigrantStatus", "CurrentNonimmigrantStatus", "CurrentStatus"],
    status_expires: ["Pt3Line14_DateStatusExpires", "DateStatusExpires", "StatusExpires"],
    passport_number: ["Pt3Line15_PassportNumber", "PassportNumber", "PassportOrTravelDocNumber"],
    passport_country: ["Pt3Line17_CountryOfIssuance", "CountryOfIssuance", "IssuingCountry"],
    passport_expires: ["Pt3Line18_ExpirationDate", "PassportExpiration", "ExpDate"],
    email: ["Pt3Line5_Email", "EmailAddress", "Email"],
    phone: ["Pt3Line5_DaytimePhone", "DaytimeTelephone", "MobileTelephone", "Phone"],
  },
  "G-28": {
    attorney_name: ["Pt1Line2a_FamilyName", "Pt1Line2_FamilyName", "AttorneyFamilyName"],
    bar_number: ["Pt2Line1c_BarNumber", "BarNumber", "LicensingAuthority"],
    law_firm: ["Pt1Line3_NameofFirm", "NameofFirm", "FirmName", "Organization"],
    client_name: ["Pt3Line5a_FamilyName", "Pt3Line5_FamilyName", "ClientFamilyName"],
    // WP-11: the client's contact block on Part 3.
    client_address: ["Pt3Line7_StreetNumberName", "Pt3Line7_MailingAddress", "MailingAddress"],
    client_phone: ["Pt3Line6a_DaytimePhone", "Pt3Line6_DaytimeTelephone", "ClientDaytimePhone"],
    client_email: ["Pt3Line6c_Email", "Pt3Line6_Email", "ClientEmail"],
  },
  "I-907": {
    petitioner_name: ["Pt1Line1a_FamilyName", "Pt1Line1_FamilyName", "Pt1Line2_CompanyName"],
    beneficiary_name: ["Pt2Line3a_FamilyName", "Pt2Line3_FamilyName", "BeneficiaryFamilyName"],
    form_type: ["Pt2Line1_FormNumber", "FormNumber", "FormType"],
    classification: ["Pt2Line2_Classification", "Classification"],
  },
  "I-129": {
    petitioner_name: ["Pt1Line1_LegalName", "Pt1Line1a_FamilyName", "LegalNameofPetitioner"],
    beneficiary_family_name: ["Pt3Line1a_FamilyName", "Pt3Line1_FamilyName"],
    beneficiary_given_name: ["Pt3Line1b_GivenName", "Pt3Line1_GivenName"],
    classification: ["Pt2Line1", "Classification"],
    job_title: ["Pt5Line1_JobTitle", "JobTitle"],
    worksite: ["Pt5Line3", "Worksite", "Address"],
    // WP-11: the beneficiary block Part 3 asks for, filled from the client's intake.
    beneficiary_dob: ["Pt3Line3_DateOfBirth", "DateOfBirth", "DOB"],
    country_of_birth: ["Pt3Line5_CountryOfBirth", "CountryOfBirth"],
    country_of_citizenship: ["Pt3Line6_CountryOfCitizenship", "CountryOfCitizenship", "Citizenship"],
    alien_number: ["Pt3Line2_AlienNumber", "AlienNumber", "ANumber"],
    passport_number: ["Pt3Line9_PassportNumber", "PassportNumber"],
    passport_country: ["Pt3Line11_CountryOfIssuance", "CountryOfIssuance"],
    passport_expires: ["Pt3Line12_ExpirationDate", "PassportExpiration", "ExpDate"],
    arrival_date: ["Pt3Line8_DateOfArrival", "DateOfArrival", "DateofArrival", "ArrivalDate"],
    i94_number: ["Pt3Line8_I94", "I94Number", "ArrivalDepartureRecord"],
    current_status: ["Pt3Line8_CurrentNonimmigrantStatus", "CurrentNonimmigrantStatus", "CurrentStatus"],
    status_expires: ["Pt3Line8_DateStatusExpires", "DateStatusExpires", "StatusExpires"],
    address_street: ["Pt3Line4_StreetNumberName", "StreetNumberName", "StreetName"],
    address_city: ["Pt3Line4_CityOrTown", "CityOrTown", "CityTown"],
    address_state: ["Pt3Line4_State", "State"],
    address_zip: ["Pt3Line4_ZipCode", "ZipCode", "PostalCode"],
    wage: ["Pt5Line5_Wages", "Wages", "WagesPerYear"],
    start_date: ["Pt5Line4_DatesOfIntendedEmployment_From", "IntendedEmploymentFrom", "FromDate", "StartDate"],
    end_date: ["Pt5Line4_DatesOfIntendedEmployment_To", "IntendedEmploymentTo", "ToDate", "EndDate"],
  },
};

export type DiscoveredField = { name: string; type: "text" | "checkbox" | "dropdown" | "radio" | "other" };

function tail(name: string): string {
  // "form1[0].#subform[3].Pt3Line1a_FamilyName[0]" → "pt3line1a_familyname"
  const last = name.split(".").pop() ?? name;
  return last.replace(/\[\d+\]$/, "").toLowerCase();
}

/**
 * Map our fields to the official fields by substring on the name's tail. Returns the mapping for
 * every field in our catalog (null when the official form has nothing that fits) and the names of
 * official text fields no catalog field claimed, for the attorney to see.
 */
export function mapFieldNames(code: string, ourFields: string[], discovered: DiscoveredField[]): { mapped: Record<string, string | null>; unmapped: string[] } {
  const patterns = FIELD_MAP[code] ?? {};
  const texts = discovered.filter(d => d.type === "text");
  const taken = new Set<string>();
  const mapped: Record<string, string | null> = {};
  for (const field of ourFields) {
    let hit: string | null = null;
    for (const pattern of patterns[field] ?? []) {
      const p = pattern.toLowerCase();
      const found = texts.find(t => !taken.has(t.name) && tail(t.name).includes(p));
      if (found) { hit = found.name; break; }
    }
    if (hit) taken.add(hit);
    mapped[field] = hit;
  }
  const unmapped = texts.filter(t => !taken.has(t.name)).map(t => t.name);
  return { mapped, unmapped };
}

/** Values the record already knows before any fact is read: the client's name and the filing's classification. */
export function prefillValues(code: string, matter: { clientName: string; caseType: string | null }): { name: string; value: string }[] {
  const parts = matter.clientName.trim().split(/\s+/).filter(Boolean);
  const stripped = parts.filter(p => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(p));
  const given = stripped.slice(0, -1).join(" ");
  const family = stripped.length > 1 ? stripped[stripped.length - 1] : stripped[0] ?? "";
  const classification = matter.caseType === "EB1A" ? "203(b)(1)(A) Alien of extraordinary ability"
    : matter.caseType === "EB2-NIW" ? "203(b)(2) Advanced degree or exceptional ability, national interest waiver requested"
    : matter.caseType === "O1A" ? "O-1A" : matter.caseType === "H1B" ? "H-1B" : null;
  const out: { name: string; value: string }[] = [];
  const push = (name: string, value: string | null) => { if (value) out.push({ name, value }); };
  switch (code) {
    case "I-140":
      push("beneficiary_family_name", family); push("beneficiary_given_name", given); push("classification", classification);
      if (matter.caseType === "EB1A" || matter.caseType === "EB2-NIW") push("petitioner_name", matter.clientName.trim());
      break;
    case "G-28": push("client_name", matter.clientName.trim()); break;
    case "I-907":
      push("beneficiary_name", matter.clientName.trim()); push("classification", classification);
      push("form_type", matter.caseType === "O1A" || matter.caseType === "H1B" ? "I-129" : "I-140");
      break;
    case "I-129": push("beneficiary_family_name", family); push("beneficiary_given_name", given); push("classification", classification); break;
  }
  return out;
}

export type FormStatus = GovernmentForm["status"];

/** The form's life: review → approve → client signs → in the packet. Each ruling names the next truth. */
export function nextStatus(current: FormStatus, event: "prepare" | "fill" | "rule" | "approve" | "request_signature" | "sign" | "unapprove"): FormStatus {
  switch (event) {
    case "prepare": return current === "not_started" ? "opened" : current;
    case "fill": return current === "not_started" || current === "opened" ? "for_review" : current;
    case "rule": return current === "not_started" || current === "opened" ? "for_review" : current;
    case "approve": return current === "signed" || current === "awaiting_signature" ? current : "approved";
    case "request_signature":
      if (current !== "approved") throw new Error("Approve the form before asking the client to sign it.");
      return "awaiting_signature";
    case "sign":
      if (current !== "awaiting_signature") throw new Error("This form is not waiting for a signature.");
      return "signed";
    case "unapprove": return current === "approved" ? "for_review" : current;
  }
}

/** Load a PDF and list its fillable fields. Throws with a plain reason for XFA or unreadable files. */
export async function discoverFields(bytes: ArrayBuffer | Uint8Array): Promise<DiscoveredField[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const form = doc.getForm();
  const fields = form.getFields();
  if (fields.length === 0) {
    const acro = doc.catalog.lookup(PDFName.of("AcroForm"));
    const xfa = acro instanceof PDFDict && acro.has(PDFName.of("XFA"));
    throw new Error(xfa
      ? "USCIS publishes this form as an XFA document, which cannot be filled by software here. Enter the firm's values by hand on the official PDF."
      : "This PDF has no fillable fields.");
  }
  return fields.map(f => ({
    name: f.getName(),
    type: f instanceof PDFTextField ? "text" : f instanceof PDFCheckBox ? "checkbox" : f instanceof PDFDropdown ? "dropdown" : f instanceof PDFRadioGroup ? "radio" : "other",
  }));
}

/** Fill the official PDF with the mapped values. `flatten` bakes the values in for the packet. */
export async function fillPdf(template: ArrayBuffer | Uint8Array, values: { pdfField: string; value: string }[], options: { flatten: boolean }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(template, { ignoreEncryption: true, updateMetadata: false });
  const form = doc.getForm();
  for (const v of values) {
    let field;
    try { field = form.getField(v.pdfField); } catch { continue; }
    if (field instanceof PDFTextField) {
      try { field.setText(v.value.slice(0, field.getMaxLength() ?? 4000)); } catch { /* a combed field that refuses the length keeps its old value */ }
    } else if (field instanceof PDFCheckBox) {
      if (/^(yes|true|x|on|1)$/i.test(v.value.trim())) field.check(); else field.uncheck();
    } else if (field instanceof PDFDropdown) {
      try { field.select(v.value); } catch { /* not an option: leave it */ }
    } else if (field instanceof PDFRadioGroup) {
      try { field.select(v.value); } catch { /* not an option: leave it */ }
    }
  }
  if (options.flatten) form.flatten();
  return doc.save({ useObjectStreams: false });
}

/** Fetch the official template. Returns the bytes or a reason in words. */
export async function fetchTemplate(code: string): Promise<{ bytes: ArrayBuffer } | { error: string }> {
  const spec = FORM_TEMPLATES[code];
  if (!spec) return { error: `There is no official PDF on file for ${code}. The firm's admins can add one.` };
  let res: Response;
  try {
    res = await fetch(spec.url, { headers: { accept: "application/pdf", "user-agent": "Legal OS (immigration practice software)" }, cf: { cacheTtl: 86_400, cacheEverything: true } } as RequestInit);
  } catch (err) {
    return { error: `USCIS did not answer when the firm asked for ${code} (${err instanceof Error ? err.message : String(err)}). Try again in a moment.` };
  }
  if (!res.ok) return { error: `USCIS answered ${res.status} for ${code}. The form may have moved; try again later.` };
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return { error: `What USCIS sent for ${code} was not a PDF.` };
  return { bytes };
}

// ---- the public route for the rendered form ---------------------------------------------------

import { verifyFormSig } from "./portal.js";
import type { MatterStore } from "./store.js";

const FORM_ROUTE = /^(?:\/gatekeeper\/matter)?\/form\/([0-9a-f]{32})\/([A-Za-z0-9-]+)\.pdf$/;

/** GET /form/:matterId/:code.pdf?exp&sig streams the current render; null when the path is not ours. */
export async function handleFormRoutes(request: Request, env: Cloudflare.Env): Promise<Response | null> {
  const url = new URL(request.url);
  const m = FORM_ROUTE.exec(url.pathname);
  if (!m || request.method !== "GET") return null;
  const [, matterId, code] = m;
  if (!(await verifyFormSig(env, matterId, code, url.searchParams.get("exp") ?? "", url.searchParams.get("sig") ?? ""))) {
    return new Response("This link has expired.", { status: 403 });
  }
  const store: DurableObjectStub<MatterStore> = env.MATTER_STORE.get(env.MATTER_STORE.idFromName(matterId));
  const render = await store.formRender(code);
  if (!render) return new Response("This form has not been rendered yet.", { status: 404 });
  const obj = await env.MATTER_FILES.get(render.r2Key);
  if (!obj) return new Response("The rendered form is missing from storage.", { status: 404 });
  return new Response(obj.body, {
    headers: { "content-type": "application/pdf", "cache-control": "private, no-store", "content-disposition": `inline; filename="${code}.pdf"` },
  });
}
