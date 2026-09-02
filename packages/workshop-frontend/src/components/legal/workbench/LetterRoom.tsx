import { useCallback, useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk, Petition } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../../rpcErrors'
import { DocViewer } from '../ui/DocViewer'
import { SectionRail } from './SectionRail'
import { LetterSheet } from './LetterSheet'
import { IntelPanel } from './IntelPanel'
import { DirectiveDialog, HistoryPanel, RfePanel } from './panels'
import { citationsFor } from './petition-utils'
import { plural } from '../labels'

/**
 * THE PETITION WORKBENCH — full screen, three zones: the section rail, the letter itself (a paper
 * sheet), and the selected section's INTELLIGENCE panel. Every section carries its own live
 * feedback loop.
 */
export function LetterRoom({
  desk,
  petition,
  reload,
  deliverables,
  onOpenDeliverable,
}: {
  desk: RpcStub<MatterDesk>
  petition: Petition
  reload: () => void
  deliverables: { path: string; updatedAt: string }[]
  onOpenDeliverable: (path: string) => void
}) {
  const toasts = useKumoToastManager()
  const [activeKey, setActiveKey] = useState<string | null>(petition.sections[0]?.key ?? null)
  const [history, setHistory] = useState(false)
  const [rfe, setRfe] = useState(false)
  const [directive, setDirective] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [viewer, setViewer] = useState<{ exhibitNo: number; title: string; url: string | null; failed: boolean } | null>(null)

  useEffect(() => {
    if (activeKey && !petition.sections.some((s) => s.key === activeKey)) setActiveKey(petition.sections[0]?.key ?? null)
  }, [petition.sections, activeKey])

  const active = petition.sections.find((s) => s.key === activeKey) ?? null

  const redraft = useCallback(
    async (key: string, instruction: string, remember: boolean) => {
      await desk.redraftSection(key, instruction, { remember })
      reload()
    },
    [desk, reload],
  )

  const exportLetter = async () => {
    setExporting(true)
    try {
      const { markdown } = await desk.exportLetter()
      const blob = new Blob([markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `petition-letter-${new Date().toISOString().slice(0, 10)}.md`
      a.click()
      URL.revokeObjectURL(url)
      reload()
    } catch (err) {
      logRpcFailure('Failed to export the letter:', err)
      toasts.add({ title: "The letter couldn't be prepared just now. Nothing changed — try again.", variant: 'error' })
    } finally {
      setExporting(false)
    }
  }

  const openExhibit = async (n: number) => {
    const ex = petition.exhibits.find((e) => e.exhibitNo === n)
    if (!ex) {
      toasts.add({ title: `Exhibit ${n} is not on the record any more. Regenerate the section so its citations match the current exhibits.`, variant: 'error' })
      return
    }
    setViewer({ exhibitNo: n, title: ex.title, url: null, failed: false })
    try {
      const url = await desk.fileUrl(ex.documentId)
      setViewer({ exhibitNo: n, title: ex.title, url, failed: false })
    } catch (err) {
      logRpcFailure('Failed to fetch the exhibit:', err)
      setViewer({ exhibitNo: n, title: ex.title, url: null, failed: true })
    }
  }

  const stale = petition.staleSections.map((k) => petition.sections.find((s) => s.key === k)?.title ?? k)
  const unverified = petition.sections.filter((s) => s.unverifiedQuotes.length > 0)
  const unverifiedCount = unverified.reduce((n, s) => n + s.unverifiedQuotes.length, 0)
  const highCoherence = petition.coherence.filter((c) => c.severity === 'high').length

  return (
    <div className="flex items-start gap-6">
      <aside className="hidden w-[248px] shrink-0 lg:block">
        <SectionRail
          petition={petition}
          activeKey={activeKey}
          onSelect={setActiveKey}
          onOpenDirective={() => setDirective(true)}
          onOpenHistory={() => setHistory(true)}
          onOpenRfe={() => setRfe(true)}
          onExport={() => void exportLetter()}
          exporting={exporting}
          deliverables={deliverables}
          onOpenDeliverable={onOpenDeliverable}
        />
      </aside>
      <div className="min-w-0 flex-1 space-y-3">
        {stale.length > 0 && (
          <Blocker><strong>Not filing-ready.</strong> These sections cite exhibits that are no longer in the record: {stale.join(', ')}. The record changed after they were written. Regenerate them so every citation matches the current exhibits.</Blocker>
        )}
        {unverifiedCount > 0 && (
          <Blocker>{plural(unverifiedCount, 'quote', 'quotes')} in the letter couldn't be verified against the record ({unverified.map((s) => s.title).join(', ')}). Each section's panel shows the exact quote. <strong>An export before this clears is stamped DRAFT.</strong></Blocker>
        )}
        {petition.coherence.length > 0 && (
          <details className="rounded-lg border border-kumo-warning/30 bg-kumo-warning-tint/30 px-3 py-2 text-[12.5px] leading-[18px] text-kumo-default">
            <summary className="tnum cursor-pointer">Cross-section review · {plural(petition.coherence.length, 'finding', 'findings')} · {highCoherence} high-risk</summary>
            <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
              {petition.coherence.map((c, i) => (
                <li key={i}>{c.a} vs {c.b}: {c.issue} {c.fix}</li>
              ))}
            </ul>
          </details>
        )}
        <LetterSheet
          petition={petition}
          activeKey={activeKey}
          onSelect={setActiveKey}
          onExhibit={(n) => void openExhibit(n)}
          onFeedback={(key, quote, instruction) => redraft(key, `The attorney highlighted this passage: "${quote}" and instructs: ${instruction}`, false)}
        />
      </div>
      <aside className="hidden w-[340px] shrink-0 self-stretch xl:flex">
        {active && <IntelPanel key={active.key} section={active} caseType={petition.caseType} onRedraft={redraft} desk={desk} />}
      </aside>

      <HistoryPanel open={history} onClose={() => setHistory(false)} versions={petition.versions} />
      <RfePanel
        open={rfe}
        onClose={() => setRfe(false)}
        desk={desk}
        caseType={petition.caseType}
        onFix={(sectionTitle, instruction) => {
          const s = petition.sections.find((x) => x.title === sectionTitle || x.key === sectionTitle)
          if (!s) return
          setActiveKey(s.key)
          void redraft(s.key, instruction, false).catch((err) => {
            logRpcFailure('Failed to start the fix:', err)
            toasts.add({ title: "The redraft didn't start. This section is unchanged — try again.", variant: 'error' })
          })
        }}
      />
      <DirectiveDialog open={directive} onClose={() => setDirective(false)} desk={desk} petition={petition} onSaved={reload} />
      {viewer && (
        <DocViewer
          name={viewer.title}
          exhibitNo={viewer.exhibitNo}
          src={viewer.url}
          mime={viewer.url ? 'application/pdf' : undefined}
          text={viewer.url ? null : viewer.failed ? 'The exhibit could not be fetched just now. It is unchanged — close and try again.' : 'Fetching the exhibit…'}
          citations={citationsFor(petition, viewer.exhibitNo)}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  )
}

function Blocker({ children }: { children: React.ReactNode }) {
  return <p className="m-0 rounded-lg border border-kumo-warning/30 bg-kumo-warning-tint/30 px-3 py-2 text-[12.5px] leading-[18px] text-kumo-default">{children}</p>
}
