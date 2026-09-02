import { useCallback, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { RpcStub } from 'capnweb'
import type { ClientMessage, MatterDesk } from '@gadgets/workshop-shared/legal'
import { logRpcFailure } from '../../rpcErrors'
import { WorkshopButton, WorkshopInputArea } from '../WorkshopControls'
import { EmptyLine, Notice } from './primitives'
import { useDeskData } from './useMatterDesk'
import { fmtDateTime } from './labels'

const MAX = 2000

/**
 * MESSAGES — dual control. The firm's outreach and the client's replies are the record; the
 * composer is the lawyer doing it themselves. No approval card on send: a lawyer pressing Send IS
 * the decision. A conversation reads by SHAPE: the firm's messages sit right, the client's left.
 * The one badge that matters: "Drafted — the client has not received this."
 */
export function MessagesTab({ desk, onChanged }: { desk: RpcStub<MatterDesk>; onChanged: () => void }) {
  const load = useCallback(() => desk.messages(), [desk])
  const { data, failed, reload } = useDeskData<ClientMessage[]>(load, { pollMs: 8000 })
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const send = async () => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    setNote(null)
    try {
      const sent = await desk.sendMessage(body)
      setDraft('')
      setNote({ tone: 'ok', text: sent.sent ? "Delivered to the client's portal. They're emailed shortly after." : 'Saved on the matter.' })
      reload()
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to send the client message:', err)
      setNote({ tone: 'error', text: 'The message was not sent. The client has not seen it — try again.' })
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="max-w-[760px] space-y-4">
      {data === null && failed && (
        <Notice title="The client conversation couldn't be loaded." body="Nothing has changed on the matter — this view keeps retrying." />
      )}
      {data === null && !failed && <div className="skeleton h-[200px]" />}
      {data !== null && failed && <p className="m-0 text-[12.5px] italic text-kumo-subtle">Not updating right now — showing the last view that loaded.</p>}
      {data !== null && data.length === 0 && (
        <EmptyLine title="No messages yet." body="Write to the client below, or let the firm draft the next request for you." />
      )}
      {data !== null && data.length > 0 && <Thread messages={data} />}

      <div className="shadow-depth rounded-[14px] border border-kumo-line bg-kumo-base px-4 py-3">
        <WorkshopInputArea
          rows={2}
          value={draft}
          maxLength={MAX}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Write to the client…"
          className="w-full !border-0 !bg-transparent !px-0 !shadow-none focus:!ring-0"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className={`m-0 min-w-0 text-[12.5px] leading-[18px] ${note?.tone === 'error' ? 'text-kumo-danger' : 'text-kumo-subtle'}`}>
            {note?.text ?? '⌘/Ctrl+Enter sends.'}
          </p>
          <WorkshopButton tone="primary" className="!h-8" onClick={() => void send()} disabled={busy || !draft.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </WorkshopButton>
        </div>
      </div>
    </div>
  )
}

function Thread({ messages }: { messages: ClientMessage[] }) {
  return (
    <ol className="m-0 list-none space-y-3 p-0">
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const sameRun = prev && prev.direction === m.direction
        const outbound = m.direction === 'outbound'
        const drafted = outbound && m.source !== 'lawyer' && !m.sent
        const subject = m.subject && !/^message to the client$/i.test(m.subject.trim()) ? m.subject : null
        return (
          <li key={m.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'} ${sameRun ? '!mt-1' : ''}`}>
            <div className="max-w-[74%] min-w-0">
              {!sameRun && (
                <p className={`m-0 mb-1 text-[11.5px] text-kumo-inactive ${outbound ? 'text-right' : ''}`}>
                  {outbound ? 'The firm' : 'Client'} · {fmtDateTime(m.at)}
                </p>
              )}
              <div className={`rounded-[14px] px-4 py-3 text-[14.5px] leading-[1.55] whitespace-pre-wrap ${outbound ? 'bg-kumo-brand/[0.07] text-kumo-default' : 'border border-kumo-line bg-kumo-base text-kumo-default'}`}>
                {subject && <p className="m-0 mb-1 text-[13px] font-medium">{subject}</p>}
                {m.body}
              </div>
              {drafted && (
                <p className="m-0 mt-1 text-right text-[11.5px] font-medium text-kumo-warning">Drafted — the client has not received this.</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
