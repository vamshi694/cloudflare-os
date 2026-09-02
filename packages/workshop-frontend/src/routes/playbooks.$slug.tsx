import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import { ArrowLeft } from '@phosphor-icons/react'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { PlaybookDesk, PlaybookEntry } from '@gadgets/workshop-shared/legal'
import { useAuthenticatedApi } from '../AuthContext'
import { useDocumentTitle } from '../useDocumentTitle'
import { logRpcFailure } from '../rpcErrors'
import { WorkshopButton, WorkshopInput, WorkshopInputArea } from '../components/WorkshopControls'
import { useDesk } from '../components/firm/useDesk'
import Markdown from '../components/firm/Markdown'
import { Eyebrow, FieldLabel, LegalDialog, Notice, Pill, SegmentedTabs, Skeleton, formatDate } from '../components/legal/primitives'

export const Route = createFileRoute('/playbooks/$slug')({
  component: PlaybookDocumentPage,
})

const mintPlaybookDesk = (api: RpcStub<AuthenticatedApi>) => api.getPlaybookDesk()

type Doc = NonNullable<Awaited<ReturnType<PlaybookDesk['read']>>>
type DocState = { kind: 'loading' } | { kind: 'missing' } | { kind: 'failed' } | { kind: 'ready'; doc: Doc }
type Pane = 'edit' | 'preview'

/**
 * One playbook document: the text the counsel reads, editable with a live preview. Saving lands
 * in this lawyer's own copy; an admin can save the firm's copy for everyone. History keeps every
 * prior version; Revert drops the personal copy so the firm's applies again.
 */
