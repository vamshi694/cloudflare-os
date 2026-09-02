import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { RpcStub } from 'capnweb'
import { ChartBar, ChartLineUp, Gear, Scales, UsersThree } from '@phosphor-icons/react'
import type { AdminApi, AdminSettingsView, AmbientGatekeeperMode, AuthenticatedApi, FirmAnalytics, FirmMatterRow, FirmMember, Invite, UsageSummary } from '@gadgets/workshop-shared/api'
import { PHASE_LABEL } from '../components/legal/labels'
import { useAuthenticatedApi } from '../AuthContext'
import { useDocumentTitle } from '../useDocumentTitle'
import { logRpcFailure } from '../rpcErrors'
import { WorkshopButton, WorkshopInput } from '../components/WorkshopControls'
import { useDesk, usePolled } from '../components/firm/useDesk'
import { EmptyLine, Eyebrow, FieldLabel, Notice, Pill, RadioRow, SegmentedTabs, Skeleton, ThreeState, formatDate, plural, relativeTime } from '../components/legal/primitives'

type Tab = 'team' | 'matters' | 'usage' | 'analytics' | 'platform'
const TABS: Tab[] = ['team', 'matters', 'usage', 'analytics', 'platform']

export const Route = createFileRoute('/team')({
  component: TeamPage,
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: typeof search.tab === 'string' && (TABS as string[]).includes(search.tab)
      ? (search.tab as Tab)
      : search.tab === 'spend' ? 'usage' : undefined,
  }),
})

const mintAdmin = (api: RpcStub<AuthenticatedApi>) => api.getAdminApi()
const POLL_MS = 30_000

function dollars(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}
function tokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n)
}

const SUBTITLE: Record<Tab, string> = {
  team: 'The attorneys admitted to this practice — every matter, playbook layer, and approval is attributed to a named member.',
  matters: 'Every matter the firm is running, whoever owns it — where each stands, what waits on its attorney, what it has cost.',
  usage: 'What the OS cost — credits and tokens by day, by model and by member, and each member’s monthly ceiling.',
  analytics: 'What the firm did — documents read, facts and claims on file, sections drafted, decisions answered, and the turns the counsel took on its own.',
  platform: 'The deployment: its name, the counsel’s standing instructions, which capabilities every conversation carries, and whether the door is open.',
}

/**
 * THE FIRM screen — the firm runs itself, one desk with five drawers: THE TEAM (who practices
 * here — invite, roles, allowances), MATTERS (every matter in the firm, whoever owns it), USAGE
 * (credits, tokens, ceilings), ANALYTICS (what the firm did), and PLATFORM (the deployment's own
 * settings). The server enforces every rule; this screen only renders what the API allows and
 * repeats its plain-language refusals.
 */
function TeamPage() {
  useDocumentTitle('The firm')
  const { isAdmin } = useAuthenticatedApi()
  const { tab: tabParam } = Route.useSearch()
  const [tab, setTabState] = useState<Tab>(tabParam ?? 'team')
  const setTab = (next: Tab) => {
    setTabState(next)
    const url = new URL(window.location.href)
    if (next === 'team') url.searchParams.delete('tab')
    else url.searchParams.set('tab', next)
    window.history.replaceState(window.history.state, '', url)
  }

  const admin = useDesk<AdminApi>(mintAdmin, "the firm's desk")
  const api = admin.kind === 'ready' ? admin.stub : null

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-[860px] px-4 pt-10 sm:px-8">
        <Notice
          tone="info"
          title="This screen is for the firm's admins"
          body="Team management — members, roles, and firm spend — is an admin surface. Your own matters live under Matters."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[860px] flex-col px-4 sm:px-8">
      <header className="pt-8 pb-4 sm:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 text-[28px] leading-8 font-semibold tracking-[-0.6px] text-kumo-default">The firm</h1>
            <p className="mt-1 mb-0 max-w-[640px] text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">{SUBTITLE[tab]}</p>
          </div>
          <SeatsChip api={api} />
        </div>
        <div className="mt-4">
          <SegmentedTabs<Tab>
            ariaLabel="The firm"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'team', label: 'The team', icon: <UsersThree size={14} /> },
              { key: 'matters', label: 'Matters', icon: <Scales size={14} /> },
              { key: 'usage', label: 'Usage', icon: <ChartBar size={14} /> },
              { key: 'analytics', label: 'Analytics', icon: <ChartLineUp size={14} /> },
              { key: 'platform', label: 'Platform', icon: <Gear size={14} /> },
            ]}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 pb-10">
        {admin.kind === 'failed' || admin.kind === 'disabled' ? (
          <Notice title="The firm's desk couldn't be opened." body="Nothing has changed. Reload to try again." />
        ) : tab === 'team' ? (
          <TeamDrawer api={api} />
        ) : tab === 'matters' ? (
          <MattersDrawer api={api} />
        ) : tab === 'analytics' ? (
          <AnalyticsDrawer api={api} />
        ) : tab === 'platform' ? (
          <PlatformDrawer api={api} />
        ) : (
          <SpendDrawer api={api} />
        )}
      </div>
    </div>
  )
}

