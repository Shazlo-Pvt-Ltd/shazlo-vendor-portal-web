import { useEffect, useRef, useState, type FormEvent } from 'react'
import Popover from '@mui/material/Popover'
import { styled } from '@mui/material/styles'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Avatar, Button, Checkbox, Content, Dialog, EmptyState, focusRing, Icon, IconButton, kit, PageHeader, Skeleton, StatusBadge, Table, TableFrame,
  Text, TextInput, textStyle, useToast, type BadgeTone, type IconName,
} from '@shazlo/ui/components'
import { isLastSuperAdmin, ShellApiError, shellApi, type Admin, type Role } from '../api/mock'
import { useSession } from '../app/session'
import { TopBar } from '../app/topbar'

/** Roles and the services each can get tokens for (ADR 0009 audience map). */
export const ROLE_INFO: Array<{ role: Role; description: string; tokens: string }> = [
  { role: 'super_admin', description: 'Manages admins and roles. Passes every role check in every service.', tokens: 'every service' },
  { role: 'vendor_reviewer', description: 'Reviews vendor applications, brand pages and products in the Vendors module.', tokens: 'vendor-api, identity-api' },
]

const statusBadge: Record<Admin['status'], { tone: BadgeTone; label: string; icon?: IconName }> = {
  active: { tone: 'approved', label: 'Active' },
  invited: { tone: 'pending', label: 'Invite sent' },
  deactivated: { tone: 'suspended', label: 'Deactivated' },
}

const SESSION_RULES = [
  'Access tokens last 15 minutes',
  'Refresh tokens last 7 days and rotate on every use',
  'Every session ends 30 days after sign-in',
  'Deactivating someone ends all their sessions at once',
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LAST_SUPER = 'You can’t deactivate the last super_admin. Make someone else super_admin first.'

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

export function formatLastSignIn(iso: string | undefined, now = new Date()) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (now.getTime() - d.getTime() < 5 * 60_000) return 'Now'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  if (d >= startOfToday) return `Today, ${timeFmt.format(d)}`
  if (d.getTime() >= startOfToday.getTime() - 86_400_000) return `Yesterday, ${timeFmt.format(d)}`
  return dayFmt.format(d)
}

type Pending =
  | { kind: 'deactivate' | 'reactivate' | 'reset' | 'roles'; admin: Admin }
  | null