function PlaybookDocumentPage() {
  const { slug } = Route.useParams()
  const { isAdmin } = useAuthenticatedApi()
  const desk = useDesk<PlaybookDesk>(mintPlaybookDesk, 'the playbooks')
  const api = desk.kind === 'ready' ? desk.stub : null

  const [state, setState] = useState<DocState>({ kind: 'loading' })
  const [title, setTitle] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [pane, setPane] = useState<Pane>('preview')
  const [busy, setBusy] = useState<null | 'personal' | 'firm' | 'revert'>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [history, setHistory] = useState<{ at: string; note: string | null; markdown: string }[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)

  useDocumentTitle(state.kind === 'ready' ? state.doc.title : 'Playbook')

  const load = useCallback(async () => {
    if (!api) return
    try {
      const doc = await api.read(slug)
      if (!doc) {
        setState({ kind: 'missing' })
        return
      }
      setState({ kind: 'ready', doc })
      setTitle(doc.title)
      setMarkdown(doc.markdown)
    } catch (err) {
      logRpcFailure('Failed to read the playbook document:', err)
      setState({ kind: 'failed' })
    }
  }, [api, slug])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = state.kind === 'ready' && (title !== state.doc.title || markdown !== state.doc.markdown)

  const save = async (layer: 'personal' | 'firm') => {
    if (!api || state.kind !== 'ready' || busy) return
    setBusy(layer)
    setNotice(null)
    try {
      await api.save(slug, { title: title.trim(), markdown, category: state.doc.category, scope: state.doc.scope }, { layer })
      setNotice({
        tone: 'ok',
        text: layer === 'firm' ? "Saved as the firm's copy. Every member reads this version from now on." : 'Saved as your copy. The firm reads it on your matters from now on.',
      })
      await load()
    } catch (err) {
      logRpcFailure('Failed to save the playbook document:', err)
      setNotice({ tone: 'error', text: `The edit didn't save: ${err instanceof Error ? err.message : 'try again'}. The document is unchanged.` })
    } finally {
      setBusy(null)
    }
  }

  const revert = async () => {
    if (!api || busy) return
    setBusy('revert')
    try {
      await api.revertToFirm(slug)
      setRevertOpen(false)
      setNotice({ tone: 'ok', text: "Your copy was set aside. The firm's copy applies again; your version stays in History." })
      await load()
    } catch (err) {
      logRpcFailure('Failed to revert the playbook document:', err)
      setNotice({ tone: 'error', text: "That didn't go through — your copy is unchanged." })
    } finally {
      setBusy(null)
    }
  }

  const openHistory = async () => {
    if (!api) return
    setHistoryOpen(true)
    try {
      setHistory(await api.history(slug))
    } catch (err) {
      logRpcFailure('Failed to read the playbook history:', err)
      setHistory([])
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-3 sm:px-8">
      <header className="px-3 pb-4 pt-6 sm:pt-8">
        <Link to="/playbooks" className="inline-flex items-center gap-1 text-[13px] leading-[18px] text-kumo-subtle hover:text-kumo-default">
          <ArrowLeft size={13} /> Playbook
        </Link>
        {state.kind === 'ready' && (
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="m-0 truncate text-[24px] leading-7 font-semibold tracking-[-0.5px] text-kumo-default">{state.doc.title}</h1>
                <Pill tone={state.doc.layer === 'personal' ? 'warning' : 'neutral'}>
                  {state.doc.layer === 'personal' ? 'your copy' : "the firm's copy"}
                </Pill>
                {state.doc.scope && <Pill>{state.doc.scope}</Pill>}
              </div>
              <p className="mt-1 mb-0 text-[12.5px] leading-4 text-kumo-subtle">
                {state.doc.layer === 'personal'
                  ? "You edited this. The firm reads your copy on your matters; colleagues still read the firm's."
                  : 'Every member reads this version. Editing makes a copy that only your matters use.'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <WorkshopButton className="!h-9" onClick={() => void openHistory()} disabled={!api}>
                History
              </WorkshopButton>
              {state.doc.layer === 'personal' && (
                <WorkshopButton className="!h-9" onClick={() => setRevertOpen(true)} disabled={!api || busy !== null}>
                  Revert to the firm&apos;s copy
                </WorkshopButton>
              )}
              <WorkshopButton className="!h-9" onClick={() => void save('personal')} disabled={!dirty || busy !== null || !title.trim()}>
                {busy === 'personal' ? 'Saving…' : 'Save my copy'}
              </WorkshopButton>
              {isAdmin && (
                <WorkshopButton tone="primary" className="!h-9" onClick={() => void save('firm')} disabled={!dirty || busy !== null || !title.trim()}>
                  {busy === 'firm' ? 'Saving…' : 'Save for the firm'}
                </WorkshopButton>
              )}
            </div>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 px-3 pb-10">
        {desk.kind === 'disabled' ? (
          <Notice tone="info" title="The firm's playbooks aren't turned on for this deployment." />
        ) : desk.kind === 'failed' || state.kind === 'failed' ? (
          <Notice title="This document couldn't be loaded." body="The firm's method is unchanged. Reload to try again." />
        ) : state.kind === 'missing' ? (
          <Notice
            title="This document is no longer here."
            body="It was removed, or the link points at a document this firm doesn't have. Nothing else in the playbook is affected."
          />
        ) : state.kind === 'loading' ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-[420px]" />
          </div>
        ) : (
          <div className="space-y-3">
            {notice && (
              <p role={notice.tone === 'error' ? 'alert' : undefined} className={`m-0 text-[12.5px] leading-[18px] ${notice.tone === 'error' ? 'text-kumo-danger' : 'text-kumo-success'}`}>
                {notice.text}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <SegmentedTabs<Pane>
                ariaLabel="Editor view"
                value={pane}
                onChange={setPane}
                tabs={[
                  { key: 'preview', label: 'Read' },
                  { key: 'edit', label: 'Edit' },
                ]}
              />
              {dirty && <span className="text-[12px] leading-4 text-kumo-subtle">Unsaved changes</span>}
            </div>
            {pane === 'edit' ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <FieldLabel>Title</FieldLabel>
                    <WorkshopInput value={title} onChange={(e) => setTitle(e.target.value)} className="w-full" />
                  </div>
                  <div>
                    <FieldLabel>Text</FieldLabel>
                    <WorkshopInputArea
                      value={markdown}
                      onChange={(e) => setMarkdown(e.target.value)}
                      className="min-h-[520px] w-full font-mono text-[13px] leading-[1.6]"
                      spellCheck
                    />
                  </div>
                </div>
                <div className="hidden lg:block">
                  <Eyebrow>Preview</Eyebrow>
                  <div className="mt-2 rounded-xl border border-kumo-line bg-kumo-base px-6 py-5">
                    <Markdown>{markdown}</Markdown>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-kumo-line bg-kumo-base px-6 py-6 sm:px-10 sm:py-8">
                <Markdown>{markdown}</Markdown>
              </div>
            )}
          </div>
        )}
      </div>

      {historyOpen && (
        <LegalDialog open onOpenChange={(o) => { if (!o) setHistoryOpen(false) }} title="History" size="lg"
          description="Every earlier version of this document, newest first. Restoring loads a version into the editor; nothing changes until you save.">
          {history === null ? (
            <Skeleton className="h-20" />
          ) : history.length === 0 ? (
            <p className="m-0 text-[13.5px] leading-5 text-kumo-subtle">No earlier versions. One is kept each time the document is saved.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-kumo-line p-0">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="m-0 text-[13.5px] leading-5 text-kumo-default">{h.note ?? 'Saved'}</p>
                    <p className="m-0 mt-0.5 text-[12px] leading-4 text-kumo-subtle">{formatDate(h.at)} · {h.markdown.length.toLocaleString()} characters</p>
                  </div>
                  <WorkshopButton className="!h-8 shrink-0" onClick={() => { setMarkdown(h.markdown); setPane('edit'); setHistoryOpen(false) }}>
                    Restore into the editor
                  </WorkshopButton>
                </li>
              ))}
            </ul>
          )}
        </LegalDialog>
      )}

      {revertOpen && (
        <LegalDialog open busy={busy === 'revert'} onOpenChange={(o) => { if (!o) setRevertOpen(false) }}
          title="Revert to the firm's copy?"
          description="Your copy is set aside and kept in History. From the next run, your matters read the firm's version."
          footer={
            <>
              <WorkshopButton className="!h-9" onClick={() => setRevertOpen(false)} disabled={busy !== null}>Keep my copy</WorkshopButton>
              <WorkshopButton tone="primary" className="!h-9" onClick={() => void revert()} disabled={busy !== null}>
                {busy === 'revert' ? 'Reverting…' : 'Revert'}
              </WorkshopButton>
            </>
          }
        />
      )}
    </div>
  )
}

export type { PlaybookEntry }