function SeatsChip({ api }: { api: RpcStub<AdminApi> | null }) {
  const read = useCallback(() => (api ? api.listMembers() : Promise.reject(new Error('no api'))), [api])
  const members = usePolled<FirmMember[]>(api ? read : null, POLL_MS)
  if (!members.data) return null
  return <Pill>{plural(members.data.length, 'member', 'members')}</Pill>
}

// ── The team ────────────────────────────────────────────────────────────────────────────────────

function TeamDrawer({ api }: { api: RpcStub<AdminApi> | null }) {
  const { currentUser } = useAuthenticatedApi()
  const readMembers = useCallback(() => (api ? api.listMembers() : Promise.reject(new Error('no api'))), [api])
  const readInvites = useCallback(() => (api ? api.listInvites() : Promise.reject(new Error('no api'))), [api])
  const readLimits = useCallback(() => (api ? api.getUserMonthlyLimits() : Promise.reject(new Error('no api'))), [api])
  const readFirmMatters = useCallback(() => (api ? api.listFirmMatters() : Promise.reject(new Error('no api'))), [api])
  const members = usePolled<FirmMember[]>(api ? readMembers : null, POLL_MS)
  const invites = usePolled<Invite[]>(api ? readInvites : null, POLL_MS)
  const limits = usePolled<Record<string, number>>(api ? readLimits : null, POLL_MS)
  const firmMatters = usePolled<FirmMatterRow[]>(api ? readFirmMatters : null, POLL_MS)
  const mattersByOwner = useMemo(() => {
    if (!firmMatters.data) return null
    const counts = new Map<string, number>()
    for (const m of firmMatters.data) if (m.ownerUserId) counts.set(m.ownerUserId, (counts.get(m.ownerUserId) ?? 0) + 1)
    return counts
  }, [firmMatters.data])

  const pending = useMemo(() => (invites.data ?? []).filter((i) => !i.usedAt && !i.revoked), [invites.data])

  return (
    <div className="space-y-6">
      <InviteBox api={api} onChanged={() => { invites.refresh(); members.refresh() }} />

      <section>
        <Eyebrow>Members</Eyebrow>
        <div className="mt-2">
          <ThreeState
            items={members.data}
            failed={members.failed}
            skeleton={<div className="space-y-3"><Skeleton className="h-[120px]" /><Skeleton className="h-[120px]" /></div>}
            neverLoaded={{ title: "The team couldn't be loaded.", body: 'Nothing has changed. This view keeps retrying; reload if it stays empty.' }}
            stale="Not updating right now — showing the last view that loaded."
            empty={<EmptyLine title="No members yet" body="This box is running in single-lawyer mode. Invite an attorney above." />}
          >
            {(items) => (
              <ul className="m-0 list-none space-y-3 p-0">
                {items.map((m) => (
                  <MemberCard
                    key={m.userId}
                    member={m}
                    self={currentUser?.id === m.userId}
                    limit={limits.data?.[m.userId] ?? 0}
                    matters={mattersByOwner ? (mattersByOwner.get(m.userId) ?? 0) : null}
                    api={api}
                    onChanged={() => { limits.refresh(); members.refresh() }}
                  />
                ))}
              </ul>
            )}
          </ThreeState>
        </div>
      </section>

      <section>
        <Eyebrow>Pending invitations</Eyebrow>
        <div className="mt-2">
          {invites.data === null ? (
            invites.failed ? <Notice tone="stale" title="Invitations couldn't be read just now — this list may be out of date." /> : <Skeleton className="h-[44px]" />
          ) : pending.length === 0 ? (
            <p className="m-0 text-[13px] leading-[18px] text-kumo-subtle">None waiting.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-kumo-line rounded-xl border border-kumo-line bg-kumo-base p-0">
              {pending.map((inv) => (
                <InviteRow key={inv.token} invite={inv} api={api} onChanged={() => invites.refresh()} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

function inviteLink(token: string): string {
  return `${window.location.origin}/signup?invite=${token}`
}

function InviteBox({ api, onChanged }: { api: RpcStub<AdminApi> | null; onChanged: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Invite['role']>('practitioner')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ link: string; email: string } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!api || !email.trim() || busy) return
    setBusy(true)
    setFailure(null)
    try {
      const inv = await api.createInvite(email.trim(), role)
      setResult({ link: inviteLink(inv.token), email: inv.email })
      setEmail('')
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to create the invitation:', err)
      setFailure(`The invitation wasn't created: ${err instanceof Error ? err.message : 'try again'}.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
      <p className="m-0 text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">Invite an attorney</p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <FieldLabel>Email</FieldLabel>
          <WorkshopInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="associate@firm.com" className="w-full" disabled={busy} />
        </div>
        <div className="sm:w-56">
          <FieldLabel>Role</FieldLabel>
          <div className="flex gap-1">
            <RadioRow name="invite-role" value="practitioner" checked={role === 'practitioner'} onChange={(v) => setRole(v as Invite['role'])} disabled={busy}>Practitioner</RadioRow>
            <RadioRow name="invite-role" value="admin" checked={role === 'admin'} onChange={(v) => setRole(v as Invite['role'])} disabled={busy}>Admin</RadioRow>
          </div>
        </div>
        <WorkshopButton type="submit" tone="primary" className="!h-9" disabled={!api || !email.trim() || busy}>
          {busy ? 'Sending…' : 'Send invite'}
        </WorkshopButton>
      </form>
      {failure && <p role="alert" className="mt-2 mb-0 text-[12.5px] leading-[18px] text-kumo-danger">{failure}</p>}
      {result && (
        <div className="mt-3 rounded-lg bg-kumo-tint px-3 py-2.5">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-[12.5px] leading-[18px] text-kumo-default">{result.link}</code>
            <WorkshopButton
              className="!h-8 shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(result.link).then(() => setCopied(true)).catch(() => {})
                window.setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </WorkshopButton>
          </div>
          <p className="m-0 mt-1.5 text-[12px] leading-4 text-kumo-subtle">
            They sign in with this email address and land on your firm&apos;s desk. Expires in 30 days.
          </p>
        </div>
      )}
    </section>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0" title={note}>
      <p className="m-0 text-[10.5px] leading-4 font-semibold uppercase tracking-[0.8px] text-kumo-subtle">{label}</p>
      <p className="m-0 mt-0.5 truncate text-[14px] leading-5 text-kumo-default" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
    </div>
  )
}

const NOT_TRACKED = 'Not tracked yet on this deployment.'

/**
 * Members are cards, not table rows: identity up top, controls on the right, and a LABELED
 * metric grid underneath — the admin reads columns, never a dot-run. A metric with no source
 * renders an honest dash, never a fake zero.
 */
function MemberCard({ member, self, limit, matters, api, onChanged }: {
  member: FirmMember; self: boolean; limit: number; matters: number | null; api: RpcStub<AdminApi> | null; onChanged: () => void
}) {
  const [allowance, setAllowance] = useState(limit > 0 ? String(limit) : '')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => { setAllowance(limit > 0 ? String(limit) : '') }, [limit])

  const saveAllowance = async () => {
    if (!api || busy) return
    setBusy(true)
    setNote(null)
    try {
      await api.setUserMonthlyLimit(member.userId, Number(allowance) || 0)
      setNote(Number(allowance) > 0 ? 'Allowance saved.' : 'Ceiling removed.')
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to save the allowance:', err)
      setNote(`That didn't save: ${err instanceof Error ? err.message : 'try again'}.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-2xl border border-kumo-line bg-kumo-base px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kumo-tint text-[13px] font-semibold text-kumo-default">
            {member.userId.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] leading-5 font-semibold tracking-[-0.3px] text-kumo-default">
              <span className="truncate">{member.userId}</span>
              <Pill tone={member.role === 'admin' ? 'ready' : 'neutral'}>{member.role === 'admin' ? 'Admin' : 'Practitioner'}</Pill>
              {self && <span className="text-[11.5px] font-normal text-kumo-inactive">you</span>}
            </p>
            <p className="m-0 mt-0.5 text-[12.5px] leading-4 text-kumo-subtle">
              {member.joinedAt ? `Joined ${formatDate(member.joinedAt)}` : member.role === 'admin' ? 'Configured as an admin of this deployment' : 'Known from the usage ledger'}
            </p>
          </div>
        </div>
        {!self && (
          <div className="flex items-end gap-2">
            <div>
              <FieldLabel hint="Dollars per month; blank or 0 = no ceiling">Allowance</FieldLabel>
              <WorkshopInput type="number" min={0} value={allowance} onChange={(e) => setAllowance(e.target.value)} className="w-28" disabled={busy || !api} placeholder="none" />
            </div>
            <WorkshopButton className="!h-9" onClick={() => void saveAllowance()} disabled={busy || !api}>
              {busy ? 'Saving…' : 'Save'}
            </WorkshopButton>
          </div>
        )}
      </div>
      {note && <p className="mt-2 mb-0 text-[12px] leading-4 text-kumo-subtle">{note}</p>}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-kumo-line pt-3 sm:grid-cols-3 md:grid-cols-6">
        <Metric label="Matters" value={matters === null ? '—' : String(matters)} note={matters === null ? "The firm's registry couldn't be read." : 'Matters this member owns, from the firm registry.'} />
        <Metric label="Credits" value={limit > 0 ? `${dollars(member.month.cost)} / ${dollars(limit)}` : `${dollars(member.month.cost)} / no ceiling`} note="This calendar month, from the usage ledger." />
        <Metric label="Tokens" value={tokens(member.month.tokens)} note="This calendar month." />
        <Metric label="Documents" value="—" note={NOT_TRACKED} />
        <Metric label="Sections" value="—" note={NOT_TRACKED} />
        <Metric label="Last activity" value={member.lastActiveAt ? relativeTime(member.lastActiveAt) : 'none yet'} />
      </div>
    </li>
  )
}

function InviteRow({ invite, api, onChanged }: { invite: Invite; api: RpcStub<AdminApi> | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<null | 'resend' | 'revoke'>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const expired = invite.expiresAt <= new Date().toISOString()

  const act = async (kind: 'resend' | 'revoke') => {
    if (!api || busy) return
    setBusy(kind)
    setFailure(null)
    try {
      // Resend re-mints through the same single-token path; the old link dies in the same act.
      if (kind === 'resend') await api.createInvite(invite.email, invite.role)
      else await api.revokeInvite(invite.token)
      onChanged()
    } catch (err) {
      logRpcFailure(`Failed to ${kind} the invitation:`, err)
      setFailure(kind === 'resend' ? "The invite wasn't re-sent — the old link still stands." : "The invite wasn't revoked — the link still works.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="m-0 flex flex-wrap items-center gap-2 text-[13.5px] leading-5 text-kumo-default">
          <span className="truncate">{invite.email}</span>
          <Pill>{invite.role === 'admin' ? 'Admin' : 'Practitioner'}</Pill>
          <Pill tone={expired ? 'warning' : 'neutral'}>{expired ? 'expired' : 'awaiting join'}</Pill>
        </p>
        <p className="m-0 mt-0.5 text-[12px] leading-4 text-kumo-subtle">
          Sent {formatDate(invite.createdAt)} · {expired ? 'expired' : `expires ${formatDate(invite.expiresAt)}`}
        </p>
        {failure && <p role="alert" className="m-0 mt-1 text-[12px] leading-4 text-kumo-danger">{failure}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <WorkshopButton className="!h-8" onClick={() => navigator.clipboard.writeText(inviteLink(invite.token)).catch(() => {})} disabled={expired}>Copy link</WorkshopButton>
        <WorkshopButton className="!h-8" onClick={() => void act('resend')} disabled={busy !== null}>{busy === 'resend' ? 'Sending…' : 'Resend'}</WorkshopButton>
        <WorkshopButton className="!h-8" onClick={() => void act('revoke')} disabled={busy !== null}>{busy === 'revoke' ? 'Revoking…' : 'Revoke'}</WorkshopButton>
      </div>
    </li>
  )
}

// ── Spend ───────────────────────────────────────────────────────────────────────────────────────

/**
 * THE FIRM'S MONTH: what the OS cost and what it DID — credits per day as honest columns (no
 * fake smoothing), the work itself as labeled bars. Pure SVG, tokens from the palette.
 */
function SpendDrawer({ api }: { api: RpcStub<AdminApi> | null }) {
  const read = useCallback(() => (api ? api.getUsageSummary(30) : Promise.reject(new Error('no api'))), [api])
  const summary = usePolled<UsageSummary>(api ? read : null, POLL_MS)
  const s = summary.data

  if (!s) {
    return summary.failed
      ? <Notice title="The ledger couldn't be read just now." body="Nothing has changed; it keeps retrying." />
      : <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-[220px]" /><Skeleton className="h-[220px]" /></div>
  }

  const days = s.byDay
  const maxDay = Math.max(0.0001, ...days.map((d) => d.cost))
  const W = 360, H = 120, PAD = 4
  const barW = days.length > 0 ? (W - PAD * 2) / days.length : W
  const maxModel = Math.max(0.0001, ...s.byModel.map((m) => m.cost))
  const firmWide = s.byWorkspace.filter((w) => !w.userId).reduce((a, w) => a + w.cost, 0)

  return (
    <div className="space-y-4">
      {summary.failed && <Notice tone="stale" title="Not updating right now — showing the last view that loaded." />}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
          <p className="m-0 text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">Credits, last 30 days</p>
          <p className="m-0 mt-0.5 text-[12.5px] leading-4 text-kumo-subtle" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {dollars(s.cost)} · {tokens(s.tokens)} tokens · {plural(s.turns, 'turn', 'turns')}
          </p>
          {days.length === 0 ? (
            <p className="m-0 mt-6 text-[13px] leading-[18px] text-kumo-subtle">No spend in the last 30 days.</p>
          ) : (
            <svg viewBox={`0 0 ${W} ${H + 18}`} className="mt-3 w-full" role="img" aria-label="Credits per day">
              {days.map((d, i) => {
                const h = Math.max(1.5, (d.cost / maxDay) * H)
                return (
                  <rect key={d.day} x={PAD + i * barW + 1} y={H - h} width={Math.max(1, barW - 2)} height={h} rx={1.5} className="fill-kumo-brand">
                    <title>{`${d.day}: ${dollars(d.cost)}, ${plural(d.turns, 'turn', 'turns')}`}</title>
                  </rect>
                )
              })}
              <text x={PAD} y={H + 13} className="fill-kumo-subtle" fontSize="9.5">{days[0].day.slice(5)}</text>
              <text x={W - PAD} y={H + 13} textAnchor="end" className="fill-kumo-subtle" fontSize="9.5">{days[days.length - 1].day.slice(5)}</text>
            </svg>
          )}
        </section>

        <section className="rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
          <p className="m-0 text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">What the firm did, last 30 days</p>
          <p className="m-0 mt-0.5 text-[12.5px] leading-4 text-kumo-subtle">Model turns by model. Work by kind lands here once matters record it.</p>
          {s.byModel.length === 0 ? (
            <p className="m-0 mt-6 text-[13px] leading-[18px] text-kumo-subtle">No activity recorded yet.</p>
          ) : (
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {s.byModel.map((m) => (
                <li key={m.modelId}>
                  <div className="flex items-baseline justify-between gap-3 text-[12.5px] leading-4">
                    <span className="truncate text-kumo-default">{m.modelId}</span>
                    <span className="shrink-0 text-kumo-subtle" style={{ fontVariantNumeric: 'tabular-nums' }}>{plural(m.turns, 'turn', 'turns')} · {dollars(m.cost)}</span>
                  </div>
                  <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-kumo-fill" aria-hidden>
                    <div className="h-full rounded-full bg-kumo-brand/70" style={{ width: `${Math.max(2, (m.cost / maxModel) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
        <p className="m-0 text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">By member</p>
        {s.byUser.length === 0 ? (
          <p className="m-0 mt-2 text-[13px] leading-[18px] text-kumo-subtle">No spend in the last 30 days.</p>
        ) : (
          <ul className="m-0 mt-2 list-none divide-y divide-kumo-line p-0">
            {s.byUser.map((u) => (
              <li key={u.userId} className="flex items-baseline justify-between gap-3 py-2 text-[13px] leading-[18px]">
                <span className="truncate text-kumo-default">{u.userId}</span>
                <span className="shrink-0 text-kumo-subtle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {dollars(u.cost)} · {plural(u.turns, 'turn', 'turns')} · {u.automatedTurns} automated · {tokens(u.tokens)} tokens
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 mt-3 text-[12px] leading-4 text-kumo-subtle">
          Firm-level and unowned-matter work: {dollars(firmWide)} — not attributed to any one member. Per-member spend this month lives on each card under The team.
        </p>
      </section>
    </div>
  )
}

// ── Matters: every matter in the firm ──────────────────────────────────────────────────────────

const PHASE_WORD: Record<string, string> = PHASE_LABEL as Record<string, string>

/**
 * Admin oversight of the whole firm's matters lives here and only here: one honest line per
 * matter (owner, type, phase, what waits on its attorney, what it has cost), every row read live
 * from the matter's own store. A matter whose store did not answer says so on its row.
 */
function MattersDrawer({ api }: { api: RpcStub<AdminApi> | null }) {
  const read = useCallback(() => (api ? api.listFirmMatters() : Promise.reject(new Error('no api'))), [api])
  const rows = usePolled<FirmMatterRow[]>(api ? read : null, POLL_MS)
  const sorted = useMemo(() => {
    if (!rows.data) return null
    return [...rows.data].sort((a, b) => (b.needsYou - a.needsYou) || (a.status === 'paused' ? -1 : 0) - (b.status === 'paused' ? -1 : 0) || b.createdAt.localeCompare(a.createdAt))
  }, [rows.data])
  const unowned = useMemo(() => (rows.data ?? []).filter((m) => !m.ownerUserId).length, [rows.data])

  return (
    <div className="space-y-4">
      <ThreeState
        items={sorted}
        failed={rows.failed}
        skeleton={<div className="space-y-3"><Skeleton className="h-[72px]" /><Skeleton className="h-[72px]" /><Skeleton className="h-[72px]" /></div>}
        neverLoaded={{ title: "The firm's matters couldn't be loaded.", body: 'This is a display problem — nothing has changed on any matter. This view keeps retrying; reload if it stays empty.' }}
        stale="Not updating right now — showing the last view that loaded."
        empty={<EmptyLine title="No matters in the firm yet" body="Every matter any member opens appears here, with its owner and where it stands." />}
      >
        {(items) => (
          <ul className="m-0 list-none space-y-2 p-0">
            {items.map((m) => (
              <li key={m.matterId}>
                <Link
                  to="/matter/$id"
                  params={{ id: m.matterId }}
                  className="block rounded-xl border border-kumo-line bg-kumo-base px-5 py-3.5 transition-colors hover:bg-kumo-elevated"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] leading-5 font-semibold tracking-[-0.25px] text-kumo-default">{m.title}</span>
                        <Pill>{m.caseType ?? 'Strategy pending'}</Pill>
                        {m.status === 'paused' && <Pill tone="warning">Paused</Pill>}
                      </div>
                      <p className="m-0 mt-0.5 text-[13px] leading-[18px] text-kumo-subtle">
                        {m.clientName} · {m.ownerUserId ? m.ownerUserId : 'no owner on record'}
                      </p>
                      <p className="m-0 mt-1 text-[13px] leading-[18px] text-kumo-default">
                        {m.unreachable
                          ? "This matter's record couldn't be read just now."
                          : m.status === 'paused' ? `Paused by ${m.ownerUserId ?? 'its attorney'}` : PHASE_WORD[m.phase] ?? m.phase}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {m.needsYou > 0 && <Pill tone="needsYou">{m.needsYou === 1 ? '1 needs them' : `${m.needsYou} need them`}</Pill>}
                      <span className="text-[12.5px] leading-4 text-kumo-subtle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {plural(m.documents, 'document', 'documents')} · {plural(m.facts, 'fact', 'facts')} · {m.monthCost === null ? 'spend —' : `${dollars(m.monthCost)} this month`}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ThreeState>
      {unowned > 0 && (
        <p className="m-0 text-[12.5px] leading-[18px] text-kumo-subtle">
          {plural(unowned, 'matter has', 'matters have')} no owner on record: they were opened before the registry learned their owners, and each is claimed the next time its attorney opens their desk.
        </p>
      )}
    </div>
  )
}

// ── Analytics: what the firm did ───────────────────────────────────────────────────────────────

function AnalyticsDrawer({ api }: { api: RpcStub<AdminApi> | null }) {
  const read = useCallback(() => (api ? api.firmAnalytics(30) : Promise.reject(new Error('no api'))), [api])
  const a = usePolled<FirmAnalytics>(api ? read : null, POLL_MS)
  const d = a.data
  if (!d) {
    return a.failed
      ? <Notice title="The firm's analytics couldn't be read just now." body="Nothing has changed; this view keeps retrying." />
      : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Skeleton className="h-[84px]" /><Skeleton className="h-[84px]" /><Skeleton className="h-[84px]" /><Skeleton className="h-[84px]" /></div>
  }
  const cells: { label: string; value: number; note: string }[] = [
    { label: 'Documents read', value: d.documentsRead, note: 'Documents the firm read in the last 30 days.' },
    { label: 'Sections drafted', value: d.sectionsDrafted, note: 'Petition sections drafted or redrafted in the last 30 days.' },
    { label: 'Decisions answered', value: d.decisionsAnswered, note: 'Questions the attorneys answered in the last 30 days.' },
    { label: 'Turns on its own', value: d.wakeTurns, note: 'Turns the counsel took without a message: wakes and schedules, from the usage ledger.' },
    { label: 'Facts on file', value: d.factsOnFile, note: 'Every fact on every matter, right now.' },
    { label: 'Claims on file', value: d.claimsOnFile, note: 'Every legal claim in every case map, right now.' },
    { label: 'Client messages', value: d.clientMessages, note: 'Messages between the firm and its clients in the last 30 days.' },
    { label: 'Matters', value: d.matters, note: 'Every matter in the firm.' },
  ]
  const W = 360, H = 110, PAD = 4
  const days = d.byDay
  const maxDay = Math.max(1, ...days.map((x) => x.documentsRead + x.sectionsDrafted + x.decisionsAnswered))
  const barW = days.length > 0 ? (W - PAD * 2) / days.length : W
  return (
    <div className="space-y-4">
      {a.failed && <Notice tone="stale" title="Not updating right now — showing the last view that loaded." />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl border border-kumo-line bg-kumo-base px-4 py-3" title={c.note}>
            <p className="m-0 text-[10.5px] leading-4 font-semibold uppercase tracking-[0.8px] text-kumo-subtle">{c.label}</p>
            <p className="m-0 mt-1 text-[22px] leading-7 font-semibold tracking-[-0.4px] text-kumo-default" style={{ fontVariantNumeric: 'tabular-nums' }}>{c.value}</p>
          </div>
        ))}
      </div>
      <section className="rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
        <p className="m-0 text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">The work by day, last 30 days</p>
        <p className="m-0 mt-0.5 text-[12.5px] leading-4 text-kumo-subtle">Documents read, sections drafted and decisions answered, stacked. Counted from each matter's activity trail.</p>
        {days.length === 0 ? (
          <p className="m-0 mt-6 text-[13px] leading-[18px] text-kumo-subtle">No activity recorded yet.</p>
        ) : (
          <svg viewBox={`0 0 ${W} ${H + 18}`} className="mt-3 w-full" role="img" aria-label="Work per day">
            {days.map((x, i) => {
              const total = x.documentsRead + x.sectionsDrafted + x.decisionsAnswered
              const h = (total / maxDay) * H
              const hDocs = (x.documentsRead / maxDay) * H
              const hSections = (x.sectionsDrafted / maxDay) * H
              const left = PAD + i * barW + 1
              const w = Math.max(1, barW - 2)
              return (
                <g key={x.day}>
                  <title>{`${x.day}: ${plural(x.documentsRead, 'document', 'documents')} read, ${plural(x.sectionsDrafted, 'section', 'sections')} drafted, ${plural(x.decisionsAnswered, 'decision', 'decisions')} answered`}</title>
                  <rect x={left} y={H - hDocs} width={w} height={Math.max(hDocs, 0)} className="fill-kumo-brand" />
                  <rect x={left} y={H - hDocs - hSections} width={w} height={Math.max(hSections, 0)} className="fill-kumo-brand/60" />
                  <rect x={left} y={H - h} width={w} height={Math.max(h - hDocs - hSections, 0)} className="fill-kumo-brand/30" />
                </g>
              )
            })}
            <text x={PAD} y={H + 13} className="fill-kumo-subtle" fontSize="9.5">{days[0].day.slice(5)}</text>
            <text x={W - PAD} y={H + 13} textAnchor="end" className="fill-kumo-subtle" fontSize="9.5">{days[days.length - 1].day.slice(5)}</text>
          </svg>
        )}
      </section>
    </div>
  )
}

// ── Platform: the deployment's own settings ────────────────────────────────────────────────────

const MODE_LABEL: Record<AmbientGatekeeperMode, string> = {
  disabled: 'Off for everyone',
  optional: 'Each member may add it',
  enabled: 'In every conversation',
}

/**
 * The parts of the platform's admin page a firm admin needs, in the firm's language. Everything
 * else (formats, blueprints, banners, logo) stays on the platform page, linked below.
 */
function PlatformDrawer({ api }: { api: RpcStub<AdminApi> | null }) {
  const read = useCallback(() => (api ? api.getSettings() : Promise.reject(new Error('no api'))), [api])
  const settings = usePolled<AdminSettingsView>(api ? read : null, 60_000)
  const s = settings.data
  const [siteName, setSiteName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [seeded, setSeeded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ key: string; text: string } | null>(null)
  useEffect(() => {
    if (s && !seeded) { setSiteName(s.siteName); setInstructions(s.instanceInstructions); setSeeded(true) }
  }, [s, seeded])

  const run = async (key: string, work: () => Promise<void>, done: string) => {
    if (!api || busy) return
    setBusy(key)
    setNote(null)
    try {
      await work()
      setNote({ key, text: done })
      settings.refresh()
    } catch (err) {
      logRpcFailure(`Failed to save ${key}:`, err)
      setNote({ key, text: `That didn't save: ${err instanceof Error ? err.message : 'try again'}.` })
    } finally {
      setBusy(null)
    }
  }

  if (!s) {
    return settings.failed
      ? <Notice title="The deployment's settings couldn't be read just now." body="Nothing has changed; this view keeps retrying." />
      : <div className="space-y-3"><Skeleton className="h-[96px]" /><Skeleton className="h-[160px]" /><Skeleton className="h-[120px]" /></div>
  }

  return (
    <div className="space-y-4">
      {settings.failed && <Notice tone="stale" title="Not updating right now — showing the last view that loaded." />}

      <section className="rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
        <p className="m-0 text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">The door</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 max-w-[560px] text-[13px] leading-[18px] text-kumo-subtle">
            {s.signupsEnabled
              ? 'Anyone who reaches the sign-in page can create an account. For a firm, keep this closed and invite by email under The team.'
              : 'Closed. Accounts are created only from an invitation sent under The team.'}
          </p>
          <WorkshopButton className="!h-8" disabled={!api || busy !== null} onClick={() => void run('door', () => api!.setSignupsEnabled(!s.signupsEnabled), s.signupsEnabled ? 'The door is closed. Invitations only.' : 'The door is open.')}>
            {busy === 'door' ? 'Working…' : s.signupsEnabled ? 'Close the door' : 'Open the door'}
          </WorkshopButton>
        </div>
        {note?.key === 'door' && <p className="m-0 mt-2 text-[12.5px] leading-4 text-kumo-subtle">{note.text}</p>}
      </section>

      <section className="rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
        <FieldLabel hint="Shown next to the mark on every screen. Blank means Legal OS.">The firm's name on the screen</FieldLabel>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <WorkshopInput value={siteName} onChange={(e) => setSiteName(e.target.value)} className="w-72" disabled={busy !== null} placeholder="Legal OS" maxLength={80} />
          <WorkshopButton className="!h-8" disabled={!api || busy !== null || siteName === s.siteName} onClick={() => void run('name', () => api!.setSiteName(siteName.trim()), 'Saved. Members see it on their next connection.')}>
            {busy === 'name' ? 'Working…' : 'Save'}
          </WorkshopButton>
        </div>
        {note?.key === 'name' && <p className="m-0 mt-2 text-[12.5px] leading-4 text-kumo-subtle">{note.text}</p>}
      </section>

      <section className="rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
        <FieldLabel hint="The counsel reads this on every conversation, before the playbook. Plain legal English; how this firm practices.">The counsel's standing instructions</FieldLabel>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={10}
          disabled={busy !== null}
          className="mt-2 w-full resize-y rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 font-mono text-[12.5px] leading-[18px] text-kumo-default outline-none focus:border-kumo-ring"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <WorkshopButton className="!h-8" disabled={!api || busy !== null || instructions === s.instanceInstructions} onClick={() => void run('instructions', () => api!.setInstanceInstructions(instructions), 'Saved. The counsel reads it from its next turn.')}>
            {busy === 'instructions' ? 'Working…' : 'Save the instructions'}
          </WorkshopButton>
          {note?.key === 'instructions' && <span className="text-[12.5px] leading-4 text-kumo-subtle">{note.text}</span>}
        </div>
      </section>

      <section className="rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
        <p className="m-0 text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">What every conversation carries</p>
        <p className="m-0 mt-0.5 text-[12.5px] leading-4 text-kumo-subtle">The firm's capabilities. Matters and The firm belong in every conversation; the rest is the members' choice.</p>
        <ul className="m-0 mt-3 list-none divide-y divide-kumo-line p-0">
          {s.resourceVendors.map((v) => (
            <li key={v.vendorId} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="text-[13.5px] leading-5 text-kumo-default">{v.displayName}</span>
              {v.autoProvisions ? (
                <select
                  value={v.ambientMode}
                  disabled={!api || busy !== null}
                  onChange={(e) => void run(v.vendorId, () => api!.setGatekeeperMode(v.vendorId, e.target.value as AmbientGatekeeperMode), `${v.displayName}: ${MODE_LABEL[e.target.value as AmbientGatekeeperMode].toLowerCase()}.`)}
                  className="h-8 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[13px] text-kumo-default"
                >
                  {(Object.keys(MODE_LABEL) as AmbientGatekeeperMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                </select>
              ) : (
                <WorkshopButton className="!h-8" disabled={!api || busy !== null} onClick={() => void run(v.vendorId, () => api!.setGatekeeperMode(v.vendorId, v.enabled ? 'disabled' : 'enabled'), `${v.displayName} is ${v.enabled ? 'off' : 'available'}.`)}>
                  {busy === v.vendorId ? 'Working…' : v.enabled ? 'Turn off' : 'Make available'}
                </WorkshopButton>
              )}
              {note?.key === v.vendorId && <span className="basis-full text-[12.5px] leading-4 text-kumo-subtle">{note.text}</span>}
            </li>
          ))}
        </ul>
      </section>

      <p className="m-0 text-[12.5px] leading-[18px] text-kumo-subtle">
        Output formats, the logo, banners and the rest of the platform live on the <Link to="/admin" className="text-kumo-default underline underline-offset-2">platform page</Link>.
      </p>
    </div>
  )
}
