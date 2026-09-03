// The client intake questionnaire: what the firm asks every beneficiary once, in plain words,
// so the government forms fill themselves and the counsel stops asking for the same facts.
//
// Pure: the schema per case type, completion math, and the prefill mapping from intake keys to
// the forms' catalog fields (see case-types.ts FORM_FIELDS and forms-pdf.ts FIELD_MAP). Answers
// are the client's own statements: assertions the firm relies on for forms, never evidence for
// the petition (Counsel OS doctrine: a claim in the beneficiary's own words is not proof).

export type IntakeQuestionType = "text" | "date" | "country" | "select" | "yesno" | "textarea";

export type IntakeQuestion = {
  /** Stable key, the unit of storage and of form prefill. */
  key: string;
  label: string;
  type: IntakeQuestionType;
  /** Plain-language help shown under the question. */
  help?: string;
  options?: string[];
  /** Counted toward completion. Optional questions never block "done". */
  required?: boolean;
  /** Shown only when another answer equals this value ("yes"/"no" for yesno). */
  showWhen?: { key: string; equals: string };
};

export type IntakeSection = { key: string; title: string; intro: string; questions: IntakeQuestion[] };

const COUNTRY: IntakeQuestionType = "country";

/** The biographic core every category shares. Keys never change once shipped: answers live by key. */
export const INTAKE_CORE: IntakeSection[] = [
  {
    key: "names", title: "Your name", intro: "Exactly as it appears in your passport. The forms must match it letter for letter.",
    questions: [
      { key: "family_name", label: "Family name (last name)", type: "text", required: true },
      { key: "given_name", label: "Given name (first name)", type: "text", required: true },
      { key: "middle_name", label: "Middle name", type: "text", help: "Leave blank if you have none." },
      { key: "other_names", label: "Other names you have used", type: "textarea", help: "Maiden names, previous legal names, aliases. One per line." },
    ],
  },
  {
    key: "birth", title: "Birth and citizenship", intro: "These go on every government form.",
    questions: [
      { key: "date_of_birth", label: "Date of birth", type: "date", required: true },
      { key: "city_of_birth", label: "City or town of birth", type: "text", required: true },
      { key: "country_of_birth", label: "Country of birth", type: COUNTRY, required: true },
      { key: "country_of_citizenship", label: "Country of citizenship or nationality", type: COUNTRY, required: true },
      { key: "second_citizenship", label: "Second citizenship, if any", type: COUNTRY },
      { key: "gender", label: "Sex as shown on your passport", type: "select", options: ["Female", "Male", "Another marker"], required: true },
      { key: "marital_status", label: "Marital status", type: "select", options: ["Single", "Married", "Divorced", "Widowed"], required: true },
    ],
  },
  {
    key: "passport", title: "Passport", intro: "From the bio page of your current passport. Upload a copy of the page too.",
    questions: [
      { key: "passport_number", label: "Passport number", type: "text", required: true },
      { key: "passport_country", label: "Country that issued it", type: COUNTRY, required: true },
      { key: "passport_issued", label: "Issue date", type: "date" },
      { key: "passport_expires", label: "Expiration date", type: "date", required: true },
    ],
  },
  {
    key: "identifiers", title: "Government numbers", intro: "Only if you have them. The firm keeps these private.",
    questions: [
      { key: "alien_number", label: "Alien Registration Number (A-Number)", type: "text", help: "Nine digits, on a prior USCIS notice or green card. Leave blank if none." },
      { key: "uscis_account", label: "USCIS Online Account Number", type: "text" },
      { key: "ssn", label: "U.S. Social Security Number", type: "text", help: "Leave blank if you have none." },
    ],
  },
  {
    key: "address", title: "Where you live", intro: "Your current home address, where USCIS can send mail.",
    questions: [
      { key: "in_us", label: "Are you in the United States now?", type: "yesno", required: true },
      { key: "address_street", label: "Street address", type: "text", required: true },
      { key: "address_unit", label: "Apartment, suite, or floor", type: "text" },
      { key: "address_city", label: "City or town", type: "text", required: true },
      { key: "address_state", label: "State or province", type: "text", required: true },
      { key: "address_zip", label: "ZIP or postal code", type: "text", required: true },
      { key: "address_country", label: "Country", type: COUNTRY, required: true },
      { key: "phone", label: "Mobile phone", type: "text" },
      { key: "email", label: "Email address", type: "text", required: true },
    ],
  },
  {
    key: "status", title: "Your status in the United States", intro: "From your most recent I-94 record and visa. Skip if you are outside the United States.",
    questions: [
      { key: "arrival_date", label: "Date of your last arrival in the United States", type: "date", showWhen: { key: "in_us", equals: "yes" } },
      { key: "i94_number", label: "I-94 Arrival/Departure Record number", type: "text", help: "Eleven characters, on cbp.gov/I94.", showWhen: { key: "in_us", equals: "yes" } },
      { key: "current_status", label: "Current immigration status", type: "select", options: ["H-1B", "H-4", "F-1", "F-1 OPT", "J-1", "L-1", "O-1", "TN", "B-1/B-2", "E-2", "Other"], showWhen: { key: "in_us", equals: "yes" } },
      { key: "status_expires", label: "Date your current status expires", type: "date", help: "The 'Admit Until' date on your I-94.", showWhen: { key: "in_us", equals: "yes" } },
      { key: "visa_number", label: "Visa number", type: "text", help: "The red number on your visa foil.", showWhen: { key: "in_us", equals: "yes" } },
      { key: "port_of_entry", label: "City where you last entered", type: "text", showWhen: { key: "in_us", equals: "yes" } },
    ],
  },
  {
    key: "history", title: "Immigration history", intro: "Everything you have filed or that was filed for you. The forms ask, and USCIS already knows.",
    questions: [
      { key: "prior_petitions", label: "Prior petitions or applications filed with USCIS", type: "textarea", help: "Form, year, result, receipt number if you have it. One per line. Write 'none' if none." },
      { key: "prior_visas", label: "Visas you have held", type: "textarea", help: "Type and years. One per line." },
      { key: "ever_denied", label: "Has any visa or petition ever been denied, or a visa revoked?", type: "yesno", required: true },
      { key: "denial_details", label: "Tell us what happened", type: "textarea", showWhen: { key: "ever_denied", equals: "yes" } },
      { key: "ever_removal", label: "Have you ever been in removal or deportation proceedings?", type: "yesno", required: true },
      { key: "ever_arrested", label: "Have you ever been arrested, cited, or charged anywhere in the world?", type: "yesno", required: true },
      { key: "arrest_details", label: "Tell us what happened", type: "textarea", showWhen: { key: "ever_arrested", equals: "yes" } },
      { key: "consular_post", label: "If you are outside the United States: the consulate where you would apply", type: "text", showWhen: { key: "in_us", equals: "no" } },
    ],
  },
  {
    key: "work", title: "Your work", intro: "Your current position. The firm uses it to describe your field.",
    questions: [
      { key: "occupation", label: "Occupation or job title", type: "text", required: true },
      { key: "employer", label: "Current employer", type: "text", help: "Or 'self-employed'." },
      { key: "employer_address", label: "Employer address", type: "textarea" },
      { key: "employment_start", label: "Start date at this employer", type: "date" },
      { key: "annual_salary", label: "Annual salary (USD)", type: "text" },
      { key: "field", label: "Your field, in one line", type: "text", help: "As you would say it to a colleague outside your specialty.", required: true },
    ],
  },
  {
    key: "education", title: "Education", intro: "Highest degree first.",
    questions: [
      { key: "highest_degree", label: "Highest degree", type: "select", options: ["Doctorate", "Master's", "Bachelor's", "Professional degree", "Other"], required: true },
      { key: "degree_field", label: "Field of the degree", type: "text", required: true },
      { key: "degree_school", label: "School and country", type: "text", required: true },
      { key: "degree_year", label: "Year awarded", type: "text", required: true },
      { key: "other_degrees", label: "Other degrees", type: "textarea", help: "Degree, field, school, year. One per line." },
    ],
  },
  {
    key: "family", title: "Family", intro: "Spouse and children who may file with you.",
    questions: [
      { key: "spouse_name", label: "Spouse's full name", type: "text", showWhen: { key: "marital_status", equals: "Married" } },
      { key: "spouse_dob", label: "Spouse's date of birth", type: "date", showWhen: { key: "marital_status", equals: "Married" } },
      { key: "spouse_citizenship", label: "Spouse's citizenship", type: COUNTRY, showWhen: { key: "marital_status", equals: "Married" } },
      { key: "children", label: "Children under 21", type: "textarea", help: "Name, date of birth, country of birth. One per line. Write 'none' if none." },
    ],
  },
];

