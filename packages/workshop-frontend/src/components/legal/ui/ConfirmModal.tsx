import { useState, type ReactNode } from 'react'
import { WorkshopButton, WorkshopInput } from '../../WorkshopControls'
import { LegalDialog } from '../primitives'

/**
 * The in-app replacement for window.confirm. Owns its busy state, shows a failed confirm in words,
 * and can gate the confirm on a phrase the lawyer types (visible, selectable, never a placeholder:
 * grey hint text made deletion feel random, live-caught).
 */
export function ConfirmModal({
  open,
  heading,
  body,
  confirmLabel,
  busyLabel = 'Working…',
  tone = 'danger',
  typeToConfirm,
  onCancel,
  onConfirm,
}: {
  open: boolean
  heading: string
  body: ReactNode
  confirmLabel: string
  busyLabel?: string
  tone?: 'danger' | 'primary'
  /** When set, the confirm stays disabled until the lawyer types exactly this phrase. */
  typeToConfirm?: string
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [typed, setTyped] = useState('')

  const gated = typeToConfirm !== undefined && typed.trim() !== typeToConfirm.trim()

  const run = async () => {
    setBusy(true)
    setFailure(null)
    try {
      await onConfirm()
    } catch (err) {
      setFailure(err instanceof Error && err.message ? err.message : "That didn't go through — try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <LegalDialog
      open={open}
      busy={busy}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title={heading}
      footer={
        <>
          <WorkshopButton className="!h-9" onClick={onCancel} disabled={busy}>
            Cancel
          </WorkshopButton>
          <WorkshopButton tone={tone} className="!h-9" onClick={() => void run()} disabled={busy || gated}>
            {busy ? busyLabel : confirmLabel}
          </WorkshopButton>
        </>
      }
    >
      <div className="space-y-3 text-[13.5px] leading-[20px] tracking-[-0.25px] text-kumo-default">
        <div>{body}</div>
        {typeToConfirm !== undefined && (
          <div>
            <p className="m-0 mb-1.5 text-[12.5px] leading-[18px] text-kumo-subtle">
              Type <span className="select-all font-medium text-kumo-default">{typeToConfirm}</span> to confirm:
            </p>
            <WorkshopInput
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full"
              autoFocus
              disabled={busy}
            />
          </div>
        )}
        {failure && (
          <p role="alert" className="m-0 text-[12.5px] leading-[18px] text-kumo-danger">
            {failure}
          </p>
        )}
      </div>
    </LegalDialog>
  )
}
