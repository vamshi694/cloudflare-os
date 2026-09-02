import { useCallback, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk, RecommendationLetter, Recommender } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../../rpcErrors'
import { WorkshopButton, WorkshopInput, WorkshopInputArea } from '../../WorkshopControls'
import { Notice, Pill, StatusDot } from '../primitives'
import { useDeskData } from '../useMatterDesk'
import Markdown from '../../firm/Markdown'
import { fmtDateTime, plural } from '../labels'

const STATUS: Record<Recommender['status'], { label: string; tone: 'ready' | 'neutral' | 'warning' }> = {
  confirmed: { label: 'Confirmed', tone: 'ready' },
  suggested: { label: 'Suggested by the firm', tone: 'neutral' },
  declined: { label: 'Set aside', tone: 'warning' },
}

/**
 * THE RECOMMENDERS ROOM — who will write for the beneficiary, and the letters the firm drafts in
 * their voice from the record. The firm suggests from the case map; the attorney's list is final
 * (reconcile), and a letter is never a letter until its quotes verify.
 */
export function RecommendersRoom({ desk, caseType }: { desk: RpcStub<MatterDesk>; caseType: string | null }) {
  const toasts = useKumoToastManager()
  const loadRecs = useCallback(() => desk.recommenders(), [desk])
  const recs = useDeskData<Recommender[]>(loadRecs, { pollMs: 15000 })
  const loadLetters = useCallback(() => desk.letters(), [desk])
  const letters = useDeskData<RecommendationLetter[]>(loadLetters, { pollMs: 15000 })
  const [busy, setBusy] = useState<string | null>(null)
  const [names, setNames] = useState('')
  const [reading, setReading] = useState<string | null>(null)
  const [add, setAdd] = useState({ name: '', title: '', organization: '', relationship: '' })

  const run = async (key: string, work: () => Promise<void>, failure: string) => {
    setBusy(key)
    try {
      await work()
      recs.reload()
      letters.reload()
    } catch (err) {
      logRpcFailure(`Recommenders: ${key} failed:`, err)
      toasts.add({ title: err instanceof Error && err.message ? err.message : failure, variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  if (recs.data === null) {
    if (recs.failed) return <Notice title="The recommenders couldn't be read just now." body="Nothing has changed on the matter — this view keeps retrying." />
    return <div className="skeleton h-[320px]" />
  }
  const list = recs.data
  const confirmed = list.filter((r) => r.status === 'confirmed')
  const letterFor = new Map((letters.data ?? []).map((l) => [l.recommenderId, l]))
  const open = reading ? (letters.data ?? []).find((l) => l.id === reading) ?? null : null

  return (
    <div className="max-w-[980px] space-y-6">
      {recs.failed && <p className="m-0 text-[12.5px] italic text-kumo-subtle">Not updating right now — showing the last view that loaded.</p>}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 font-serif text-[19px] leading-6 text-kumo-default">Letters of recommendation</h2>
          <p className="m-0 mt-1 text-[13px] leading-[19px] text-kumo-subtle">
            Who writes for the beneficiary, and what the firm drafts in their voice from the record. Your list is final; a letter with an unverified quote stays a draft.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WorkshopButton className="!h-8" onClick={() => void run('suggest', async () => { await desk.suggestRecommenders() }, "The firm couldn't suggest recommenders just now. Nothing changed — try again.")} disabled={busy !== null}>
            {busy === 'suggest' ? 'Reading the record…' : 'Suggest from the record'}
          </WorkshopButton>
          <WorkshopButton tone="primary" className="!h-8" onClick={() => void run('generate', async () => {
            const r = await desk.generateLetters()
            if (r.failed.length) toasts.add({ title: `${plural(r.written.length, 'letter', 'letters')} written; ${r.failed.length} could not be: ${r.failed[0].reason}`, variant: 'error' })
            else toasts.add({ title: `${plural(r.written.length, 'letter', 'letters')} drafted from the record.`, variant: 'success' })
          }, "The letters didn't start. Nothing changed — try again.")} disabled={busy !== null || confirmed.length === 0} title={confirmed.length === 0 ? 'Confirm at least one recommender first.' : undefined}>
            {busy === 'generate' ? 'Writing…' : `Draft ${plural(confirmed.length, 'letter', 'letters')}`}
          </WorkshopButton>
        </div>
      </header>

      {list.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-kumo-line px-5 py-8 text-center">
          <p className="m-0 text-[14px] font-medium text-kumo-default">No recommenders yet.</p>
          <p className="m-0 mt-1 text-[12.5px] text-kumo-subtle">Have the firm suggest from the record, or add the people you already have in mind below.</p>
        </div>
      ) : (
        <ul className="m-0 list-none space-y-2 p-0">
          {list.map((r) => {
            const letter = letterFor.get(r.id) ?? null
            const chip = STATUS[r.status]
            return (
              <li key={r.id} className="rounded-[14px] border border-kumo-line bg-kumo-base px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 text-[14px] font-medium text-kumo-default">{r.name}{r.title ? <span className="font-normal text-kumo-subtle"> · {r.title}</span> : null}{r.organization ? <span className="font-normal text-kumo-subtle">, {r.organization}</span> : null}</p>
                    {r.relationship && <p className="m-0 mt-0.5 text-[12.5px] text-kumo-subtle">{r.relationship}</p>}
                    {r.basis && <p className="m-0 mt-1 text-[12.5px] leading-[18px] text-kumo-default">{r.basis}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Pill tone={chip.tone}>{chip.label}</Pill>
                    {r.status !== 'confirmed' && (
                      <WorkshopButton className="!h-7" onClick={() => void run(`confirm:${r.id}`, async () => { await desk.updateRecommender(r.id, { status: 'confirmed' }) }, 'That change was not saved.')} disabled={busy !== null}>Confirm</WorkshopButton>
                    )}
                    {r.status === 'confirmed' && (
                      <WorkshopButton className="!h-7" onClick={() => void run(`aside:${r.id}`, async () => { await desk.updateRecommender(r.id, { status: 'declined' }) }, 'That change was not saved.')} disabled={busy !== null}>Set aside</WorkshopButton>
                    )}
                    <WorkshopButton className="!h-7" onClick={() => void run(`remove:${r.id}`, async () => { await desk.removeRecommender(r.id) }, 'The recommender was not removed.')} disabled={busy !== null}>Remove</WorkshopButton>
                  </div>
                </div>
                {letter && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-kumo-line pt-2 text-[12.5px]">
                    <StatusDot tone={letter.status === 'approved' ? 'ready' : letter.unverifiedQuotes.length ? 'paused' : 'quiet'} />
                    <span className="text-kumo-default">
                      {letter.status === 'approved' ? 'Letter approved' : 'Letter drafted'} · version {letter.version} · ≈ {Math.max(1, Math.round(letter.words / 450))} {Math.round(letter.words / 450) === 1 ? 'page' : 'pages'}
                      {letter.unverifiedQuotes.length > 0 && <span className="text-kumo-warning"> · {plural(letter.unverifiedQuotes.length, 'quote', 'quotes')} unverified</span>}
                    </span>
                    <span className="text-kumo-inactive">{fmtDateTime(letter.updatedAt)}</span>
                    <span className="flex-1" />
                    <WorkshopButton className="!h-7" onClick={() => setReading(reading === letter.id ? null : letter.id)}>{reading === letter.id ? 'Close' : 'Read'}</WorkshopButton>
                    <WorkshopButton className="!h-7" onClick={() => void run(`redo:${r.id}`, async () => { await desk.generateLetters([r.id]) }, "The letter didn't redraft.")} disabled={busy !== null}>Redraft</WorkshopButton>
                    {letter.status !== 'approved' && (
                      <WorkshopButton tone="primary" className="!h-7" onClick={() => void run(`approve:${letter.id}`, async () => { await desk.approveLetter(letter.id) }, 'The letter was not approved.')} disabled={busy !== null || letter.unverifiedQuotes.length > 0} title={letter.unverifiedQuotes.length ? 'Approve once every quote verifies.' : undefined}>Approve</WorkshopButton>
                    )}
                  </div>
                )}
                {open && open.recommenderId === r.id && (
                  <div className="mt-3 space-y-2">
                    {open.unverifiedQuotes.length > 0 && (
                      <div className="rounded-lg border border-kumo-warning/30 bg-kumo-warning-tint/30 px-3 py-2 text-[12.5px] leading-[18px]">
                        <strong>These quotes are not in the cited facts:</strong>
                        <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                          {open.unverifiedQuotes.slice(0, 5).map((q, i) => <li key={i}>“{q.quote.slice(0, 140)}{q.quote.length > 140 ? '…' : ''}”</li>)}
                        </ul>
                        <p className="m-0 mt-1 text-kumo-subtle">Redraft, or tell the firm in Conversation which facts to rest it on.</p>
                      </div>
                    )}
                    <div className="paper mx-auto max-w-[760px] rounded-[4px] border border-kumo-line px-8 py-8" style={{ fontFamily: 'Georgia, "Times New Roman", Times, serif' }}>
                      <Markdown>{open.body}</Markdown>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[14px] border border-kumo-line bg-kumo-base px-4 py-3">
          <p className="docket m-0 mb-1.5">Add one you have in mind</p>
          <div className="space-y-1.5">
            <WorkshopInput value={add.name} onChange={(e) => setAdd((a) => ({ ...a, name: e.target.value }))} placeholder="Full name" className="w-full !h-8" />
            <div className="grid grid-cols-2 gap-1.5">
              <WorkshopInput value={add.title} onChange={(e) => setAdd((a) => ({ ...a, title: e.target.value }))} placeholder="Title" className="w-full !h-8" />
              <WorkshopInput value={add.organization} onChange={(e) => setAdd((a) => ({ ...a, organization: e.target.value }))} placeholder="Organization" className="w-full !h-8" />
            </div>
            <WorkshopInput value={add.relationship} onChange={(e) => setAdd((a) => ({ ...a, relationship: e.target.value }))} placeholder="How they know the beneficiary" className="w-full !h-8" />
            <WorkshopButton className="!h-8" disabled={busy !== null || !add.name.trim()} onClick={() => void run('add', async () => {
              await desk.addRecommender({ name: add.name.trim(), title: add.title.trim() || null, organization: add.organization.trim() || null, relationship: add.relationship.trim() || null })
              setAdd({ name: '', title: '', organization: '', relationship: '' })
            }, 'The recommender was not added. Nothing changed — try again.')}>{busy === 'add' ? 'Adding…' : 'Add as confirmed'}</WorkshopButton>
          </div>
        </div>
        <div className="rounded-[14px] border border-kumo-line bg-kumo-base px-4 py-3">
          <p className="docket m-0 mb-1.5">Your list is final</p>
          <p className="m-0 mb-1.5 text-[12.5px] leading-[18px] text-kumo-subtle">One name per line. Everyone named is confirmed (added when new); suggestions you leave out are set aside, never deleted.</p>
          <WorkshopInputArea value={names} onChange={(e) => setNames(e.target.value)} rows={4} placeholder={'Dr. Maria Lopez\nProf. Alan Turing'} className="w-full" />
          <WorkshopButton className="!h-8 mt-1.5" disabled={busy !== null || !names.trim()} onClick={() => void run('reconcile', async () => {
            const r = await desk.reconcileRecommenders(names.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
            toasts.add({ title: `${r.confirmed} confirmed, ${r.added} added, ${r.declined} set aside.`, variant: 'success' })
            setNames('')
          }, 'The list was not settled. Nothing changed — try again.')}>{busy === 'reconcile' ? 'Settling…' : 'Settle the list'}</WorkshopButton>
        </div>
      </section>
      <p className="m-0 text-[11.5px] leading-4 text-kumo-inactive">Letters are drafted for the {caseType ?? 'petition'} from facts on the record and checked the way the petition is: every quoted phrase must appear verbatim in a cited fact.</p>
    </div>
  )
}
