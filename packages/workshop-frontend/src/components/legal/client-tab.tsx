import { useCallback, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { ClientRecord, MatterDesk } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../rpcErrors'
import { WorkshopButton, WorkshopInput } from '../WorkshopControls'
import { Notice } from './primitives'
import { useDeskData } from './useMatterDesk'
import { caseTypeLabel } from './labels'

const PORTAL_LINE: Record<ClientRecord['portal'], string> = {
  signed_in: 'Signed in to the portal',
  invited: 'Invited — awaiting first sign-in',
  expired: 'Invite expired',
  not_invited: 'Not invited yet',
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * THE CLIENT, ON THE MATTER: one card — who they are, how to reach them, where their onboarding
 * stands, what they've sent. Everything they upload lands in Documents; their messages live in
 * Messages.
 */
export function ClientTab({ desk, caseType, onChanged }: { desk: RpcStub<MatterDesk>; caseType: string | null; onChanged: () => void }) {
  const toasts = useKumoToastManager()
  const load = useCallback(() => desk.client(), [desk])
  const { data, failed, reload } = useDeskData<ClientRecord>(load, { pollMs: 15000 })
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  if (data === null) {
    if (failed) {
      return (
        <Notice
          title="The client's details couldn't be read just now."
          body="Nothing has changed. This view keeps retrying; reload if it stays empty."
        />
      )
    }
    return <div className="skeleton h-[240px] max-w-[720px]" />
  }

  const invite = async () => {
    setBusy(true)
    setResult(null)
    try {
      const { url } = await desk.invitePortal()
      setResult(`Share this sign-in link: ${url}`)
      reload()
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to mint the portal link:', err)
      setResult("The invite didn't send — the client has not been contacted.")
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      await desk.setClient({ email: email.trim() || null, phone: phone.trim() || null })
      setEditing(false)
      reload()
    } catch (err) {
      logRpcFailure('Failed to save the client details:', err)
      toasts.add({ title: "The client's details were not saved. Nothing changed — try again.", variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-[720px] space-y-3">
      {failed && <p className="m-0 text-[12.5px] italic text-kumo-subtle">Not updating right now — showing the last view that loaded.</p>}
      <div className="shadow-depth rise rounded-[14px] border border-kumo-line bg-kumo-base">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-kumo-tint text-[14px] font-semibold text-kumo-default">
            {initials(data.name) || '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[15px] leading-5 font-medium tracking-[-0.3px] text-kumo-default">{data.name}</p>
            <p className="m-0 text-[12.5px] leading-[18px] text-kumo-subtle">{PORTAL_LINE[data.portal]}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-kumo-line px-5 py-4 sm:grid-cols-4">
          <Metric label="Email" value={data.email ?? 'no email on record'} muted={!data.email} />
          <Metric label="Phone" value={data.phone ?? '—'} muted={!data.phone} />
          <Metric label="Matter type" value={caseTypeLabel(caseType)} />
          <Metric label="Documents they sent" value={String(data.documentsSent)} />
        </div>
        <div className="space-y-3 border-t border-kumo-line px-5 py-4">
          {editing ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-[12px] text-kumo-subtle">
                Email
                <WorkshopInput className="mt-1 w-full" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" />
              </label>
              <label className="min-w-0 flex-1 text-[12px] text-kumo-subtle">
                Phone
                <WorkshopInput className="mt-1 w-full" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 …" />
              </label>
              <WorkshopButton className="!h-9" onClick={() => setEditing(false)} disabled={busy}>Cancel</WorkshopButton>
              <WorkshopButton tone="primary" className="!h-9" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</WorkshopButton>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <WorkshopButton tone="primary" className="!h-9" onClick={() => void invite()} disabled={busy}>
                {busy ? 'Working…' : data.portal === 'not_invited' ? 'Send the sign-in link' : 'Resend the sign-in link'}
              </WorkshopButton>
              <WorkshopButton
                className="!h-9"
                onClick={() => {
                  setEmail(data.email ?? '')
                  setPhone(data.phone ?? '')
                  setEditing(true)
                }}
              >
                Edit contact details
              </WorkshopButton>
            </div>
          )}
          {result && <p className="m-0 break-all text-[12.5px] leading-[18px] text-kumo-default select-all">{result}</p>}
          {data.portalUrl && !result && (
            <p className="m-0 break-all text-[12px] leading-[17px] text-kumo-subtle">
              Current link: <span className="select-all text-kumo-default">{data.portalUrl}</span>
            </p>
          )}
        </div>
      </div>
      <p className="m-0 text-[12.5px] leading-[18px] text-kumo-subtle">
        Everything the client uploads lands in Documents and is read into the case record. Their messages live in Messages.
      </p>
    </div>
  )
}

function Metric({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.07em] text-kumo-subtle">{label}</p>
      <p className={`tnum m-0 mt-1 truncate text-[13.5px] leading-5 ${muted ? 'text-kumo-inactive' : 'text-kumo-default'}`} title={value}>
        {value}
      </p>
    </div>
  )
}
