import { Box, Button, Card, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { Banner, neutral, PageHeader, radius, SectionCard, shadow } from '@shazlo/ui'
import { useId, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../../api/errors'
import type { TeamUser } from '../../api/model'
import { useInviteUser, useResendInvite, useSetUserDisabled, useTeam } from '../../api/queries'
import { hubsCopy } from '../../copy/hubs'
import { EMAIL_MAX } from '../../lib/account'
import { formatDate, formatRelative, formatTime } from '../../lib/format'
import { useSession } from '../../session/AuthProvider'
import { useNavMode } from '../../shell/layout'
import { canActOn, checkInvite, sortTeam, teamFailure, type TeamAction } from './rules'
import { ignoreRepeatClick } from '../../lib/clicks'

const copy = hubsCopy.team
const touch = { minHeight: 44 } as const

type Result = { tone: 'success' | 'error'; text: string }
type Confirming = { member: TeamUser; action: 'disable' | 'enable' }

// ---- inviting ------------------------------------------------------------------------------------

function InviteCard({ team }: { team: readonly TeamUser[] }) {
  const inviteUser = useInviteUser()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const sending = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current) return
    setSent(null)
    const problem = checkInvite(email, team)
    setError(problem ?? null)
    if (problem) return void input.current?.focus()
    const address = email.trim()
    sending.current = true
    try {
      await inviteUser.mutateAsync(address)
      // The same words whether or not the address can be invited: nobody learns who has an account.
      setSent(copy.invite.sent(address))
      setEmail('')
    } catch (caught) {
      setError(teamFailure(caught, 'invite'))
      input.current?.focus()
    } finally {
      sending.current = false
    }
  }

  return (
    <Box sx={{ mb: 3 }}>
      <SectionCard title={copy.invite.title}>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
          {copy.invite.body}
        </Typography>
        <Box component="form" noValidate onSubmit={(event) => void submit(event)} aria-label={copy.invite.title}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
            <TextField
              inputRef={input}
              label={copy.invite.email}
              type="email"
              name="email"
              autoComplete="off"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                if (error) setError(null)
              }}
              error={error !== null}
              helperText={error ?? undefined}
              fullWidth
              sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: '1rem' } }}
              slotProps={{ htmlInput: { inputMode: 'email', maxLength: EMAIL_MAX, autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } }}
            />
            <Button type="submit" variant="contained" size="large" disabled={inviteUser.isPending} onClick={ignoreRepeatClick} sx={{ ...touch, flexShrink: 0, mt: { sm: '4px' } }}>
              {inviteUser.isPending ? copy.invite.submitting : copy.invite.submit}
            </Button>
          </Stack>
        </Box>
        {sent && (
          <Box sx={{ mt: 2 }}>
            <Banner tone="success" title={<Box component="span" sx={{ overflowWrap: 'anywhere' }}>{sent}</Box>} />
          </Box>
        )}
      </SectionCard>
    </Box>
  )
}

// ---- one person ----------------------------------------------------------------------------------

function Email({ member, me }: { member: TeamUser; me: boolean }) {
  return (
    <Typography component="span" variant="body1" sx={{ overflowWrap: 'anywhere' }}>
      <span>{member.email}</span>
      {me && (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {' '}
          {copy.you}
        </Box>
      )}
    </Typography>
  )
}

// When someone last signed in: "Yesterday", "18 Nov"; the exact time on hover and for machines.
function LastSignIn({ at, long }: { at: string | null; long?: boolean }) {
  if (!at) return <>{long ? copy.notSignedInYet : copy.neverSignedIn}</>
  const relative = formatRelative(at)
  // In the sentence ("Last signed in just now") the time starts in lower case; on its own it does not.
  const shown = long ? relative.charAt(0).toLowerCase() + relative.slice(1) : relative
  const when = (
    <time dateTime={at} title={`${formatDate(at)}, ${formatTime(at)}`}>
      {shown}
    </time>
  )
  return long ? <>{copy.lastSignedIn} {when}</> : when
}

function Actions({ member, busy, onAction }: { member: TeamUser; busy: boolean; onAction: (action: TeamAction) => void }) {
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', justifyContent: { md: 'flex-end' } }}>
      {member.status === 'invited' && (
        <Button size="small" disabled={busy} onClick={() => onAction('resend')} aria-label={copy.resendLabel(member.email)} sx={touch}>
          {copy.resend}
        </Button>
      )}
      {member.status === 'disabled' ? (
        <Button size="small" disabled={busy} onClick={() => onAction('enable')} aria-label={copy.turnOnLabel(member.email)} sx={touch}>
          {copy.turnOn}
        </Button>
      ) : (
        <Button size="small" disabled={busy} onClick={() => onAction('disable')} aria-label={copy.turnOffLabel(member.email)} sx={touch}>
          {copy.turnOff}
        </Button>
      )}
    </Stack>
  )
}

type ListProps = { members: TeamUser[]; myId: string | undefined; busyId: string | null; onAction: (member: TeamUser, action: TeamAction) => void }