/** The category-specific blocks. Keys stay distinct from the core. */
export const INTAKE_BY_CASE: Record<string, IntakeSection[]> = {
  EB1A: [{
    key: "eb1a", title: "Your standing in the field", intro: "The firm builds the petition from documents, not from this page. These answers tell the firm where to look.",
    questions: [
      { key: "awards", label: "Awards and prizes you have received", type: "textarea", help: "Name, year, who gives it, how many receive it. One per line.", required: true },
      { key: "memberships", label: "Professional associations that admitted you on your achievements", type: "textarea" },
      { key: "press", label: "Articles or coverage about you and your work", type: "textarea", help: "Publication, date, title." },
      { key: "judging", label: "Times you judged others' work", type: "textarea", help: "Peer review, panels, competitions, editorial roles." },
      { key: "contributions", label: "Your most important contributions, in your words", type: "textarea", required: true },
      { key: "publications_count", label: "Number of publications and citations, if you know them", type: "text" },
      { key: "leading_roles", label: "Leading or critical roles you have held", type: "textarea" },
      { key: "salary_evidence", label: "Evidence that your pay is high for the field", type: "textarea" },
      { key: "intent", label: "What you will do in the United States", type: "textarea", required: true },
    ],
  }],
  "EB2-NIW": [{
    key: "niw", title: "Your proposed endeavor", intro: "The waiver turns on what you will do and why it matters to the United States.",
    questions: [
      { key: "endeavor", label: "Your proposed endeavor, in your words", type: "textarea", required: true },
      { key: "national_importance", label: "Why it matters nationally", type: "textarea", required: true },
      { key: "positioned", label: "Why you are well positioned to advance it", type: "textarea", required: true },
      { key: "advanced_degree", label: "Do you hold an advanced degree (master's or higher), or a bachelor's plus five years of progressive experience?", type: "yesno", required: true },
      { key: "funding", label: "Funding, contracts, or partners already in place", type: "textarea" },
    ],
  }],
  O1A: [{
    key: "o1a", title: "The petition and your standing", intro: "An O-1A is filed by a petitioner or agent for a period of work.",
    questions: [
      { key: "petitioner", label: "Who will petition for you (employer or agent)", type: "text", required: true },
      { key: "job_title", label: "Job title for the petition", type: "text", required: true },
      { key: "start_date", label: "Requested start date", type: "date", required: true },
      { key: "end_date", label: "Requested end date", type: "date", required: true },
      { key: "wage", label: "Offered wage", type: "text" },
      { key: "awards", label: "Awards and prizes you have received", type: "textarea", required: true },
      { key: "contributions", label: "Your most important contributions, in your words", type: "textarea", required: true },
      { key: "advisory_opinion", label: "A peer group or union that could give an advisory opinion", type: "text" },
    ],
  }],
  H1B: [{
    key: "h1b", title: "The job", intro: "The petition is filed by your employer for a specialty occupation.",
    questions: [
      { key: "petitioner", label: "Employer petitioning for you", type: "text", required: true },
      { key: "job_title", label: "Job title", type: "text", required: true },
      { key: "job_duties", label: "Main duties, in a few lines", type: "textarea", required: true },
      { key: "worksite", label: "Primary worksite address", type: "textarea", required: true },
      { key: "wage", label: "Offered wage", type: "text", required: true },
      { key: "start_date", label: "Requested start date", type: "date", required: true },
      { key: "end_date", label: "Requested end date", type: "date" },
      { key: "cap_exempt", label: "Is the employer cap-exempt (a university, nonprofit research organization, or government research organization)?", type: "yesno" },
      { key: "prior_h1b", label: "Have you held H-1B status before?", type: "yesno", required: true },
    ],
  }],
};

