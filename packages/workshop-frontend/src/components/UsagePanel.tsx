// Legal OS: the firm's usage. What the models cost and who spent it, plus per-member monthly
// ceilings that pause automated work (never chat) at the limit.

import { useEffect, useState, type FormEvent } from 'react'
import { RpcStub } from 'capnweb'
import { Button, Input, useKumoToastManager } from '@cloudflare/kumo'
import { AdminApi, UsageSummary } from '@gadgets/workshop-shared/api'

const RANGES = [7, 30, 90] as const

function dollars(n: number): string {
  return n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`
}

function tokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n)
}

export default function UsagePanel({ api }: { api: RpcStub<AdminApi> }) {
  const toasts = useKumoToastManager()
  const [days, setDays] = useState<number>(30)
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [limitUser, setLimitUser] = useState('')
  const [limitDollars, setLimitDollars] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const [s, l] = await Promise.all([api.getUsageSummary(days), api.getUserMonthlyLimits()])
      setSummary(s); setLimits(l); setFailed(false)
    } catch {
      setFailed(true)
    }
  }
  useEffect(() => { load().catch(() => {}) }, [api, days])

  const saveLimit = async (e: FormEvent) => {
    e.preventDefault()
    if (!limitUser.trim() || busy) return
    setBusy(true)
    try {
      await api.setUserMonthlyLimit(limitUser.trim(), Number(limitDollars) || 0)
      setLimitUser(''); setLimitDollars('')
      await load()
      toasts.add({ title: 'Allowance saved' })
    } catch (err) {
      toasts.add({ title: 'Could not save the allowance', description: err instanceof Error ? err.message : String(err), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const maxDay = Math.max(0.0001, ...(summary?.byDay.map((d) => d.cost) ?? [0]))

  return (
    <div className="space-y-4">
      <div className="bg-kumo-elevated border border-kumo-line rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-kumo-strong mb-1">What the firm spent</h2>
            <p className="text-sm text-kumo-subtle">Model usage across every member, from the usage ledger. Dollars are the provider's price for the turn.</p>
          </div>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Button key={r} variant={r === days ? 'primary' : 'secondary'} onClick={() => setDays(r)}>{r} days</Button>
            ))}
          </div>
        </div>

        {failed && !summary && (
          <p className="mt-5 text-sm text-kumo-subtle">The ledger couldn't be read just now. Nothing has changed; it keeps retrying.</p>
        )}
        {failed && summary && (
          <p className="mt-2 text-xs text-kumo-subtle italic">Not updating right now, showing the last view that loaded.</p>
        )}
        {summary && summary.turns === 0 && (
          <p className="mt-5 text-sm text-kumo-subtle">No model turns in the last {summary.days} days.</p>
        )}
        {summary && summary.turns > 0 && (
          <>
            <div className="mt-5 grid grid-cols-3 gap-4 text-sm">
              <div><div className="text-xs uppercase tracking-wide text-kumo-subtle">Spend</div><div className="text-xl font-semibold tabular-nums text-kumo-strong">{dollars(summary.cost)}</div></div>
              <div><div className="text-xs uppercase tracking-wide text-kumo-subtle">Turns</div><div className="text-xl font-semibold tabular-nums text-kumo-strong">{summary.turns}</div></div>
              <div><div className="text-xs uppercase tracking-wide text-kumo-subtle">Tokens</div><div className="text-xl font-semibold tabular-nums text-kumo-strong">{tokens(summary.tokens)}</div></div>
            </div>
            <div className="mt-5 flex items-end gap-[3px] h-16" aria-label="Spend per day">
              {summary.byDay.map((d) => (
                <div key={d.day} title={`${d.day}: ${dollars(d.cost)}, ${d.turns} turns`}
                     className="flex-1 rounded-sm bg-kumo-brand/70" style={{ height: `${Math.max(2, (d.cost / maxDay) * 100)}%` }} />
              ))}
            </div>
            <table className="mt-5 w-full text-sm">
              <thead className="text-left text-kumo-subtle">
                <tr><th className="py-1 pr-3 font-medium">Member</th><th className="py-1 pr-3 font-medium text-right">Spend</th><th className="py-1 pr-3 font-medium text-right">Turns</th><th className="py-1 pr-3 font-medium text-right">Automated</th><th className="py-1 pr-3 font-medium text-right">Tokens</th><th className="py-1 font-medium text-right">Allowance</th></tr>
              </thead>
              <tbody>
                {summary.byUser.map((u) => (
                  <tr key={u.userId} className="border-t border-kumo-line">
                    <td className="py-2 pr-3 text-kumo-default">{u.userId}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{dollars(u.cost)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{u.turns}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{u.automatedTurns}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{tokens(u.tokens)}</td>
                    <td className="py-2 text-right tabular-nums text-kumo-subtle">{limits[u.userId] ? dollars(limits[u.userId]) + ' / month' : 'no ceiling'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summary.byModel.length > 0 && (
              <p className="mt-4 text-xs text-kumo-subtle">
                By model: {summary.byModel.map((m) => `${m.modelId} ${dollars(m.cost)}`).join(' · ')}
              </p>
            )}
          </>
        )}
      </div>

      <div className="bg-kumo-elevated border border-kumo-line rounded-xl p-6">
        <h2 className="text-lg font-semibold text-kumo-strong mb-1">Monthly allowance</h2>
        <p className="text-sm text-kumo-subtle mb-5">
          A ceiling in dollars per calendar month. At the ceiling the firm pauses a member's automated work; their chat keeps working. Blank or 0 removes the ceiling.
        </p>
        <form onSubmit={saveLimit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input className="flex-1" label="Member username" value={limitUser} placeholder="username" onChange={(e) => setLimitUser(e.target.value)} disabled={busy} />
          <Input className="sm:w-40" label="Dollars per month" type="number" value={limitDollars} placeholder="200" onChange={(e) => setLimitDollars(e.target.value)} disabled={busy} />
          <Button type="submit" variant="primary" loading={busy} disabled={!limitUser.trim() || busy}>Save allowance</Button>
        </form>
        {Object.keys(limits).length > 0 && (
          <ul className="mt-4 text-sm text-kumo-default">
            {Object.entries(limits).map(([user, d]) => (
              <li key={user} className="flex justify-between border-t border-kumo-line py-1.5"><span>{user}</span><span className="tabular-nums">{dollars(d)} / month</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
