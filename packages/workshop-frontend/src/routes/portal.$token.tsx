// The client portal. A different product register from the attorney's app: no nav, no jargon,
// no counts of internal machinery. The private link is the credential. Everything the client
// does here lands on the matter exactly like the attorney's own uploads and notes.
//
// One truth with the firm's screens: a file the firm could not read never wears the check here.
// A wifi blip is not a revoked link: once the view has loaded, later failures keep the last good
// view and the poll recovers on its own.

import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { PortalView } from '@gadgets/workshop-shared/legal'
import BrandMark from '../components/BrandMark'

export const Route = createFileRoute('/portal/$token')({ component: PortalPage })

const MAX_CONCURRENT = 3
const POLL_MS = 4000

type UploadRow = { id: string; name: string; size: number; state: 'queued' | 'reading' | 'done' | 'failed' }

function apiBase(token: string): string {
  return `/gatekeeper/matter/portal/${encodeURIComponent(token)}`
}

/** "Dr. Anaya Raghunathan" → "Dr. Anaya", never "Dr.." */
function greetingName(first: string): string {
  return first.trim() || 'there'
}

function extension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  return (m ? m[1] : 'file').slice(0, 3).toUpperCase()
}

function PortalPage() {
  const { token } = Route.useParams()
  const [view, setView] = useState<PortalView | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [stale, setStale] = useState(false)
  const loadedOnce = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiBase(token), { headers: { accept: 'application/json' } })
      if (res.status === 404 || res.status === 403) {
        // Only a link that never answered is invalid; a loaded view is kept through later failures.
        if (!loadedOnce.current) setInvalid(true)
        else setStale(true)
        return
      }
      if (!res.ok) { setStale(loadedOnce.current); return }
      const data = (await res.json()) as PortalView
      loadedOnce.current = true
      setView(data)
      setStale(false)
    } catch {
      setStale(loadedOnce.current)
    }
  }, [token])

  useEffect(() => {
    void load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load() }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => { document.title = 'Secure client portal' }, [])

  if (invalid) {
    return (
      <Frame>
        <h1 className="font-serif text-[28px] font-bold tracking-tight text-kumo-default">This link isn&apos;t valid</h1>
        <p className="mt-2 text-[15px] text-kumo-subtle">Please ask your legal team for a fresh sign-in link.</p>
      </Frame>
    )
  }

  if (!view) {
    return (
      <Frame>
        <div className="skeleton h-9 w-64 rounded-md bg-kumo-tint" />
        <div className="mt-3 h-4 w-96 rounded bg-kumo-tint" />
        <div className="mt-10 h-28 w-full rounded-[14px] bg-kumo-tint" />
      </Frame>
    )
  }

  return (
    <Frame>
      <h1 className="font-serif text-[30px] font-bold leading-tight tracking-tight text-kumo-default">
        Welcome, {greetingName(view.clientFirstName)}.
      </h1>
      <p className="mt-3 max-w-[60ch] text-[15px] leading-[1.6] text-kumo-subtle">
        Your legal team is preparing your {view.caseTypeTitle ?? 'immigration'} petition. Upload the documents
        below and we&apos;ll take it from there. You&apos;ll only hear from us when we need something.
      </p>
      {view.attorney && (
        <p className="mt-2 text-[13.5px] text-kumo-subtle">
          Your attorney: {view.attorney.name}{view.attorney.email ? ` · ${view.attorney.email}` : ''}
        </p>
      )}
      {stale && (
        <p className="mt-3 text-[12.5px] italic text-kumo-subtle">Not updating right now — showing the last view that loaded.</p>
      )}

      <Section label="Live case status">
        <div className="rounded-[14px] border border-kumo-line bg-kumo-elevated px-5 py-4">
          <p className="text-[15px] leading-[1.6] text-kumo-default">{view.status.line}</p>
          <p className="mt-1 text-[13.5px] text-kumo-subtle">
            {view.status.needsClient
              ? 'We need a few things from you. See below.'
              : 'Nothing needed from you right now. We\'ll reach out the moment there is.'}
          </p>
        </div>
      </Section>

      {view.requests.length > 0 && (
        <Section label="From your legal team">
          <div className="space-y-3">
            {view.requests.map((r) => (
              <div key={r.id} className="rounded-[14px] border border-kumo-line bg-kumo-tint px-5 py-4 text-[14.5px] leading-[1.6] text-kumo-default whitespace-pre-wrap">
                {r.body}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section label="Upload">
        <Uploader token={token} onUploaded={load} />
      </Section>

      <Section label="Tell us anything that helps your case">
        <Words token={token} />
      </Section>

      {view.stillNeeded.length > 0 && (
        <Section label="Still needed">
          <ul className="space-y-1.5">
            {view.stillNeeded.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[14.5px] leading-[1.55] text-kumo-default">
                <span aria-hidden className="mt-[9px] h-px w-3 shrink-0 bg-amber-500" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section label={`Received (${view.received.length})`}>
        {view.received.length === 0 ? (
          <p className="text-[14px] text-kumo-subtle">Nothing uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-kumo-line rounded-[14px] border border-kumo-line bg-kumo-elevated">
            {view.received.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-kumo-tint text-[10px] font-semibold tracking-wide text-kumo-subtle">
                  {extension(f.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-kumo-default">{f.name}</span>
                <ReceivedState state={f.state} label={f.label} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Frame>
  )
}

function ReceivedState({ state, label }: { state: 'reading' | 'trouble' | 'read'; label: string | null }) {
  if (state === 'reading') {
    return <span className="flex items-center gap-1.5 text-[12.5px] text-kumo-subtle"><span className="breathe h-1.5 w-1.5 rounded-full bg-kumo-default" />Reading…</span>
  }
  if (state === 'trouble') {
    return <span className="text-[12.5px] text-amber-700">we had trouble reading this — a clearer copy would help</span>
  }
  return <span className="text-[12.5px] text-emerald-700">✓ {label ?? 'received'}</span>
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-kumo-base">
      <header className="flex h-14 items-center gap-2 border-b border-kumo-line px-6">
        <BrandMark size={18} className="text-kumo-brand" />
        <span className="text-[13.5px] font-medium text-kumo-default">Secure client portal</span>
      </header>
      <main className="mx-auto w-full max-w-[760px] px-6 pb-24 pt-12">{children}</main>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-[11.5px] font-medium uppercase tracking-[0.14em] text-kumo-subtle">{label}</h2>
      {children}
    </section>
  )
}

function Uploader({ token, onUploaded }: { token: string; onUploaded: () => void }) {
  const [rows, setRows] = useState<UploadRow[]>([])
  const [dragging, setDragging] = useState(false)
  const queue = useRef<{ id: string; file: File }[]>([])
  const active = useRef(0)

  const pump = useCallback(() => {
    while (active.current < MAX_CONCURRENT && queue.current.length > 0) {
      const next = queue.current.shift()!
      active.current += 1
      setRows((r) => r.map((x) => (x.id === next.id ? { ...x, state: 'reading' } : x)))
      const body = new FormData()
      body.append('file', next.file, next.file.name)
      fetch(`${apiBase(token)}/upload`, { method: 'POST', body })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status))
          setRows((r) => r.map((x) => (x.id === next.id ? { ...x, state: 'done' } : x)))
          onUploaded()
        })
        .catch(() => setRows((r) => r.map((x) => (x.id === next.id ? { ...x, state: 'failed' } : x))))
        .finally(() => { active.current -= 1; pump() })
    }
  }, [token, onUploaded])

  const accept = useCallback((files: FileList | null) => {
    if (!files) return
    const added = Array.from(files).map((file) => ({ id: crypto.randomUUID(), file }))
    setRows((r) => [...r, ...added.map(({ id, file }) => ({ id, name: file.name, size: file.size, state: 'queued' as const }))])
    queue.current.push(...added)
    pump()
  }, [pump])

  const onChange = (e: ChangeEvent<HTMLInputElement>) => { accept(e.target.files); e.target.value = '' }
  const onDrop = (e: DragEvent<HTMLLabelElement>) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files) }
  const busy = rows.some((r) => r.state === 'queued' || r.state === 'reading')

  return (
    <div>
      {/* A label wrapping a hidden input: the browser opens the picker natively on click. */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'block cursor-pointer rounded-[16px] border-2 border-dashed p-8 text-center transition-colors',
          dragging ? 'border-kumo-brand bg-kumo-tint' : 'border-kumo-line hover:bg-kumo-tint',
        ].join(' ')}
      >
        <input type="file" multiple className="sr-only" onChange={onChange} />
        <p className="text-[15px] font-medium text-kumo-default">{busy ? 'Reading your documents…' : 'Drop documents here'}</p>
        <p className="mt-1 text-[13.5px] text-kumo-subtle">
          or click to choose: passport, CV, recommendation letters, awards. Drag as many as you like. Scans are read automatically.
        </p>
      </label>
      {rows.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-[10px] border border-kumo-line bg-kumo-elevated px-3 py-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-kumo-tint text-[10px] font-semibold text-kumo-subtle">{extension(r.name)}</span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-kumo-default">{r.name}</span>
              <span className="tnum text-[12px] text-kumo-subtle">{formatBytes(r.size)}</span>
              <UploadState state={r.state} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function UploadState({ state }: { state: UploadRow['state'] }) {
  if (state === 'queued') return <span className="text-[11.5px] text-kumo-subtle">queued</span>
  if (state === 'reading') return <span className="breathe text-[11.5px] text-kumo-default">uploading…</span>
  if (state === 'done') return <span className="text-[11.5px] text-emerald-700">received</span>
  return <span className="text-[11.5px] text-red-700">couldn&apos;t upload, try again</span>
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function Words({ token }: { token: string }) {
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  const send = async () => {
    if (!text.trim() || state === 'sending') return
    setState('sending')
    try {
      const res = await fetch(`${apiBase(token)}/words`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setText('')
      setState('sent')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="rounded-[14px] border border-kumo-line bg-kumo-elevated px-5 py-4">
      <p className="text-[14.5px] leading-[1.6] text-kumo-default">
        In your own words: the work you do and why it matters, your goals in the U.S., key achievements, anything you
        think we should know. You can also paste a link (an award page, profile, or article). The more context you
        give, the stronger your petition.
      </p>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); if (state !== 'sending') setState('idle') }}
        rows={5}
        placeholder="Write as much as you like…"
        className="mt-3 w-full resize-y rounded-[10px] border border-kumo-line bg-kumo-base px-3 py-2 text-[14.5px] leading-[1.55] text-kumo-default outline-none focus:border-kumo-ring"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-kumo-subtle">
          {state === 'sent' ? 'Shared with your legal team. Thank you.'
            : state === 'failed' ? 'Couldn\'t send that. Please try again.'
            : 'Shared privately with your legal team.'}
        </span>
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || state === 'sending'}
          className="rounded-full bg-kumo-brand px-4 py-1.5 text-[13.5px] font-medium text-white transition-opacity disabled:opacity-30"
        >
          {state === 'sending' ? 'Sending…' : 'Share with my legal team'}
        </button>
      </div>
    </div>
  )
}
