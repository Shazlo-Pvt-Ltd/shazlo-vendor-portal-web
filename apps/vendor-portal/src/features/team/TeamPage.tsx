import { Alert, Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { api } from '../../api'
import { ApiError } from '../../api/errors'
import { useSession } from '../../session/AuthProvider'
import { EmptyState, ErrorState, PageHeader, PageSkeleton, useConfirm, useToast } from '../../ui'
import { LIMITS } from '../signup/rules'
import {
  STATUS_COLOR,
  checkInviteEmail,
  exactTime,
  isMemberStatus,
  relativeTime,
  roleLabel,
  sortMembers,
  statusLabel,
  teamErrorMessage,
  type Member,
  type TeamAction,
} from './rules'

const USERS_PATH = '/v1/vendor/users'

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const invite = api.useMutation('post', USERS_PATH)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [sent, setSent] = useState<string | undefined>()
  const input = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (invite.isPending) return
    setSent(undefined)
    const problem = checkInviteEmail(email)
    setError(problem)
    if (problem) return void input.current?.focus()
    try {
      const answer = await invite.mutateAsync({ body: { email: email.trim() } })
      // The same answer whether or not the address can be invited, so nobody can find out who is registered.
      setSent(answer.message)
      setEmail('')
      onInvited()
    } catch (caught) {
      setError(teamErrorMessage(caught, 'invite'))
      input.current?.focus()
    }
  }

  return (
    <Paper component="section" variant="outlined" aria-labelledby="invite-heading" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
      <Typography id="invite-heading" component="h2" variant="h6" gutterBottom>
        Invite a team member
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        They get an email with a link to choose a password. Team members can edit the brand page and products; only you can manage
        the team.
      </Typography>
      <Box component="form" noValidate onSubmit={submit} aria-label="Invite a team member">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            inputRef={input}
            label="Email address"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              if (error) setError(undefined)
            }}
            error={error !== undefined}
            helperText={error ?? ' '}
            slotProps={{ htmlInput: { maxLength: LIMITS.email, inputMode: 'email', spellCheck: false, autoCapitalize: 'none' } }}
            sx={{ flexGrow: 1 }}
          />
          <Button type="submit" variant="contained" disabled={invite.isPending} sx={{ mt: { sm: 1 } }}>
            {invite.isPending ? 'Sending…' : 'Send invitation'}
          </Button>
        </Stack>
      </Box>
      {sent ? (
        <Alert severity="success" role="status">
          {sent} If they do not see it, ask them to check their spam folder, or resend it from the list below.
        </Alert>
      ) : null}
    </Paper>
  )
}

