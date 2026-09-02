import type { Petition, PetitionSection } from '@gadgets/workshop-shared/legal'
import { pagesOf, WORDS_PER_PAGE } from '../labels'

/** Lawyer-language status — pages, never word counts. */
export function statusLabel(s: PetitionSection): string {
  if (s.status === 'drafted') return `≈ ${pagesOf(s.words)} ${pagesOf(s.words) === 1 ? 'page' : 'pages'}`
  if (s.status === 'held') return 'Held: awaiting client evidence'
  if (s.status === 'drafting') return 'the firm is rewriting…'
  return 'Not drafted yet'
}

/** Page ranges per section, in letter order: "pp. 3-5". */
export function pageRanges(sections: PetitionSection[]): Map<string, { start: number; end: number }> {
  const out = new Map<string, { start: number; end: number }>()
  let cursor = 1
  for (const s of sections) {
    if (s.status !== 'drafted') continue
    const pages = Math.max(1, Math.round(s.words / WORDS_PER_PAGE))
    out.set(s.key, { start: cursor, end: cursor + pages - 1 })
    cursor += pages
  }
  return out
}

export function totalPages(sections: PetitionSection[]): number {
  const words = sections.filter((s) => s.status === 'drafted').reduce((n, s) => n + s.words, 0)
  return words === 0 ? 0 : pagesOf(words)
}

export function draftedCount(p: Petition): { drafted: number; total: number } {
  return { drafted: p.sections.filter((s) => s.status === 'drafted').length, total: p.sections.length }
}

/** The mean review score across reviewed sections, or null. */
export function overallScore(p: Petition): number | null {
  const scored = p.sections.filter((s) => s.review)
  if (scored.length === 0) return null
  return Math.round(scored.reduce((n, s) => n + (s.review?.score ?? 0), 0) / scored.length)
}

export function highRiskCount(p: Petition): number {
  return p.sections.reduce((n, s) => n + (s.review?.weaknesses.filter((w) => w.severity === 'high').length ?? 0), 0)
}

/** The three weakest reviewed sections. */
export function weakest(p: Petition, n = 3): PetitionSection[] {
  return p.sections.filter((s) => s.review).sort((a, b) => (a.review!.score ?? 0) - (b.review!.score ?? 0)).slice(0, n)
}

/** A leading markdown heading that repeats the title is dropped (same rule the PDF export applies). */
export function bodyWithoutTitle(body: string, title: string): string {
  const lines = body.split('\n')
  const first = lines.findIndex((l) => l.trim() !== '')
  if (first >= 0 && /^#{1,3}\s+/.test(lines[first]) && lines[first].replace(/^#+\s+/, '').trim().toLowerCase() === title.trim().toLowerCase()) {
    return lines.slice(first + 1).join('\n')
  }
  return body
}

const EXHIBIT_RE = /\b(?:Exhibit|Ex\.)\s+(\d{1,3})\b/g

/** Rewrite "Exhibit 12" / "Ex. 8" to markdown links the sheet intercepts. */
export function linkExhibits(markdown: string): string {
  return markdown.replace(EXHIBIT_RE, (m, n: string) => `[${m}](#exhibit-${n})`)
}

/** Every sentence of the letter that cites exhibit N, per section. Scans the same text the sheet shows. */
export function citationsFor(p: Petition, exhibitNo: number): { section: string; sentence: string }[] {
  const out: { section: string; sentence: string }[] = []
  for (const s of p.sections) {
    if (s.status !== 'drafted') continue
    const sentences = s.body.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)
    for (const sent of sentences) {
      const re = new RegExp(`\\b(?:Exhibit|Ex\\.)\\s+${exhibitNo}\\b`)
      if (re.test(sent)) out.push({ section: s.title, sentence: sent.trim() })
    }
  }
  return out
}

export function exhibitNumbersIn(body: string): number[] {
  const set = new Set<number>()
  for (const m of body.matchAll(EXHIBIT_RE)) set.add(Number(m[1]))
  return [...set].sort((a, b) => a - b)
}
