import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { RpcStub } from 'capnweb'
import { Buildings, ChartBar, UsersThree } from '@phosphor-icons/react'
import type { AdminApi, AuthenticatedApi, FirmMember, Invite, UsageSummary } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../AuthContext'
import { useDocumentTitle } from '../useDocumentTitle'
import { logRpcFailure } from '../rpcErrors'
import { WorkshopButton, WorkshopInput } from '../components/WorkshopControls'
import { useDesk, usePolled } from '../components/firm/useDesk'
import { EmptyLine, Eyebrow, FieldLabel, Notice, Pill, RadioRow, SegmentedTabs, Skeleton, ThreeState, formatDate, plural, relativeTime } from '../components/legal/primitives'

type Tab = 'team' | 'forms' | 'spend'

export const Route = createFileRoute('/team')({
  component: TeamPage,
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: search.tab === 'spend' || search.tab === 'forms' ? search.tab : undefined,
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
  forms: 'The official government forms every matter of a visa type files. The Workspace and the firm’s counsel prepare from exactly this set.',
  spend: 'What the OS cost and what it did — credits and tokens by day, the work itself by kind.',
}

/**
 * THE FIRM screen — the firm runs itself, one desk with three drawers: THE TEAM (who practices
 * here — invite, roles, allowances), the GOVERNMENT FORMS the firm files per visa, and SPEND
 * (credits, tokens, what the OS did). The server enforces every rule; this screen only renders
 * what the API allows and repeats its plain-language refusals.
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
              { key: 'forms', label: 'Government forms', icon: <Buildings size={14} /> },
              { key: 'spend', label: 'Spend', icon: <ChartBar size={14} /> },
            ]}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 pb-10">
        {admin.kind === 'failed' || admin.kind === 'disabled' ? (
          <Notice title="The firm's desk couldn't be opened." body="Nothing has changed. Reload to try again." />
        ) : tab === 'team' ? (
          <TeamDrawer api={api} />
        ) : tab === 'forms' ? (
          <EmptyLine
            title="The firm's form set isn't managed here yet"
            body="Each matter's Workspace lists the government forms its visa type files, prepared from the evidence. A firm-wide form library lands here in a later release."
          />
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
  const members = usePolled<FirmMember[]>(api ? readMembers : null, POLL_MS)
  const invites = usePolled<Invite[]>(api ? readInvites : null, POLL_MS)
  const limits = usePolled<Record<string, number>>(api ? readLimits : null, POLL_MS)

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
function MemberCard({ member, self, limit, api, onChanged }: {
  member: FirmMember; self: boolean; limit: number; api: RpcStub<AdminApi> | null; onChanged: () => void
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
        <Metric label="Matters" value="—" note={NOT_TRACKED} />
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
