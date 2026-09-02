// THE FORM ROOM — one government form, the way the attorney works it: every value with where it
// came from and where it lands on the official PDF, a ruling per field (accept, correct, ask the
// firm, reject), the filled form itself on the native PDF surface, approval into the packet, and
// the client's signature through the portal. The chip names the next truth of the form's life.

import { useCallback, useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { FormFieldValue, GovernmentForm, MatterDesk } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../../../rpcErrors'
import { WorkshopButton, WorkshopInput, WorkshopInputArea } from '../../../WorkshopControls'
import { Pill } from '../../primitives'
import { FORM_CHIP } from './form-chip'

const REVIEW_LABEL: Record<FormFieldValue['review'], string> = {
  proposed: 'Proposed by the firm',
  accepted: 'Accepted by you',
  asked: 'You asked the firm',
  rejected: 'Rejected — blank on the form',
}

export function FormRoom({ desk, form, reload }: { desk: RpcStub<MatterDesk>; form: GovernmentForm; reload: () => void }) {
  const toasts = useKumoToastManager()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [asking, setAsking] = useState<{ name: string; question: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ url: string; renderedAt: string } | null>(null)
  const [previewState, setPreviewState] = useState<'idle' | 'rendering' | 'failed'>('idle')

  const run = useCallback(async (key: string, work: () => Promise<void>, failure: string) => {
    setBusy(key)
    try {
      await work()
      reload()
    } catch (err) {
      logRpcFailure(`Form action failed (${key}):`, err)
      toasts.add({ title: err instanceof Error && err.message ? err.message : failure, variant: 'error' })
    } finally {
      setBusy(null)
    }
  }, [reload, toasts])

  // A ruling changes the render; drop the stale preview so the next open is current.
  useEffect(() => { setPreview(null); setPreviewState('idle') }, [form.renderedAt, form.filled, form.accepted])

  const openPreview = async () => {
    setPreviewState('rendering')
    try {
      setPreview(await desk.formPreviewUrl(form.code))
      setPreviewState('idle')
    } catch (err) {
      logRpcFailure('Failed to render the form:', err)
      setPreviewState('failed')
      toasts.add({ title: err instanceof Error && err.message ? err.message : 'The form could not be rendered. The values are unchanged.', variant: 'error' })
    }
  }

  const approved = form.status === 'approved' || form.status === 'awaiting_signature' || form.status === 'signed'
  const chip = FORM_CHIP[form.status]
  const unruled = form.fields.filter((f) => f.value && f.review === 'proposed').length

  return (
    <div className="max-w-[980px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Pill tone={chip.tone}>{chip.label}</Pill>
          {form.signature.state === 'signed' && form.signature.signedName && (
            <span className="text-[12.5px] text-kumo-subtle">Signed by {form.signature.signedName}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WorkshopButton className="!h-8" onClick={() => void openPreview()} disabled={previewState === 'rendering' || form.template.state === 'failed'}>
            {previewState === 'rendering' ? 'Rendering the form…' : 'Preview the filled form'}
          </WorkshopButton>
          <WorkshopButton
            tone="primary" className="!h-8"
            onClick={() => void run('__approve', () => desk.approveForm(form.code), 'The form was not approved — it stays for your review. Try again.')}
            disabled={busy !== null || approved}
            title={unruled > 0 ? `${unruled} proposed value${unruled === 1 ? '' : 's'} not yet ruled on` : undefined}
          >
            {approved ? 'Approved' : 'Approve — into the packet'}
          </WorkshopButton>
          {approved && form.signature.state === 'none' && (
            <WorkshopButton className="!h-8" onClick={() => void run('__sign', () => desk.requestFormSignature(form.code), 'The signature request was not sent. The client has not been asked — try again.')} disabled={busy !== null}>
              Ask the client to sign
            </WorkshopButton>
          )}
        </div>
      </div>

      <TemplateLine form={form} desk={desk} busy={busy} run={run} />

      {form.signature.state === 'requested' && (
        <p className="m-0 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-2.5 text-[13px] text-kumo-default">
          Waiting for the client's signature. They see the filled form in their portal and sign by typing their full legal name.
        </p>
      )}

      {preview && (
        <div className="overflow-hidden rounded-xl border border-kumo-line">
          <div className="flex items-center justify-between border-b border-kumo-line bg-kumo-elevated px-3 py-1.5 text-[12px] text-kumo-subtle">
            <span>The filled {form.code}, editable for review. Values you rule on below land on the next render.</span>
            <a href={preview.url} target="_blank" rel="noreferrer" className="text-kumo-default underline underline-offset-2">Open ↗</a>
          </div>
          <iframe title={`${form.code} preview`} src={`${preview.url}#view=FitH`} className="block h-[70vh] min-h-[480px] w-full bg-[#525659]" />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
        <ul className="m-0 list-none divide-y divide-kumo-line p-0">
          {form.fields.map((f) => {
            const value = edits[f.name] ?? f.value ?? ''
            const edited = edits[f.name] !== undefined && edits[f.name] !== (f.value ?? '')
            return (
              <li key={f.name} className="grid gap-2 px-4 py-2.5 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-start">
                <div>
                  <p className="m-0 text-[12.5px] text-kumo-default">{f.label}</p>
                  <p className="m-0 mt-0.5 text-[11px] text-kumo-inactive" title={f.pdfField ?? undefined}>
                    {form.template.state === 'ready' ? (f.pdfField ? 'On the official form' : 'No matching field on the official form') : ''}
                  </p>
                </div>
                <div className="min-w-0">
                  <WorkshopInput
                    value={value}
                    onChange={(e) => setEdits((x) => ({ ...x, [f.name]: e.target.value }))}
                    className={`w-full !h-8 ${f.review === 'rejected' ? 'line-through' : ''}`}
                    placeholder="Not on the record — the attorney supplies this"
                  />
                  <p className="m-0 mt-0.5 text-[11px] text-kumo-inactive">
                    {f.sourceFactId ? 'From the record' : f.value ? 'Entered by the firm' : 'No source yet'} · {REVIEW_LABEL[f.review]}
                  </p>
                  {asking?.name === f.name && (
                    <div className="mt-2 space-y-1.5">
                      <WorkshopInputArea
                        rows={2} value={asking.question} autoFocus
                        onChange={(e) => setAsking({ name: f.name, question: e.target.value })}
                        placeholder="What should the firm check about this value?"
                        className="w-full"
                      />
                      <div className="flex gap-2">
                        <WorkshopButton tone="primary" className="!h-7" disabled={busy !== null}
                          onClick={() => void run(f.name, async () => { await desk.askAboutFormField(form.code, f.name, asking.question); setAsking(null) }, 'The question did not reach the firm. Nothing changed — try again.')}>
                          Ask the firm
                        </WorkshopButton>
                        <WorkshopButton className="!h-7" onClick={() => setAsking(null)}>Cancel</WorkshopButton>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 lg:justify-end">
                  {edited ? (
                    <WorkshopButton tone="primary" className="!h-7" disabled={busy !== null || !value.trim()}
                      onClick={() => void run(f.name, async () => { await desk.editFormField(form.code, f.name, value); setEdits((e) => { const n = { ...e }; delete n[f.name]; return n }) }, 'That correction was not saved — the form is unchanged. Try again.')}>
                      {busy === f.name ? '…' : 'Save correction'}
                    </WorkshopButton>
                  ) : (
                    <WorkshopButton className="!h-7" disabled={busy !== null || !value.trim() || f.review === 'accepted'}
                      onClick={() => void run(f.name, () => desk.acceptFormField(form.code, f.name, value), 'That value was not accepted — the form is unchanged. Try again.')}>
                      {busy === f.name ? '…' : f.review === 'accepted' ? 'Accepted' : 'Accept'}
                    </WorkshopButton>
                  )}
                  <WorkshopButton className="!h-7" disabled={busy !== null || f.review === 'asked'} onClick={() => setAsking({ name: f.name, question: '' })}>
                    {f.review === 'asked' ? 'Asked' : 'Ask'}
                  </WorkshopButton>
                  <WorkshopButton className="!h-7" disabled={busy !== null || !f.value || f.review === 'rejected'}
                    onClick={() => void run(f.name, () => desk.rejectFormField(form.code, f.name, ''), 'The value was not rejected — the form is unchanged. Try again.')}>
                    Reject
                  </WorkshopButton>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {form.template.state === 'ready' && form.template.unmapped.length > 0 && (
        <details className="rounded-xl border border-kumo-line bg-kumo-base px-4 py-2.5">
          <summary className="cursor-pointer text-[12.5px] text-kumo-subtle">
            {form.template.unmapped.length} field{form.template.unmapped.length === 1 ? '' : 's'} on the official form the firm does not fill — the attorney completes them by hand
          </summary>
          <ul className="m-0 mt-2 list-none columns-2 p-0 text-[11.5px] text-kumo-inactive">
            {form.template.unmapped.map((n) => <li key={n} className="truncate" title={n}>{n.split('.').pop()?.replace(/\[\d+\]$/, '')}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

/** The official PDF: on file, failed with the reason, or not yet fetched. Never a fake "ready". */
function TemplateLine({ form, desk, busy, run }: {
  form: GovernmentForm; desk: RpcStub<MatterDesk>; busy: string | null
  run: (key: string, work: () => Promise<void>, failure: string) => Promise<void>
}) {
  const fetchIt = () => run('__template', async () => { await desk.fetchFormTemplate(form.code) }, 'The official form could not be fetched. Nothing changed — try again.')
  if (form.template.state === 'ready') {
    return (
      <p className="m-0 text-[12.5px] text-kumo-subtle">
        The official {form.code} is on file: {form.template.fillable} fillable fields, {form.fields.filter((f) => f.pdfField).length} matched to the firm's values.
        {form.template.fetchedAt && <> Fetched {new Date(form.template.fetchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.</>}
      </p>
    )
  }
  if (form.template.state === 'failed') {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-2.5 text-[13px] text-kumo-default">
        <p className="m-0"><strong>The official PDF is not on file.</strong> {form.template.note}</p>
        <WorkshopButton className="!h-7 mt-2" onClick={() => void fetchIt()} disabled={busy !== null}>{busy === '__template' ? 'Fetching…' : 'Try again'}</WorkshopButton>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-kumo-subtle">
      <span>The official {form.code} from USCIS is not on file yet; the preview and the packet need it.</span>
      <WorkshopButton className="!h-7" onClick={() => void fetchIt()} disabled={busy !== null}>{busy === '__template' ? 'Fetching from USCIS…' : 'Fetch the official form'}</WorkshopButton>
    </div>
  )
}
