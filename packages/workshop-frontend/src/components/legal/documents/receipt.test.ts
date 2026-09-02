import { describe, expect, it } from 'vitest'
import type { LegalDocument } from '@gadgets/workshop-shared/legal'
import { readingReceipt } from './receipt'

function doc(overrides: Partial<LegalDocument>): LegalDocument {
  return {
    id: 'x', filename: 'x.pdf', displayTitle: null, docType: null, mime: 'application/pdf', bytes: 10, pageCount: null,
    status: 'ready', uploadedBy: 'lawyer', relevance: 'included', factCount: 0, exhibitNo: null, note: null,
    uploadedAt: '2026-09-02T10:00:00.000Z', ...overrides,
  }
}

describe('readingReceipt', () => {
  const now = Date.parse('2026-09-02T10:02:30.000Z')

  it('is silent when nothing is being read', () => {
    expect(readingReceipt([doc({}), doc({ id: 'y', status: 'failed' })], now)).toBeNull()
  })

  it('counts the documents still being read against the live record and says how long', () => {
    const r = readingReceipt([
      doc({ id: 'a', status: 'reading', uploadedAt: '2026-09-02T10:00:00.000Z' }),
      doc({ id: 'b', status: 'queued', uploadedAt: '2026-09-02T10:01:00.000Z' }),
      doc({ id: 'c' }),
      doc({ id: 'old', status: 'superseded' }),
      doc({ id: 'aside', relevance: 'excluded' }),
    ], now)
    expect(r?.line).toBe('Reading 2 of 3 · 2 min')
  })

  it('says "just started" inside the first minute', () => {
    const r = readingReceipt([doc({ id: 'a', status: 'queued', uploadedAt: '2026-09-02T10:02:10.000Z' })], now)
    expect(r?.line).toBe('Reading 1 of 1 · just started')
  })
})
