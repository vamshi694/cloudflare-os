// The case type catalog: for each visa the firm practices, the petition's sections, the criterion
// each argues, what it must prove, and the government forms the filing submits. Runtime-free.
//
// Section keys are the vocabulary the case knowledge, readiness, the petition and the screens all
// share; change a key here and every claim tagged with it goes stale, so treat keys as frozen.

import type { CaseTypeSpec, CriterionSpec } from "@gadgets/workshop-shared/legal";

function s(key: string, title: string, criterion: string, purpose: string, evidentiary = true): CriterionSpec {
  return { key, title, criterion, purpose, evidentiary };
}

const INTRO = s("introduction", "Introduction", "Framing",
  "States who the beneficiary is, the classification sought, and the criteria the petition satisfies.", false);
const CONCLUSION = s("conclusion", "Conclusion", "Closing",
  "Restates the criteria met and requests approval.", false);

export const CASE_TYPES: CaseTypeSpec[] = [
  {
    key: "EB1A",
    title: "EB-1A Extraordinary Ability",
    petitionTitle: "I-140 Immigrant Petition for Alien of Extraordinary Ability (EB-1A)",
    required: 3,
    sections: [
      INTRO,
      s("background", "The beneficiary and the field", "Background",
        "Describes the beneficiary's field, career and standing so the criteria that follow read in context.", false),
      s("awards", "Nationally or internationally recognized prizes or awards", "8 CFR 204.5(h)(3)(i)",
        "Proves receipt of lesser nationally or internationally recognized prizes or awards for excellence in the field."),
      s("membership", "Membership in associations requiring outstanding achievement", "8 CFR 204.5(h)(3)(ii)",
        "Proves membership in associations that require outstanding achievements of their members, as judged by recognized experts."),
      s("published_material", "Published material about the beneficiary", "8 CFR 204.5(h)(3)(iii)",
        "Proves published material about the beneficiary in professional, major trade, or other major media."),
      s("judging", "Judging the work of others", "8 CFR 204.5(h)(3)(iv)",
        "Proves participation, individually or on a panel, as a judge of the work of others in the field."),
      s("original_contributions", "Original contributions of major significance", "8 CFR 204.5(h)(3)(v)",
        "Proves original scientific, scholarly, artistic, athletic or business contributions of major significance in the field."),
      s("scholarly_articles", "Authorship of scholarly articles", "8 CFR 204.5(h)(3)(vi)",
        "Proves authorship of scholarly articles in professional or major trade publications or other major media."),
      s("exhibitions", "Display of work at exhibitions or showcases", "8 CFR 204.5(h)(3)(vii)",
        "Proves display of the beneficiary's work at artistic exhibitions or showcases."),
      s("leading_role", "Leading or critical role for distinguished organizations", "8 CFR 204.5(h)(3)(viii)",
        "Proves a leading or critical role for organizations or establishments with a distinguished reputation."),
      s("high_salary", "High salary or remuneration", "8 CFR 204.5(h)(3)(ix)",
        "Proves a high salary or other significantly high remuneration relative to others in the field."),
      s("commercial_success", "Commercial success in the performing arts", "8 CFR 204.5(h)(3)(x)",
        "Proves commercial success in the performing arts, shown by box office receipts or sales."),
      s("final_merits", "Final merits determination", "Kazarian v. USCIS",
        "Argues, on the whole record, that the beneficiary has sustained national or international acclaim and is among the small percentage at the very top of the field.", false),
      CONCLUSION,
    ],
    forms: [
      { code: "I-140", title: "Immigrant Petition for Alien Workers", filedOnline: false },
      { code: "G-28", title: "Notice of Entry of Appearance as Attorney", filedOnline: false },
      { code: "I-907", title: "Request for Premium Processing Service", filedOnline: false },
    ],
  },
  {
    key: "EB2-NIW",
    title: "EB-2 National Interest Waiver",
    petitionTitle: "I-140 Immigrant Petition, National Interest Waiver (EB-2 NIW)",
    required: 3,
    sections: [
      INTRO,
      s("qualification", "Advanced degree or exceptional ability", "8 CFR 204.5(k)(2)",
        "Proves the beneficiary holds an advanced degree or has exceptional ability in the sciences, arts or business."),
      s("substantial_merit", "Substantial merit and national importance", "Matter of Dhanasar, prong one",
        "Proves the proposed endeavor has both substantial merit and national importance."),
      s("well_positioned", "Well positioned to advance the endeavor", "Matter of Dhanasar, prong two",
        "Proves the beneficiary is well positioned to advance the proposed endeavor: education, skills, record of success, plan, progress and interest."),
      s("balance", "On balance, waiving the labor certification benefits the United States", "Matter of Dhanasar, prong three",
        "Proves that, on balance, it would be beneficial to the United States to waive the job offer and labor certification requirements."),
      CONCLUSION,
    ],
    forms: [
      { code: "I-140", title: "Immigrant Petition for Alien Workers", filedOnline: false },
      { code: "ETA-9089", title: "Application for Permanent Employment Certification (NIW appendix)", filedOnline: false },
      { code: "G-28", title: "Notice of Entry of Appearance as Attorney", filedOnline: false },
      { code: "I-907", title: "Request for Premium Processing Service", filedOnline: false },
    ],
  },
  {
    key: "O1A",
    title: "O-1A Extraordinary Ability",
    petitionTitle: "I-129 Petition for O-1A Nonimmigrant Worker of Extraordinary Ability",
    required: 3,
    sections: [
      INTRO,
      s("awards", "Nationally or internationally recognized prizes or awards", "8 CFR 214.2(o)(3)(iii)(B)(1)",
        "Proves receipt of nationally or internationally recognized prizes or awards for excellence in the field."),
      s("membership", "Membership in associations requiring outstanding achievement", "8 CFR 214.2(o)(3)(iii)(B)(2)",
        "Proves membership in associations that require outstanding achievements, as judged by recognized experts."),
      s("published_material", "Published material about the beneficiary", "8 CFR 214.2(o)(3)(iii)(B)(3)",
        "Proves published material in professional or major trade publications or major media about the beneficiary."),
      s("judging", "Judging the work of others", "8 CFR 214.2(o)(3)(iii)(B)(4)",
        "Proves participation as a judge of the work of others in the same or an allied field."),
      s("original_contributions", "Original contributions of major significance", "8 CFR 214.2(o)(3)(iii)(B)(5)",
        "Proves original scientific, scholarly or business-related contributions of major significance."),
      s("scholarly_articles", "Authorship of scholarly articles", "8 CFR 214.2(o)(3)(iii)(B)(6)",
        "Proves authorship of scholarly articles in professional journals or other major media."),
      s("critical_role", "Critical capacity for distinguished organizations", "8 CFR 214.2(o)(3)(iii)(B)(7)",
        "Proves employment in a critical or essential capacity for organizations with a distinguished reputation."),
      s("high_salary", "High salary or remuneration", "8 CFR 214.2(o)(3)(iii)(B)(8)",
        "Proves a high salary or other remuneration for services, evidenced by contracts or other reliable evidence."),
      s("itinerary", "The engagement and the itinerary", "8 CFR 214.2(o)(2)(ii)",
        "Describes the petitioner, the engagement, the consultation and the period of stay.", false),
      CONCLUSION,
    ],
    forms: [
      { code: "I-129", title: "Petition for a Nonimmigrant Worker", filedOnline: false },
      { code: "I-129-O", title: "O and P Classifications Supplement to Form I-129", filedOnline: false },
      { code: "G-28", title: "Notice of Entry of Appearance as Attorney", filedOnline: false },
      { code: "I-907", title: "Request for Premium Processing Service", filedOnline: false },
    ],
  },
  {
    key: "H1B",
    title: "H-1B Specialty Occupation",
    petitionTitle: "I-129 Petition for H-1B Specialty Occupation Worker",
    required: 3,
    sections: [
      INTRO,
      s("specialty_occupation", "The position is a specialty occupation", "8 CFR 214.2(h)(4)(iii)(A)",
        "Proves the position requires the theoretical and practical application of a body of highly specialized knowledge and at least a bachelor's degree in a specific specialty."),
      s("beneficiary_qualifications", "The beneficiary is qualified", "8 CFR 214.2(h)(4)(iii)(C)",
        "Proves the beneficiary holds the required degree or its equivalent and any license the occupation requires."),
      s("employer_relationship", "The employer-employee relationship", "8 CFR 214.2(h)(4)(ii)",
        "Proves the petitioner will hire, pay, supervise and control the beneficiary's work for the whole period."),
      s("lca_wage", "The labor condition application and the wage", "20 CFR 655.731",
        "Proves a certified LCA covers the position and the offered wage meets the required wage."),
      CONCLUSION,
    ],
    forms: [
      { code: "I-129", title: "Petition for a Nonimmigrant Worker", filedOnline: false },
      { code: "I-129-H", title: "H Classification Supplement to Form I-129", filedOnline: false },
      { code: "I-129-HDC", title: "H-1B Data Collection and Filing Fee Exemption Supplement", filedOnline: false },
      { code: "ETA-9035", title: "Labor Condition Application", filedOnline: true },
      { code: "G-28", title: "Notice of Entry of Appearance as Attorney", filedOnline: false },
    ],
  },
];

