// Google Drive intake. The agent is the integrator: this panel does not pull files itself. It
// hands the counsel a prepared message in the matter conversation; the counsel lists and downloads
// through the Google gatekeeper the attorney connected in Connections, and every file lands on the
// record through the same upload path, with the observation ledger as the receipt.

import { useEffect, useState, type ChangeEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useAuthenticatedApi } from '../../../AuthContext'
import { AccountsSubscriberAdapter, type AccountEvent } from '../../../accountsSubscriber'
import { WorkshopButton, WorkshopInput } from '../../WorkshopControls'
import { logRpcFailure } from '../../../rpcErrors'

type GoogleState = { kind: 'checking' } | { kind: 'connected'; name: string } | { kind: 'not_connected' }

/** Is a Google account connected? Read from the same subscription the Connections page uses. */
function useGoogleAccount(): GoogleState {
  const { authenticatedApi } = useAuthenticatedApi()
  const [state, setState] = useState<GoogleState>({ kind: 'checking' })
  useEffect(() => {
    const accounts = new Map<number, AccountEvent>()
    const settle = () => {
      const google = [...accounts.values()].find((a) => a.vendorId === 'google' && a.credentialsValid)
      setState(google ? { kind: 'connected', name: google.description.displayName ?? 'your Google account' } : { kind: 'not_connected' })
    }
    const subscriber = new AccountsSubscriberAdapter({
      add: (event) => { accounts.set(event.id, event) },
      remove: (id) => { accounts.delete(id); settle() },
      ready: settle,
    })
    let subscription: { [Symbol.dispose](): void } | null = null
    try {
      subscription = authenticatedApi.subscribeConnectedAccounts(subscriber)
    } catch (err) {
      logRpcFailure('Failed to check the Google connection:', err)
      setState({ kind: 'not_connected' })
    }
    return () => subscription?.[Symbol.dispose]()
  }, [authenticatedApi])
  return state
}

function driveMessage(link: string): string {
  return `Import every file from this Drive link into the record: ${link.trim()}\nList what the share holds first, then put each file on the record in the order it appears, and tell me what landed and what did not.`
}

export function DrivePanel({ onClose }: { onClose: () => void }) {
  const google = useGoogleAccount()
  const [link, setLink] = useState('')
  const valid = /^https?:\/\/(drive|docs)\.google\.com\//i.test(link.trim())

  const handToCounsel = () => {
    // The conversation tab reads `seed` from the URL and puts it in the composer (WP-1). A full
    // navigation, so the matter page lands on the conversation with the seed intact.
    const url = new URL(window.location.href)
    url.searchParams.set('tab', 'conversation')
    url.searchParams.set('seed', driveMessage(link))
    window.location.assign(url.toString())
  }

  return (
    <div className="space-y-3 rounded-xl border border-kumo-line bg-kumo-base px-4 py-3.5">
      <p className="m-0 text-[13.5px] leading-5 text-kumo-default">
        Paste the Google Drive link the client shared (a folder or a file). The firm pulls every file in and reads it, exactly like an upload.
      </p>
      {google.kind === 'checking' && <p className="m-0 text-[12.5px] text-kumo-subtle">Checking your Google connection…</p>}
      {google.kind === 'connected' && (
        <p className="m-0 text-[12.5px] text-kumo-subtle">Connected as {google.name}. Folders shared to that account work.</p>
      )}
      {google.kind === 'not_connected' && (
        <p className="m-0 text-[12.5px] text-kumo-subtle">
          Google is not connected yet. <Link to="/gatekeepers" className="text-kumo-default underline underline-offset-2">Connect your Google account</Link> once, then import here.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <WorkshopInput
          value={link}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setLink(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/…"
          className="min-w-[260px] flex-1 !h-8"
        />
        <WorkshopButton tone="primary" className="!h-8" onClick={handToCounsel} disabled={!valid || google.kind !== 'connected'}>
          Hand to the counsel
        </WorkshopButton>
        <WorkshopButton className="!h-8" onClick={onClose}>Close</WorkshopButton>
      </div>
      <p className="m-0 text-[12px] leading-[18px] text-kumo-inactive">
        The counsel lists the share, then puts each file on the record. Every step shows in the conversation, so you can see what landed.
      </p>
    </div>
  )
}
