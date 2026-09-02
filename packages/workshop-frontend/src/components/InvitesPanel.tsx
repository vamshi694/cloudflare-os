// Legal OS: the admin's invitation desk. Mint an invite for an email, hand the link over (it is
// shown here whether or not the deployment can email it), and see every invite's state.

import { useEffect, useState, type FormEvent } from 'react'
import { RpcStub } from 'capnweb'
import { Button, Input, Select, useKumoToastManager } from '@cloudflare/kumo'
import { AdminApi, Invite } from '@gadgets/workshop-shared/api'

function inviteState(inv: Invite): string {
  if (inv.usedAt) return `joined as ${inv.usedBy}`
  if (inv.revoked) return 'revoked'
  if (inv.expiresAt <= new Date().toISOString()) return 'expired'
  return `open until ${inv.expiresAt.slice(0, 10)}`
}

export default function InvitesPanel({ api }: { api: RpcStub<AdminApi> }) {
  const toasts = useKumoToastManager()
  const [invites, setInvites] = useState<Invite[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Invite['role']>('practitioner')
  const [busy, setBusy] = useState(false)
  const [lastLink, setLastLink] = useState<string | null>(null)

  const reload = async () => setInvites(await api.listInvites())
  useEffect(() => { reload().catch(() => {}) }, [api])

  const linkFor = (token: string) => `${window.location.origin}/signup?invite=${token}`

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    try {
      const inv = await api.createInvite(email.trim(), role)
      setLastLink(linkFor(inv.token))
      setEmail('')
      await reload()
      toasts.add({ title: 'Invitation created', description: 'Copy the link and send it to them.' })
    } catch (err) {
      toasts.add({ title: 'Could not create the invitation', description: err instanceof Error ? err.message : String(err), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async (token: string) => {
    try {
      await api.revokeInvite(token)
      await reload()
    } catch (err) {
      toasts.add({ title: 'Could not revoke', description: err instanceof Error ? err.message : String(err), variant: 'error' })
    }
  }

  return (
    <div className="bg-kumo-elevated border border-kumo-line rounded-xl p-6 mt-4">
      <h2 className="text-lg font-semibold text-kumo-strong mb-1">Invite a member of the firm</h2>
      <p className="text-sm text-kumo-subtle mb-5">
        Accounts on this firm are created by invitation. The link works once and expires in 30 days;
        inviting the same email again replaces the older link.
      </p>

      <form onSubmit={handleCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input className="flex-1" label="Email" type="email" value={email} placeholder="associate@firm.com"
               onChange={(e) => setEmail(e.target.value)} disabled={busy} />
        <Select label="Role" className="sm:w-44" value={role} onValueChange={(v) => setRole(v as Invite['role'])} disabled={busy}>
          <Select.Option value="practitioner">Practitioner</Select.Option>
          <Select.Option value="admin">Admin</Select.Option>
        </Select>
        <Button type="submit" variant="primary" loading={busy} disabled={!email.trim() || busy}>Create invitation</Button>
      </form>

      {lastLink && (
        <div className="mt-4 rounded-lg border border-kumo-line bg-kumo-base p-3 text-sm">
          <div className="text-kumo-subtle mb-1">Send this link to the invitee:</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all text-kumo-default">{lastLink}</code>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(lastLink).catch(() => {})}>Copy</Button>
          </div>
        </div>
      )}

      {invites.length > 0 && (
        <table className="mt-5 w-full text-sm">
          <thead className="text-left text-kumo-subtle">
            <tr><th className="py-1 pr-3 font-medium">Email</th><th className="py-1 pr-3 font-medium">Role</th><th className="py-1 pr-3 font-medium">State</th><th /></tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.token} className="border-t border-kumo-line">
                <td className="py-2 pr-3 text-kumo-default">{inv.email}</td>
                <td className="py-2 pr-3 text-kumo-default">{inv.role}</td>
                <td className="py-2 pr-3 text-kumo-subtle">{inviteState(inv)}</td>
                <td className="py-2 text-right">
                  {!inv.usedAt && !inv.revoked && (
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => navigator.clipboard.writeText(linkFor(inv.token)).catch(() => {})}>Copy link</Button>
                      <Button variant="secondary" onClick={() => handleRevoke(inv.token)}>Revoke</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