/** Normalize the many spellings ("EB-1A", "eb1a", "EB 1A") to the catalog key. */
export function normalizeCaseType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (k === "EB1A" || k === "EB1") return "EB1A";
  if (k === "EB2NIW" || k === "NIW" || k === "EB2") return "EB2-NIW";
  if (k === "O1A" || k === "O1") return "O1A";
  if (k === "H1B") return "H1B";
  return raw.trim().toUpperCase().replace(/\s+/g, "-");
}

export function caseTypeSpec(key: string | null | undefined): CaseTypeSpec | null {
  const k = normalizeCaseType(key);
  return CASE_TYPES.find(c => c.key === k) ?? null;
}

export function petitionTitleFor(key: string | null | undefined): string {
  return caseTypeSpec(key)?.petitionTitle ?? (key ? `Petition — ${key}` : "Petition");
}

/** The starter field set the firm fills on each form. Values carry their source fact. */
export const FORM_FIELDS: Record<string, { name: string; label: string }[]> = {
  "I-140": [
    { name: "petitioner_name", label: "Petitioner name" },
    { name: "beneficiary_family_name", label: "Beneficiary family name" },
    { name: "beneficiary_given_name", label: "Beneficiary given name" },
    { name: "beneficiary_dob", label: "Beneficiary date of birth" },
    { name: "country_of_birth", label: "Country of birth" },
    { name: "country_of_citizenship", label: "Country of citizenship" },
    { name: "classification", label: "Classification requested" },
    { name: "occupation", label: "Occupation" },
    { name: "highest_degree", label: "Highest degree" },
    { name: "current_employer", label: "Current employer" },
  ],
  "G-28": [
    { name: "attorney_name", label: "Attorney name" },
    { name: "bar_number", label: "Bar number" },
    { name: "law_firm", label: "Law firm" },
    { name: "client_name", label: "Client name" },
  ],
  "I-907": [
    { name: "petitioner_name", label: "Petitioner name" },
    { name: "beneficiary_name", label: "Beneficiary name" },
    { name: "form_type", label: "Underlying form" },
    { name: "classification", label: "Classification" },
  ],
  "ETA-9089": [
    { name: "employer_name", label: "Employer or self-petitioner" },
    { name: "job_title", label: "Job title" },
    { name: "worksite", label: "Primary worksite" },
    { name: "education_level", label: "Education level" },
  ],
  "I-129": [
    { name: "petitioner_name", label: "Petitioner name" },
    { name: "beneficiary_family_name", label: "Beneficiary family name" },
    { name: "beneficiary_given_name", label: "Beneficiary given name" },
    { name: "beneficiary_dob", label: "Beneficiary date of birth" },
    { name: "classification", label: "Classification requested" },
    { name: "job_title", label: "Job title" },
    { name: "wage", label: "Offered wage" },
    { name: "start_date", label: "Requested start date" },
    { name: "end_date", label: "Requested end date" },
  ],
  "I-129-O": [
    { name: "field", label: "Field of extraordinary ability" },
    { name: "consultation", label: "Consultation obtained from" },
    { name: "itinerary", label: "Itinerary or engagement" },
  ],
  "I-129-H": [
    { name: "specialty_occupation", label: "Specialty occupation" },
    { name: "degree_required", label: "Degree required" },
    { name: "beneficiary_degree", label: "Beneficiary's degree" },
    { name: "lca_number", label: "LCA case number" },
  ],
  "I-129-HDC": [
    { name: "employer_size", label: "Employer size" },
    { name: "cap_exempt", label: "Cap exemption basis" },
    { name: "fee_exemptions", label: "Fee exemptions claimed" },
  ],
  "ETA-9035": [
    { name: "job_title", label: "Job title" },
    { name: "soc_code", label: "SOC code" },
    { name: "wage_level", label: "Prevailing wage level" },
    { name: "worksite", label: "Worksite" },
  ],
};
