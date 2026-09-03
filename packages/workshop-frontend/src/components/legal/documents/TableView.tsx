import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import type { RpcStub } from 'capnweb'
import type { LegalDocument, MatterDesk, TableCell, TableView as TableViewData } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { DownloadSimple, Plus, X } from '@phosphor-icons/react'
import { logRpcFailure } from '../../../rpcErrors'
import { WorkshopButton, WorkshopInput } from '../../WorkshopControls'
import { EmptyLine, Notice, Skeleton, StatusDot } from '../primitives'
import { useDeskData } from '../useMatterDesk'
import { docLabel } from '../labels'

/**
 * TABULAR REVIEW — the record as a grid: every read document a row, every question a column, every
 * cell an answer with the page it sits on and the words it rests on. The firm's own columns fill
 * without asking; a question the lawyer types becomes a column answered document by document.
 * Nothing here is evidence the petition may cite; the facts are. This is how a lawyer reads the
 * record the way a reviewer reads a data room.
 */
export function TableView({
  desk,
  docs,
  onOpenAtPage,
}: {
  desk: RpcStub<MatterDesk>
  docs: LegalDocument[]
  onOpenAtPage: (doc: LegalDocument, page: number | null) => void
}) {
  const toasts = useKumoToastManager()
  const load = useCallback(() => desk.tableView(), [desk])
  const [pollMs, setPollMs] = useState(15000)
  const { data: view, failed, reload } = useDeskData<TableViewData>(load, { pollMs })
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState<'ask' | 'refresh' | 'csv' | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  // Poll faster while the firm is answering; settle down when the grid is still.
  useEffect(() => setPollMs(view && view.running > 0 ? 4000 : 15000), [view])

  // The firm's own columns answer themselves once the grid is opened for documents it has not seen.
  const unanswered = useMemo(() => (view ? view.rows.some((r) => Object.values(r.cells).some((c) => c.status === 'pending')) : false), [view])
  useEffect(() => {
    if (!unanswered) return
    desk.refreshTable().then((r) => { if (r.queued > 0) reload() }).catch((err) => logRpcFailure('Failed to refresh the review grid:', err))
    // Runs when the grid first shows pending cells; the poll picks up the answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unanswered])

  const byId = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs])

  const ask = async (e: FormEvent) => {
    e.preventDefault()
    const q = question.trim()
    if (!q || busy) return
    setBusy('ask')
    try {
      await desk.addTableQuestion(q)
      setQuestion('')
      reload()
    } catch (err) {
      logRpcFailure('Failed to add a question:', err)
      toasts.add({ title: `The question was not added: ${err instanceof Error ? err.message : 'try again'}. The grid is unchanged.`, variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const remove = async (key: string) => {
    if (busy) return
    setRemoving(key)
    try {
      await desk.removeTableQuestion(key)
      reload()
    } catch (err) {
      logRpcFailure('Failed to remove a question:', err)
      toasts.add({ title: 'The column was not removed. The grid is unchanged — try again.', variant: 'error' })
    } finally {
      setRemoving(null)
    }
  }

  const refresh = async () => {
    if (busy) return
    setBusy('refresh')
    try {
      const r = await desk.refreshTable()
      toasts.add({ title: r.queued === 0 ? 'Every cell is answered.' : `Answering ${r.queued} document${r.queued === 1 ? '' : 's'}.`, variant: 'success' })
      reload()
    } catch (err) {
      logRpcFailure('Failed to refresh the review grid:', err)
      toasts.add({ title: 'The grid was not refreshed. Nothing has changed — try again.', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  // The viewer's sandbox blocks page-started downloads in some hosts; a Blob URL opened in a new
  // tab is the path that works everywhere the app runs.
  const exportCsv = async () => {
    if (busy) return
    setBusy('csv')
    try {
      const csv = await desk.tableCsv()
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'review-grid.csv'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      logRpcFailure('Failed to export the review grid:', err)
      toasts.add({ title: 'The CSV was not produced. The grid is unchanged — try again.', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  if (view === null) {
    if (failed) return <Notice title="The review grid couldn't be read just now." body="The record is unchanged — this view keeps retrying." />
    return (
      <div className="space-y-2">
        <Skeleton className="h-[40px]" />
        <Skeleton className="h-[40px]" />
        <Skeleton className="h-[40px]" />
      </div>
    )
  }

  const answered = view.rows.reduce((n, r) => n + Object.values(r.cells).filter((c) => c.status === 'answered').length, 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => void ask(e)} className="flex min-w-0 flex-1 items-center gap-1.5">
          <WorkshopInput
            value={question}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuestion(e.target.value)}
            placeholder="Ask every document a question, e.g. Who signed it?"
            className="w-full max-w-[420px] !h-8"
            aria-label="A question for every document"
          />
          <WorkshopButton tone="primary" className="!h-8 gap-1" disabled={!question.trim() || busy !== null}>
            <Plus size={13} /> {busy === 'ask' ? 'Adding…' : 'Add column'}
          </WorkshopButton>
        </form>
        <div className="ml-auto flex items-center gap-1.5">
          <WorkshopButton className="!h-8" onClick={() => void refresh()} disabled={busy !== null}>
            {busy === 'refresh' ? 'Asking…' : 'Answer what is missing'}
          </WorkshopButton>
          <WorkshopButton className="!h-8 gap-1.5" onClick={() => void exportCsv()} disabled={busy !== null || view.rows.length === 0}>
            <DownloadSimple size={13} /> CSV
          </WorkshopButton>
        </div>
      </div>

      {failed && <p className="m-0 text-[12.5px] italic text-kumo-subtle">Not updating right now — showing the last view that loaded.</p>}
      {view.running > 0 && (
        <p className="tnum m-0 flex items-center gap-2 text-[12.5px] text-kumo-subtle" aria-live="polite">
          <StatusDot tone="working" className="breathe" /> Answering {view.running} of {view.total} cells
        </p>
      )}

      {view.rows.length === 0 ? (
        <EmptyLine title="Nothing to review yet." body="The grid fills with each document the firm reads." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-kumo-line bg-kumo-base">
          <table className="w-full border-collapse text-[13px] leading-[18px] text-kumo-default">
            <thead>
              <tr className="border-b border-kumo-line bg-kumo-tint/60">
                <th scope="col" className="sticky left-0 z-[1] min-w-[220px] bg-kumo-tint px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-kumo-subtle">
                  Document
                </th>
                {view.columns.map((c) => (
                  <th key={c.key} scope="col" className="min-w-[180px] max-w-[320px] px-3 py-2 text-left align-top text-[11px] font-medium uppercase tracking-[0.08em] text-kumo-subtle">
                    <span className="flex items-start gap-1.5">
                      <span className="normal-case tracking-normal" title={c.question}>{columnTitle(c.key, c.question)}</span>
                      {c.custom && (
                        <button
                          type="button"
                          onClick={() => void remove(c.key)}
                          disabled={removing === c.key}
                          aria-label={`Remove the column "${c.question}"`}
                          className="press cursor-pointer rounded text-kumo-inactive hover:text-kumo-default"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => {
                const doc = byId.get(r.documentId)
                return (
                  <tr key={r.documentId} className="border-b border-kumo-line last:border-b-0 hover:bg-kumo-tint/40">
                    <th scope="row" className="sticky left-0 z-[1] bg-kumo-base px-3 py-2 text-left align-top font-normal">
                      <button
                        type="button"
                        onClick={() => doc && onOpenAtPage(doc, null)}
                        className="press cursor-pointer text-left text-[13px] font-medium text-kumo-default hover:underline"
                      >
                        {r.title}
                      </button>
                      {r.docType && <p className="m-0 mt-0.5 text-[11.5px] text-kumo-subtle">{docLabel(r.docType)}</p>}
                    </th>
                    {view.columns.map((c) => (
                      <td key={c.key} className="max-w-[320px] px-3 py-2 align-top">
                        <Cell cell={r.cells[c.key]} onOpen={(page) => doc && onOpenAtPage(doc, page)} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="tnum m-0 text-[12px] text-kumo-subtle">
        {view.rows.length} document{view.rows.length === 1 ? '' : 's'} · {answered} answer{answered === 1 ? '' : 's'} on file. Answers cite the page; they are the firm's reading, not evidence the letter may quote.
      </p>
    </div>
  )
}

function columnTitle(key: string, question: string): string {
  switch (key) {
    case 'date': return 'Date'
    case 'issuer': return 'Issuer'
    case 'proves': return 'What it proves'
    case 'criterion': return 'Criterion'
    case 'pages': return 'Pages'
    default: return question
  }
}

function Cell({ cell, onOpen }: { cell: TableCell | undefined; onOpen: (page: number | null) => void }) {
  if (!cell || cell.status === 'pending') return <span className="text-[12px] text-kumo-inactive">not asked yet</span>
  if (cell.status === 'running') {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-kumo-subtle">
        <StatusDot tone="working" className="breathe" /> reading
      </span>
    )
  }
  if (cell.status === 'failed') return <span className="text-[12px] text-amber-700" title={cell.note ?? undefined}>couldn&apos;t answer</span>
  if (cell.answer === null) return <span className="text-[12px] text-kumo-inactive">not stated</span>
  return (
    <span className="block">
      <span className="block whitespace-normal">{cell.answer}</span>
      {(cell.page !== null || cell.quote) && (
        <button
          type="button"
          onClick={() => onOpen(cell.page)}
          title={cell.quote ? `“${cell.quote}”` : undefined}
          className="press mt-0.5 block cursor-pointer text-left text-[11.5px] text-kumo-subtle hover:text-kumo-default hover:underline"
        >
          {cell.page !== null ? `p. ${cell.page}` : 'open'}{cell.quote ? ` · “${cell.quote.length > 70 ? cell.quote.slice(0, 70) + '…' : cell.quote}”` : ''}
        </button>
      )}
    </span>
  )
}