// Desktop: one row per person.
function TeamTable({ members, myId, busyId, onAction }: ListProps) {
  const c = copy.columns
  return (
    <Card sx={{ overflowX: 'auto' }}>
      <Table aria-label={copy.listLabel} sx={{ '& td, & th': { borderColor: neutral.line } }}>
        <TableHead>
          <TableRow>
            <TableCell>{c.email}</TableCell>
            <TableCell>{c.role}</TableCell>
            <TableCell>{c.status}</TableCell>
            <TableCell>{c.lastSignIn}</TableCell>
            <TableCell align="right">{c.actions}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell sx={{ maxWidth: 360 }}>
                <Email member={member} me={member.id === myId} />
              </TableCell>
              <TableCell>{copy.roles[member.role]}</TableCell>
              <TableCell>{copy.statuses[member.status]}</TableCell>
              <TableCell>
                <LastSignIn at={member.lastLoginAt} />
              </TableCell>
              <TableCell align="right">{canActOn(member, myId) && <Actions member={member} busy={busyId === member.id} onAction={(action) => onAction(member, action)} />}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

// Phones and tablets: one card per person.
function TeamCards({ members, myId, busyId, onAction }: ListProps) {
  return (
    <Stack component="ul" aria-label={copy.listLabel} spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {members.map((member) => (
        <Card component="li" key={member.id} sx={{ px: 2, py: 1.75, minWidth: 0 }}>
          <Email member={member} me={member.id === myId} />
          <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
            {copy.roles[member.role]} · {copy.statuses[member.status]}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <LastSignIn at={member.lastLoginAt} long />
          </Typography>
          {canActOn(member, myId) && (
            <Box sx={{ mt: 1, ml: -1 }}>
              <Actions member={member} busy={busyId === member.id} onAction={(action) => onAction(member, action)} />
            </Box>
          )}
        </Card>
      ))}
    </Stack>
  )
}

function ConfirmDialog({ confirming, onCancel, onConfirm }: { confirming: Confirming | null; onCancel: () => void; onConfirm: () => void }) {
  const [shown, setShown] = useState(confirming)
  // Keep the words while the dialog fades out.
  if (confirming && confirming !== shown) setShown(confirming)
  const c = shown?.action === 'enable' ? copy.confirmOn : copy.confirmOff
  return (
    <Dialog
      open={confirming !== null}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { elevation: 0, sx: { borderRadius: `${radius.sheet}px`, boxShadow: shadow.overlay } } }}
    >
      <DialogTitle sx={{ typography: 'h2', pb: 1, overflowWrap: 'anywhere' }}>{shown ? c.title(shown.member.email) : ''}</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body1">{c.body}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onCancel} sx={touch}>
          {copy.cancel}
        </Button>
        <Button variant="contained" color={shown?.action === 'enable' ? 'primary' : 'error'} onClick={onConfirm} sx={touch}>
          {c.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ListSkeleton() {
  return (
    <Stack spacing={1.5} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} variant="rounded" height={72} />
      ))}
    </Stack>
  )
}

/**
 * `/team` (owners only; the route guard turns staff away): everyone on the store's team, inviting
 * staff, sending an invite again, turning someone off or on (main's TeamPage, in Build 2's design:
 * a table on desktop, cards on phones and tablets). Results show in the page, not as toasts.
 */
export default function Team() {
  const { user } = useSession()
  const team = useTeam()
  const mode = useNavMode()
  const resend = useResendInvite()
  const setDisabled = useSetUserDisabled()
  const [result, setResult] = useState<Result | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const listId = useId()

  async function act(member: TeamUser, action: TeamAction) {
    setResult(null)
    setBusyId(member.id)
    try {
      if (action === 'resend') {
        await resend.mutateAsync(member.id)
        setResult({ tone: 'success', text: copy.resent(member.email) })
      } else {
        const updated = await setDisabled.mutateAsync({ userId: member.id, disabled: action === 'disable' })
        // vendor-api puts someone who never chose a password back to `invited`: their old link no longer works.
        const text = action === 'disable' ? copy.turnedOff(member.email) : updated.status === 'invited' ? copy.turnedOnInvite(member.email) : copy.turnedOn(member.email)
        setResult({ tone: 'success', text })
      }
    } catch (caught) {
      setResult({ tone: 'error', text: teamFailure(caught, action) })
      if (caught instanceof ApiError && (caught.status === 404 || caught.status === 409)) void team.refetch()
    } finally {
      setBusyId(null)
    }
  }

  function onAction(member: TeamUser, action: TeamAction) {
    if (action === 'disable' || action === 'enable') setConfirming({ member, action })
    else void act(member, action)
  }

  let body
  if (team.isPending) body = <ListSkeleton />
  else if (team.isError) {
    body = (
      <Banner
        tone="error"
        title={copy.loadFailed}
        action={
          <Button size="small" onClick={() => void team.refetch()} sx={touch}>
            {copy.retry}
          </Button>
        }
      >
        {teamFailure(team.error, 'resend')}
      </Banner>
    )
  } else {
    const members = sortTeam(team.data)
    const props: ListProps = { members, myId: user?.id, busyId, onAction }
    body = (
      <>
        {mode === 'desktop' ? <TeamTable {...props} /> : <TeamCards {...props} />}
        {members.every((m) => m.role === 'owner' || m.id === user?.id) && (
          <Typography variant="body1" color="textSecondary" sx={{ mt: 2 }}>
            {copy.onlyYou}
          </Typography>
        )}
      </>
    )
  }

  return (
    <>
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      <InviteCard team={team.data ?? []} />
      <Box component="section" aria-labelledby={listId}>
        <Typography id={listId} variant="h2" component="h2" sx={{ mb: 1.5 }}>
          {copy.listTitle(team.data?.length ?? 0)}
        </Typography>
        {result && (
          <Box sx={{ mb: 2 }}>
            <Banner tone={result.tone} title={<Box component="span" sx={{ overflowWrap: 'anywhere' }}>{result.text}</Box>} />
          </Box>
        )}
        {body}
      </Box>
      <ConfirmDialog
        confirming={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const chosen = confirming
          setConfirming(null)
          if (chosen) void act(chosen.member, chosen.action)
        }}
      />
    </>
  )
}