export function intakeSchema(caseType: string | null): IntakeSection[] {
  const key = (caseType ?? "").toUpperCase().replace(/\s+/g, "-").replace(/^EB1A$|^EB-1A$/, "EB1A").replace(/^EB2-?NIW$/, "EB2-NIW").replace(/^O-?1A$/, "O1A").replace(/^H-?1B$/, "H1B");
  return [...INTAKE_CORE, ...(INTAKE_BY_CASE[key] ?? [])];
}

export type IntakeAnswers = Record<string, string>;

/** Whether a question applies given the answers so far. */
export function questionApplies(q: IntakeQuestion, answers: IntakeAnswers): boolean {
  if (!q.showWhen) return true;
  return (answers[q.showWhen.key] ?? "") === q.showWhen.equals;
}

export type IntakeCompletion = { done: number; total: number; sectionsLeft: string[]; complete: boolean };

/** Required questions that apply, answered vs total; sections with anything required still open. */
export function intakeCompletion(schema: IntakeSection[], answers: IntakeAnswers): IntakeCompletion {
  let done = 0; let total = 0;
  const sectionsLeft: string[] = [];
  for (const s of schema) {
    let open = false;
    for (const q of s.questions) {
      if (!q.required || !questionApplies(q, answers)) continue;
      total += 1;
      if ((answers[q.key] ?? "").trim()) done += 1; else open = true;
    }
    if (open) sectionsLeft.push(s.title);
  }
  return { done, total, sectionsLeft, complete: total > 0 && done === total };
}

