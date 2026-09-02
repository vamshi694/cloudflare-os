import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk } from '@gadgets/workshop-shared/legal'
import { UploadSimple } from '@phosphor-icons/react'
import { logRpcFailure } from '../../rpcErrors'
import { StatusDot } from './primitives'
import { formatBytes } from './labels'

/** R2 multipart: every part except the last must be at least 5 MiB, so we slice at exactly that. */
const PART_BYTES = 5 * 1024 * 1024
/** Uploads run a few at a time so a big drop never stalls or clobbers the server. */
const MAX_CONCURRENT = 3

export type UploadRow = {
  key: string
  name: string
  bytes: number
  phase: 'uploading' | 'queued' | 'failed'
  /** Set once the document is registered, so the row can retire when it shows in the list. */
  documentId?: string
  /** Honest failure copy — what didn't happen. */
  failure?: string
}

async function uploadOne(desk: RpcStub<MatterDesk>, file: File): Promise<string> {
  const { uploadId } = await desk.beginUpload(file.name, file.type || 'application/octet-stream')
  try {
    let partNumber = 1
    for (let offset = 0; offset < file.size || partNumber === 1; offset += PART_BYTES) {
      const slice = file.slice(offset, Math.min(offset + PART_BYTES, file.size))
      const bytes = new Uint8Array(await slice.arrayBuffer())
      await desk.uploadPart(uploadId, partNumber, bytes)
      partNumber += 1
      if (file.size === 0) break
    }
    const { id } = await desk.finishUpload(uploadId)
    return id
  } catch (err) {
    // Best effort: leave nothing half-written on the server.
    await desk.abortUpload(uploadId).catch(() => {})
    throw err
  }
}

/**
 * A queue of uploads with per-file status. Each file: beginUpload → uploadPart in 5 MiB slices →
 * finishUpload, at most three at once. `onUploaded` fires after each registration so the list can
 * refresh. The row is reserved before the bytes move.
 */
export function useUploads(desk: RpcStub<MatterDesk>, onUploaded: () => void) {
  const [rows, setRows] = useState<UploadRow[]>([])
  const queue = useRef<{ key: string; file: File }[]>([])
  const active = useRef(0)
  const onUploadedRef = useRef(onUploaded)
  onUploadedRef.current = onUploaded

  const patch = (key: string, change: Partial<UploadRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)))

  const pump = useCallback(() => {
    while (active.current < MAX_CONCURRENT && queue.current.length > 0) {
      const next = queue.current.shift()!
      active.current += 1
      uploadOne(desk, next.file)
        .then((documentId) => {
          patch(next.key, { phase: 'queued', documentId })
          onUploadedRef.current()
        })
        .catch((err) => {
          logRpcFailure('Upload failed:', err)
          patch(next.key, {
            phase: 'failed',
            failure: 'This file did not reach the matter. Nothing was added — drop it again to retry.',
          })
        })
        .finally(() => {
          active.current -= 1
          pump()
        })
    }
  }, [desk])

  const add = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      const entries = files.map((file) => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file }))
      setRows((prev) => [
        ...prev,
        ...entries.map<UploadRow>((e) => ({ key: e.key, name: e.file.name, bytes: e.file.size, phase: 'uploading' })),
      ])
      queue.current.push(...entries)
      pump()
    },
    [pump],
  )

  const dismiss = useCallback((key: string) => setRows((prev) => prev.filter((r) => r.key !== key)), [])

  return { rows, add, dismiss }
}

function useDropTarget(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false)
  const onDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setDragging(true)
  }
  const onDragLeave = () => setDragging(false)
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setDragging(false)
    onFiles(Array.from(e.dataTransfer.files))
  }
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    onFiles(Array.from(e.target.files ?? []))
    // Reset so the same file re-fires if picked again.
    e.target.value = ''
  }
  return { dragging, onDragOver, onDragLeave, onDrop, onPick }
}