function MemberRow({ member, isMe, busy, onAction }: { member: Member; isMe: boolean; busy: boolean; onAction: (action: TeamAction) => void }) {
  const isOwner = member.role === 'owner'
  return (
    <Paper component="li" variant="outlined" sx={{ listStyle: 'none', p: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ overflowWrap: 'anywhere', fontWeight: 500 }}>
            {member.email}
            {isMe ? ' (you)' : ''}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Chip size="small" variant="outlined" label={roleLabel(member.role)} />
            <Chip
              size="small"
              label={statusLabel(member.status)}
              color={isMemberStatus(member.status) ? STATUS_COLOR[member.status] : 'default'}
            />
            <Typography variant="body2" color="text.secondary">
              {member.last_login_at ? (
                <>
                  Last signed in <time dateTime={member.last_login_at} title={exactTime(member.last_login_at)}>{relativeTime(member.last_login_at)}</time>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}> ({exactTime(member.last_login_at)})</Box>
                </>
              ) : member.status === 'invited' ? (
                `Invited ${relativeTime(member.created_at)}, has not signed in yet`
              ) : (
                'Has not signed in yet'
              )}
            </Typography>
          </Stack>
        </Box>
        {isOwner || isMe ? null : (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0, flexWrap: 'wrap', gap: 1 }}>
            {member.status === 'invited' ? (
              <Button size="small" disabled={busy} onClick={() => onAction('resend')} aria-label={`Resend the invitation to ${member.email}`}>
                Resend invitation
              </Button>
            ) : null}
            {member.status === 'disabled' ? (
              <Button size="small" disabled={busy} onClick={() => onAction('enable')} aria-label={`Enable ${member.email}`}>
                Enable
              </Button>
            ) : (
              <Button size="small" color="error" disabled={busy} onClick={() => onAction('disable')} aria-label={`Disable ${member.email}`}>
                Disable
              </Button>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}

/** `/team` (owner only): the vendor's users, inviting staff, resending an invitation, disabling and enabling. */
export default function TeamPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()
  const { user } = useSession()
  const users = api.useQuery('get', USERS_PATH)
  const update = api.useMutation('patch', '/v1/vendor/users/{user_id}')
  const resend = api.useMutation('post', '/v1/vendor/users/{user_id}/resend-invite')
  const [busyId, setBusyId] = useState<string | undefined>()
  const [actionError, setActionError] = useState<string | undefined>()

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['get', USERS_PATH] })

  async function act(member: Member, action: TeamAction) {
    setActionError(undefined)
    if (action === 'disable' || action === 'enable') {
      const disable = action === 'disable'
      const go = await confirm(
        disable
          ? {
              title: `Disable ${member.email}?`,
              message: 'They are signed out everywhere at once and cannot sign in until you enable them again. Their work stays.',
              confirmLabel: 'Disable',
              destructive: true,
            }
          : {
              title: `Enable ${member.email}?`,
              message:
                'They can sign in again with their password. Someone who never accepted their invitation needs a new one: disabling ended the old link, so resend it afterwards.',
              confirmLabel: 'Enable',
            },
      )
      if (!go) return
    }
    setBusyId(member.id)
    try {
      if (action === 'resend') {
        await resend.mutateAsync({ params: { path: { user_id: member.id } } })
        toast.success(`Invitation sent again to ${member.email}`)
      } else {
        const updated = await update.mutateAsync({ params: { path: { user_id: member.id } }, body: { disabled: action === 'disable' } })
        queryClient.setQueryData<Member[]>(api.queryOptions('get', USERS_PATH).queryKey, (current) =>
          current?.map((item) => (item.id === updated.id ? updated : item)),
        )
        if (action === 'disable') toast.success(`${member.email} is disabled`)
        // vendor-api puts someone who never set a password back to `invited`; their old link no longer works.
        else if (updated.status === 'invited') toast.success(`${member.email} is enabled. Resend the invitation so they can choose a password.`)
        else toast.success(`${member.email} is enabled`)
      }
    } catch (caught) {
      setActionError(teamErrorMessage(caught, action))
      if (caught instanceof ApiError && (caught.status === 404 || caught.status === 409)) refresh()
    } finally {
      setBusyId(undefined)
    }
  }

  let body
  if (users.isPending) {
    body = <PageSkeleton />
  } else if (users.isError) {
    body = <ErrorState error={users.error} title="We couldn't load your team" onRetry={() => void users.refetch()} />
  } else {
    const members = sortMembers(users.data)
    const others = members.filter((member) => member.role !== 'owner')
    body = (
      <Box component="section" aria-labelledby="members-heading">
        <Typography id="members-heading" component="h2" variant="h6" gutterBottom>
          People ({members.length})
        </Typography>
        {actionError ? (
          <Alert severity="error" role="alert" sx={{ mb: 2 }}>
            {actionError}
          </Alert>
        ) : null}
        <Stack component="ul" aria-label="Team members" spacing={1.5} sx={{ p: 0, m: 0 }}>
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isMe={member.id === user?.id}
              busy={busyId === member.id}
              onAction={(action) => void act(member, action)}
            />
          ))}
        </Stack>
        {others.length === 0 ? (
          <EmptyState title="No team members yet" description="Invite someone above to let them help with your brand page and products." />
        ) : null}
      </Box>
    )
  }

  return (
    <>
      <PageHeader title="Team" description="The people who can work on your vendor account." />
      <InviteForm onInvited={refresh} />
      {body}
    </>
  )
}