/**
 * Which forms' catalog fields each intake key feeds. A composed value (a full address, a full
 * name) is built from several keys. Every target must exist in FORM_FIELDS (tested).
 */
export const INTAKE_FORM_KEYS: Record<string, Record<string, string | string[]>> = {
  "I-140": {
    beneficiary_family_name: "family_name", beneficiary_given_name: "given_name", beneficiary_middle_name: "middle_name",
    beneficiary_dob: "date_of_birth", city_of_birth: "city_of_birth", country_of_birth: "country_of_birth",
    country_of_citizenship: "country_of_citizenship", alien_number: "alien_number", ssn: "ssn",
    address_street: ["address_street", "address_unit"], address_city: "address_city", address_state: "address_state",
    address_zip: "address_zip", address_country: "address_country", arrival_date: "arrival_date", i94_number: "i94_number",
    current_status: "current_status", status_expires: "status_expires", passport_number: "passport_number",
    passport_country: "passport_country", passport_expires: "passport_expires", occupation: "occupation",
    highest_degree: "highest_degree", current_employer: "employer", email: "email", phone: "phone",
  },
  "G-28": {
    client_name: ["given_name", "middle_name", "family_name"], client_address: ["address_street", "address_unit", "address_city", "address_state", "address_zip", "address_country"],
    client_phone: "phone", client_email: "email",
  },
  "I-907": { beneficiary_name: ["given_name", "middle_name", "family_name"] },
  "I-129": {
    beneficiary_family_name: "family_name", beneficiary_given_name: "given_name", beneficiary_dob: "date_of_birth",
    country_of_birth: "country_of_birth", country_of_citizenship: "country_of_citizenship", alien_number: "alien_number",
    passport_number: "passport_number", passport_country: "passport_country", passport_expires: "passport_expires",
    arrival_date: "arrival_date", i94_number: "i94_number", current_status: "current_status", status_expires: "status_expires",
    address_street: ["address_street", "address_unit"], address_city: "address_city", address_state: "address_state", address_zip: "address_zip",
    petitioner_name: "petitioner", job_title: "job_title", wage: "wage", start_date: "start_date", end_date: "end_date", worksite: "worksite",
  },
};

/** The values a form gets from the intake. Only fields with a non-empty composed value. */
export function prefillFromIntake(code: string, answers: IntakeAnswers): { name: string; value: string }[] {
  const map = INTAKE_FORM_KEYS[code] ?? {};
  const out: { name: string; value: string }[] = [];
  for (const [field, source] of Object.entries(map)) {
    const keys = Array.isArray(source) ? source : [source];
    const value = keys.map(k => (answers[k] ?? "").trim()).filter(Boolean).join(field.endsWith("address") ? ", " : " ");
    if (value) out.push({ name: field, value });
  }
  return out;
}

/** Every intake key that feeds at least one form, for the client tab's "what these answers fill". */
export function feedsForms(key: string): string[] {
  const out = new Set<string>();
  for (const [code, map] of Object.entries(INTAKE_FORM_KEYS)) {
    for (const source of Object.values(map)) if ((Array.isArray(source) ? source : [source]).includes(key)) out.add(code);
  }
  return [...out];
}