/**
 * The drop target is a <label> wrapping a hidden input: the BROWSER opens the picker natively on
 * click, no JS .click() that some browsers swallow. Two shapes: the full dropzone, and a compact
 * toolbar button that is still a drop target.
 */
export function Dropzone({ onFiles, hint, busy = false }: { onFiles: (files: File[]) => void; hint?: string; busy?: boolean }) {
  const d = useDropTarget(onFiles)
  return (
    <label
      onDragOver={d.onDragOver}
      onDragLeave={d.onDragLeave}
      onDrop={d.onDrop}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[16px] border-2 border-dashed px-6 py-8 text-center transition-colors ${
        d.dragging ? 'border-kumo-brand bg-kumo-brand/5' : 'border-kumo-line bg-kumo-base hover:bg-kumo-elevated'
      }`}
    >
      <input type="file" multiple className="sr-only" onChange={d.onPick} />
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-kumo-tint text-kumo-subtle">
        <UploadSimple size={16} />
      </span>
      <span className="text-[14px] leading-5 font-medium tracking-[-0.3px] text-kumo-default">
        {busy ? 'Reading your documents…' : d.dragging ? 'Drop to add to the matter' : 'Drop documents here'}
      </span>
      <span className="text-[12.5px] leading-[18px] tracking-[-0.2px] text-kumo-subtle">
        {hint ?? 'or click to choose. Drag as many as you like. PDF, Word, images (scans are read automatically).'}
      </span>
    </label>
  )
}

export function UploadButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const d = useDropTarget(onFiles)
  return (
    <label
      onDragOver={d.onDragOver}
      onDragLeave={d.onDragLeave}
      onDrop={d.onDrop}
      className={`press inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors ${
        d.dragging ? 'bg-kumo-brand/10 ring-2 ring-kumo-brand/40 text-kumo-default' : 'bg-kumo-contrast text-kumo-inverse hover:bg-kumo-strong'
      }`}
    >
      <input type="file" multiple className="sr-only" onChange={d.onPick} />
      <UploadSimple size={14} />
      Upload
    </label>
  )
}

/** One honest row per file. No percentage bar: nothing here measures progress. */
export function UploadRows({ rows, onDismiss }: { rows: UploadRow[]; onDismiss: (key: string) => void }) {
  if (rows.length === 0) return null
  return (
    <ul className="m-0 list-none divide-y divide-kumo-line overflow-hidden rounded-xl border border-kumo-line bg-kumo-base p-0">
      {rows.map((row) => {
        const ext = (row.name.split('.').pop() ?? '').slice(0, 3).toUpperCase() || 'DOC'
        return (
          <li key={row.key} className="flex items-center gap-3 px-4 py-2.5">
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-[10px] font-semibold ${
                row.phase === 'failed' ? 'bg-kumo-danger-tint text-kumo-danger' : 'bg-kumo-tint text-kumo-subtle'
              }`}
            >
              {ext}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13.5px] leading-5 tracking-[-0.25px] text-kumo-default">{row.name}</span>
                <span className="tnum shrink-0 text-[12px] text-kumo-inactive">{formatBytes(row.bytes)}</span>
              </div>
              {row.phase === 'failed' && row.failure && <p className="mt-0.5 text-[12.5px] leading-[18px] text-kumo-danger">{row.failure}</p>}
            </div>
            <UploadPhase row={row} />
            {row.phase === 'failed' && (
              <button
                type="button"
                onClick={() => onDismiss(row.key)}
                className="press inline-flex h-7 cursor-pointer items-center rounded-md px-2 text-[12.5px] font-medium text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default"
              >
                Dismiss
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function UploadPhase({ row }: { row: UploadRow }) {
  if (row.phase === 'uploading') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-kumo-default">
        <StatusDot tone="working" className="breathe" />
        uploading…
      </span>
    )
  }
  if (row.phase === 'queued') {
    return <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-kumo-subtle">queued for reading</span>
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-kumo-danger">
      <StatusDot tone="needsYou" />
      couldn't upload, try again
    </span>
  )
}
