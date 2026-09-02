// The reading receipt: "Reading 3 of 12 · 2 min", from the record itself. Never a bar: nothing
// here measures progress, only how many documents the firm is still on and for how long.

import type { LegalDocument } from '@gadgets/workshop-shared/legal'

export type ReadingReceipt = { reading: number; total: number; elapsedMs: number; line: string }

export function readingReceipt(docs: LegalDocument[], now: number = Date.now()): ReadingReceipt | null {
  const onRecord = docs.filter((d) => d.status !== 'superseded' && d.relevance !== 'excluded')
  const busy = onRecord.filter((d) => d.status === 'queued' || d.status === 'reading')
  if (busy.length === 0) return null
  const started = Math.min(...busy.map((d) => new Date(d.uploadedAt).getTime()).filter((t) => Number.isFinite(t)))
  const elapsedMs = Number.isFinite(started) ? Math.max(0, now - started) : 0
  const minutes = Math.floor(elapsedMs / 60_000)
  const since = minutes < 1 ? 'just started' : minutes === 1 ? '1 min' : `${minutes} min`
  return { reading: busy.length, total: onRecord.length, elapsedMs, line: `Reading ${busy.length} of ${onRecord.length} · ${since}` }
}