/** A-11 · Admins & roles (super_admin only). */
export function Admins() {
  const { session } = useSession()
  const qc = useQueryClient()
  const { show } = useToast()
  const admins = useQuery({ queryKey: ['admins'], queryFn: shellApi.listAdmins })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [menu, setMenu] = useState<{ anchor: HTMLElement; admin: Admin } | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => { document.title = 'Admins & roles · Shazlo One' }, [])

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof shellApi.updateAdmin>[1] }) => shellApi.updateAdmin(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admins'] }),
  })
  const reset = useMutation({ mutationFn: (id: string) => shellApi.resetPassword(id) })

  const list = admins.data ?? []
  const people = list.length

  const resendInvite = pending?.admin.status === 'invited'
  const closeDialog = () => { setPending(null); setActionError(null) }

  const confirm = async () => {
    if (!pending) return
    const { admin, kind } = pending
    try {
      if (kind === 'deactivate') {
        await update.mutateAsync({ id: admin.id, patch: { status: 'deactivated' } })
        show(`${admin.name} is deactivated and signed out everywhere`)
      } else if (kind === 'reactivate') {
        await update.mutateAsync({ id: admin.id, patch: { status: admin.lastSignInAt ? 'active' : 'invited' } })
        show(`${admin.name} can sign in again`)
      } else if (kind === 'reset') {
        await reset.mutateAsync(admin.id)
        show(admin.status === 'invited' ? `Invite link sent again to ${admin.email}` : `Set-password link sent to ${admin.email}`)
      }
      closeDialog()
    } catch (err) {
      setActionError(err instanceof ShellApiError ? err.message : 'That didn’t work. Try again.')
    }
  }

  return (
    <Content>
      <TopBar crumbs={[{ label: 'Administration' }, { label: 'Admins & roles' }]} />
      <PageHeader
        title="Admins & roles"
        subtitle={admins.data ? `${people} ${people === 1 ? 'person' : 'people'} · roles decide which modules each person sees and what they can do` : 'Roles decide which modules each person sees and what they can do'}
        actions={<Button variant="primary" icon="plus" onClick={() => setInviteOpen(true)}>Invite admin</Button>}
      />

      <div className="shz-admins-row" style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <TableFrame>
            <Table style={{ minWidth: 640 }} aria-label="Admins">
              <colgroup>
                <col />
                <col style={{ width: 216 }} />
                <col style={{ width: 126 }} />
                <col style={{ width: 136 }} />
                <col style={{ width: 44 }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Admin</th>
                  <th scope="col">Roles</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">Status</th>
                  <th scope="col" style={{ position: 'relative' }}><span className="shz-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {admins.isPending && [0, 1, 2, 3, 4].map(i => (
                  <tr key={i}>
                    <td><span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Skeleton width={28} height={28} radius={999} /><span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><Skeleton width={90} height={14} /><Skeleton width={120} height={12} /></span></span></td>
                    <td><Skeleton width={110} height={19} /></td>
                    <td><Skeleton width={70} height={14} /></td>
                    <td><Skeleton width={64} height={19} radius={999} /></td>
                    <td />
                  </tr>
                ))}
                {admins.data?.map(a => {
                  const badge = statusBadge[a.status]
                  const isMe = a.id === session?.admin.id
                  return (
                    <tr key={a.id}>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <Avatar initials={a.initials} />
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <Text v="label" truncate>{a.name}{isMe && <Text v="caption" tone="subtle"> (you)</Text>}</Text>
                            <Text v="caption" tone="subtle" truncate>{a.email}</Text>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {a.roles.map(r => <RoleChip key={r} role={r} />)}
                        </span>
                      </td>
                      <td><Text v="small" tone="muted">{formatLastSignIn(a.lastSignInAt)}</Text></td>
                      <td><StatusBadge tone={badge.tone} icon={badge.icon}>{badge.label}</StatusBadge></td>
                      <td>
                        <IconButton aria-label={`Actions for ${a.name}`} aria-haspopup="menu" onClick={e => setMenu({ anchor: e.currentTarget, admin: a })} style={{ margin: '-8px -6px' }}>
                          <Icon name="more" size={16} />
                        </IconButton>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            {admins.isError && (
              <EmptyState icon="alert" title="Admins didn’t load" action={<Button icon="refresh" onClick={() => void admins.refetch()}>Try again</Button>}>
                identity-api didn’t answer. Check your connection and try again.
              </EmptyState>
            )}
          </TableFrame>
        </div>

        <aside className="shz-admins-side" style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section aria-labelledby="roles-title" style={{ background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: 8, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Text v="title" as="h2" id="roles-title">Roles</Text>
            {ROLE_INFO.map(r => (
              <div key={r.role} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                <RoleChip role={r.role} />
                <Text v="small" as="p" style={{ lineHeight: '16px' }}>{r.description}</Text>
                <Text v="caption" tone="subtle" as="p">Tokens for: {r.tokens}</Text>
              </div>
            ))}
            <Text v="caption" tone="subtle" as="p" style={{ lineHeight: '14.5px' }}>A new service adds its own roles, named &lt;area&gt;_&lt;role&gt;, and they appear here.</Text>
          </section>
          <section aria-labelledby="sessions-title" style={{ background: kit.chip, borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Text v="label" as="h2" id="sessions-title">Sessions</Text>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SESSION_RULES.map(rule => (
                <li key={rule} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Icon name="shield" size={14} color={kit.muted} style={{ flexShrink: 0, marginTop: 1 }} />
                  <Text v="small" tone="muted" style={{ lineHeight: '16px' }}>{rule}</Text>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
      <style>{'@media (max-width: 1100px) { .shz-admins-row { flex-direction: column; align-items: stretch !important; } .shz-admins-row > * { width: 100% !important; flex: none !important; } }'}</style>

      <ActionMenu
        menu={menu}
        all={list}
        meId={session?.admin.id}
        onClose={() => setMenu(null)}
        onPick={(kind, admin) => { setMenu(null); setActionError(null); setPending({ kind, admin }) }}
      />

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      {pending?.kind === 'roles' && <RolesDialog admin={pending.admin} all={list} onClose={closeDialog} />}

      <Dialog
        open={pending !== null && pending.kind !== 'roles'}
        onClose={closeDialog}
        icon={pending?.kind === 'deactivate' ? 'ban' : pending?.kind === 'reset' ? (resendInvite ? 'send' : 'lock') : 'check'}
        title={pending?.kind === 'deactivate'
          ? `Deactivate ${pending.admin.name}?`
          : pending?.kind === 'reset'
            ? (resendInvite ? `Resend the invite to ${pending.admin.name}?` : `Reset ${pending.admin.name}’s password?`)
            : `Reactivate ${pending?.admin.name ?? ''}?`}
        description={
          pending?.kind === 'deactivate'
            ? 'This ends all their sessions at once and they can’t sign in again until reactivated. Access tokens already issued stop working within 15 minutes.'
            : pending?.kind === 'reset'
              ? resendInvite
                ? `We’ll email ${pending.admin.email} a new set-password link. The old link stops working.`
                : `We’ll email ${pending.admin.email} a set-password link and end their sessions. Their current password stops working now.`
              : 'They can sign in again with their current password and get the same roles as before.'
        }
        actions={
          <>
            <Button onClick={closeDialog}>Cancel</Button>
            <Button
              variant={pending?.kind === 'deactivate' ? 'danger' : 'primary'}
              onClick={() => void confirm()}
              disabled={update.isPending || reset.isPending}
            >
              {pending?.kind === 'deactivate' ? 'Deactivate' : pending?.kind === 'reset' ? (resendInvite ? 'Resend invite' : 'Send reset link') : 'Reactivate'}
            </Button>
          </>
        }
      >
        {actionError && <InlineError>{actionError}</InlineError>}
      </Dialog>
    </Content>
  )
}

function RoleChip({ role }: { role: Role }) {
  return <Text v="mono" style={{ background: kit.chip, borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap', display: 'inline-block' }}>{role}</Text>
}

function InlineError({ children }: { children: string }) {
  return (
    <div role="alert" style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 6, background: kit.chip, alignItems: 'flex-start' }}>
      <Icon name="alert" size={16} color={kit.ink} style={{ flexShrink: 0 }} />
      <Text v="small" as="p" style={{ lineHeight: '16px' }}>{children}</Text>
    </div>
  )
}

/* ---------- Row action menu ---------- */

const MenuItem = styled('button')({
  ...textStyle.small,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '8px 12px',
  minHeight: 36,
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  color: kit.ink,
  textAlign: 'left',
  cursor: 'pointer',
  '&:hover:not(:disabled), &:focus-visible': { background: 'rgba(255, 237, 163, 0.45)' },
  '&:disabled': { color: kit.subtle, cursor: 'not-allowed' },
  ...focusRing,
})

function ActionMenu({ menu, all, meId, onClose, onPick }: {
  menu: { anchor: HTMLElement; admin: Admin } | null
  all: Admin[]
  meId?: string
  onClose: () => void
  onPick: (kind: NonNullable<Pending>['kind'], admin: Admin) => void
}) {
  const admin = menu?.admin
  const last = admin ? isLastSuperAdmin(all, admin) : false
  const isMe = admin?.id === meId
  const deactivateReason = last ? LAST_SUPER : isMe ? 'You can’t deactivate yourself. Ask another super_admin.' : null
  return (
    <Popover
      open={Boolean(menu)}
      anchorEl={menu?.anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { mt: 0.5, width: 260, background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: '8px', boxShadow: '0 12px 32px rgba(23, 18, 14, 0.14)' } } }}
    >
      {admin && (
        <div role="menu" aria-label={`Actions for ${admin.name}`} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 6 }}>
          <MenuItem role="menuitem" onClick={() => onPick('roles', admin)}><Icon name="shield" size={16} color={kit.muted} />Edit roles</MenuItem>
          {admin.status !== 'deactivated' && (
            <MenuItem role="menuitem" onClick={() => onPick('reset', admin)}>
              <Icon name={admin.status === 'invited' ? 'send' : 'lock'} size={16} color={kit.muted} />
              {admin.status === 'invited' ? 'Resend invite link' : 'Reset password'}
            </MenuItem>
          )}
          {admin.status === 'deactivated' ? (
            <MenuItem role="menuitem" onClick={() => onPick('reactivate', admin)}><Icon name="check" size={16} color={kit.muted} />Reactivate</MenuItem>
          ) : (
            <>
              <MenuItem
                role="menuitem"
                disabled={Boolean(deactivateReason)}
                aria-describedby={deactivateReason ? 'deactivate-reason' : undefined}
                onClick={() => onPick('deactivate', admin)}
                style={{ color: deactivateReason ? undefined : '#8F3504' }}
              >
                <Icon name="ban" size={16} />Deactivate
              </MenuItem>
              {deactivateReason && <Text v="caption" tone="subtle" as="p" id="deactivate-reason" style={{ padding: '0 12px 6px 38px' }}>{deactivateReason}</Text>}
            </>
          )}
        </div>
      )}
    </Popover>
  )
}

/* ---------- Invite ---------- */

function RoleChoices({ value, onChange, disabled, error }: { value: Role[]; onChange: (r: Role[]) => void; disabled?: Partial<Record<Role, string>>; error?: string }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }} aria-describedby={error ? 'roles-error' : undefined}>
      <legend style={{ ...textStyle.label, color: kit.ink, padding: 0, marginBottom: 6 }}>Roles</legend>
      {ROLE_INFO.map(r => {
        const reason = disabled?.[r.role]
        return (
          <div key={r.role} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Checkbox
              label={<Text v="mono">{r.role}</Text>}
              checked={value.includes(r.role)}
              disabled={Boolean(reason)}
              onChange={e => onChange(e.target.checked ? [...value, r.role] : value.filter(x => x !== r.role))}
            />
            <Text v="caption" tone="subtle" as="p" style={{ paddingLeft: 24 }}>{reason ?? r.description}</Text>
          </div>
        )
      })}
      {error && (
        <span id="roles-error" style={{ display: 'flex', alignItems: 'center', gap: 4, ...textStyle.caption, color: kit.error }}>
          <Icon name="alert" size={12} strokeWidth={1.75} />{error}
        </span>
      )}
    </fieldset>
  )
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<Role[]>(['vendor_reviewer'])
  const [errors, setErrors] = useState<{ name?: string; email?: string; roles?: string }>({})
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const invite = useMutation({
    mutationFn: shellApi.inviteAdmin,
    onSuccess: a => {
      void qc.invalidateQueries({ queryKey: ['admins'] })
      show(`Invite sent to ${a.email}`)
      close()
    },
    onError: err => {
      if (err instanceof ShellApiError && err.code === 'duplicate_email') {
        setErrors({ email: 'An admin with this email already exists.' })
        emailRef.current?.focus()
      } else setErrors({ roles: 'The invite didn’t send. Try again.' })
    },
  })

  const close = () => {
    setName(''); setEmail(''); setRoles(['vendor_reviewer']); setErrors({}); invite.reset()
    onClose()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!name.trim()) next.name = 'Enter their full name.'
    if (!email.trim()) next.email = 'Enter their work email.'
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter an email like name@shazlo.store.'
    if (roles.length === 0) next.roles = 'Choose at least one role.'
    setErrors(next)
    if (next.name) { nameRef.current?.focus(); return }
    if (next.email) { emailRef.current?.focus(); return }
    if (next.roles) return
    invite.mutate({ name, email, roles })
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Invite admin"
      description="We’ll email a set-password link. There is no self sign-up; only a super_admin can add people."
      width={480}
    >
      <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TextInput ref={nameRef} label="Full name" autoComplete="off" value={name} error={errors.name} onChange={e => setName(e.target.value)} />
        <TextInput ref={emailRef} label="Work email" type="email" autoComplete="off" value={email} error={errors.email} onChange={e => setEmail(e.target.value)} />
        <RoleChoices value={roles} onChange={r => { setRoles(r); setErrors(x => ({ ...x, roles: undefined })) }} error={errors.roles} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" icon="send" disabled={invite.isPending}>{invite.isPending ? 'Sending…' : 'Send invite'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/* ---------- Edit roles ---------- */

function RolesDialog({ admin, all, onClose }: { admin: Admin; all: Admin[]; onClose: () => void }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [roles, setRoles] = useState<Role[]>(admin.roles)
  const [error, setError] = useState<string | undefined>()
  const lockSuper = isLastSuperAdmin(all, admin)
  const save = useMutation({
    mutationFn: () => shellApi.updateAdmin(admin.id, { roles }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admins'] })
      show(`Roles updated for ${admin.name}. They apply from their next token, within 15 minutes.`)
      onClose()
    },
    onError: err => setError(err instanceof ShellApiError ? err.message : 'That didn’t save. Try again.'),
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Roles for ${admin.name}`}
      description="Roles decide which modules they see and what they can do. Changes apply when their next access token is issued, within 15 minutes."
      width={480}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => {
            if (roles.length === 0) { setError('Choose at least one role.'); return }
            save.mutate()
          }}>Save roles</Button>
        </>
      }
    >
      <RoleChoices
        value={roles}
        onChange={r => { setRoles(r); setError(undefined) }}
        disabled={lockSuper ? { super_admin: 'The last super_admin keeps this role. Make someone else super_admin first.' } : undefined}
        error={error}
      />
    </Dialog>
  )
}
