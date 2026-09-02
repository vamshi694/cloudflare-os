import type { Deadline, MatterPhase } from '@gadgets/workshop-shared/legal'

/**
 * Lawyer-language labels. The UI speaks law, never machinery: every key the backend uses has a
 * sentence here, and an unmapped one falls back to something a lawyer can read.
 */

export const PHASE_LABEL: Record<MatterPhase, string> = {
  reading: 'Reading documents',
  not_understood: 'Documents read — understanding paused',
  knowledge: 'Building case knowledge',
  analysis: 'Analyzing the case',
  clearance: 'Awaiting your go-ahead',
  building: 'Drafting',
  review: 'Ready for your review',
  idle: 'Up to date',
  paused: 'Paused by you',
}

/** Underscores → spaces. Used on criterion keys, entity kinds, uploaders. */
export function tidy(s: string): string {
  const spaced = s.replace(/[_-]+/g, ' ').trim()
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : spaced
}

/** Title Case with the acronyms a filing uses fixed: "recommendation letter" → "Recommendation Letter". */
export function docLabel(t: string | null | undefined): string {
  if (!t) return 'Uncategorized'
  return t
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      const u = w.toUpperCase()
      if (u === 'USCIS' || u === 'CV' || u === 'RFE' || u === 'IEEE') return u
      return w[0].toUpperCase() + w.slice(1)
    })
    .join(' ')
}

/** "EB2-NIW — Abinaya M." → "Abinaya M.": the visa type already has its chip; never say it twice. */
export function matterTitle(title: string, caseType: string | null): string {
  if (!caseType) return title
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const t = title.trim()
  const m = /^(.+?)\s+[—–-]\s+(.+)$/.exec(t)
  if (m && norm(m[1]) === norm(caseType)) return m[2]
  if (norm(t).startsWith(norm(caseType)) && t.length > caseType.length + 1) {
    const rest = t.slice(caseType.length).replace(/^[\s—–:-]+/, '')
    if (rest) return rest
  }
  return t
}

export function caseTypeLabel(caseType: string | null | undefined): string {
  return caseType && caseType.trim() ? caseType : 'Strategy pending'
}

/** The formal petition title for the letter frame. */
export function petitionTitle(caseType: string | null): string {
  const k = (caseType ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (k.startsWith('EB1')) return 'I-140 Immigrant Petition for Alien of Extraordinary Ability (EB-1A)'
  if (k.includes('NIW') || k.startsWith('EB2')) return 'I-140 Immigrant Petition, National Interest Waiver (EB-2 NIW)'
  if (k.startsWith('H1B')) return 'I-129 Petition for H-1B Specialty Occupation Worker'
  if (k.startsWith('O1')) return 'I-129 Petition for O-1A Nonimmigrant of Extraordinary Ability'
  return caseType ? `Petition — ${caseType}` : 'Petition'
}

/** A filed petition runs about 450 words to the page: pages, never word counts. */
export const WORDS_PER_PAGE = 450
export function pagesOf(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_PAGE))
}

/** The verdict leads, the number recedes. */
export function reviewVerdict(score: number): { label: string; tone: string } {
  if (score >= 80) return { label: 'Reads filing-ready', tone: 'text-kumo-success' }
  if (score >= 60) return { label: 'Close — needs polish', tone: 'text-kumo-default' }
  if (score >= 40) return { label: 'Likely RFE as written', tone: 'text-kumo-warning' }
  return { label: 'Would not survive review', tone: 'text-kumo-danger' }
}

export const SEV_TONE: Record<'high' | 'medium' | 'low', string> = {
  high: 'text-kumo-danger',
  medium: 'text-kumo-warning',
  low: 'text-kumo-subtle',
}

export function chipTone(d: Deadline | null): 'overdue' | 'in_window' | 'later' | 'none' {
  if (!d) return 'none'
  return d.urgency
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "Mar 4" for chips, "Mar 4, 2026" for rows. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Strips markdown to plain text for one-line titles. */
export function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_`>#]+/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The three suggestion pills on an empty matter conversation. */
export const CONVERSATION_SUGGESTIONS = [
  'Where does this matter stand?',
  'What do you still need from the client?',
  'What are our weakest criteria, honestly?',
]

/**
 * The status row's lane line, from the record's counts: "Reading 12 of 40 documents", "Building
 * case knowledge 3 of 8", "Drafting 5 of 15 sections". Null when no lane is in flight. Mirrors
 * the matter worker's lanes.ts so both sides narrate the same way.
 */
export function narrateLane(lane: { kind: 'reading' | 'knowledge' | 'drafting'; done: number; total: number } | null): string | null {
  if (!lane || lane.total <= 0) return null
  const done = Math.min(lane.done, lane.total)
  if (lane.kind === 'reading') return `Reading ${done} of ${lane.total} ${lane.total === 1 ? 'document' : 'documents'}`
  if (lane.kind === 'knowledge') return `Building case knowledge ${done} of ${lane.total}`
  return `Drafting ${done} of ${lane.total} ${lane.total === 1 ? 'section' : 'sections'}`
}
