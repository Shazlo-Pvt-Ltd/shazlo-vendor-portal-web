import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Button, Icon, kit, Row, Rule, Skeleton, Stack, StatusBadge, Text, TextInput, TextLink } from '@shazlo/ui/components'
import { api, ApiError } from '../../api'
import { useSession } from '../../app/session'
import { AuthLayout, PARTNERS_EMAIL } from './AuthLayout'
import { checkPassword, type PasswordRule } from './passwordRules'
import { AuthCard, ButtonAnchor, Chip, errorMessage, focusField, FormAlert, safeNext } from './parts'

// Penpot V-03 · Set password (invite). Notes: the email comes from the invite and is read-only;
// rules are checked as the user types and failed rules stay visible; on success the vendor is
// signed in and lands on Overview; an expired link shows an "Ask us for a new invite" state.

const CARD_WIDTH = 480

const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const time24 = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** "31 Oct, 18:00" */
export const inviteExpiry = (iso: string) => `${dayMonth.format(new Date(iso))}, ${time24.format(new Date(iso))}`

export function SetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.getInvite(token ?? ''),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  })

  let content
  if (!token) {
    content = (
      <InviteProblem
        badge="Link incomplete"
        title="This invite link is incomplete"
        body={`Open the link in your invite email again. If it still doesn’t work, ask ${PARTNERS_EMAIL} for a new one.`}
      />
    )
  } else if (invite.isPending) {
    content = <LoadingCard />
  } else if (invite.isError) {
    const expired = invite.error instanceof ApiError && invite.error.code === 'invite_expired'
    content = expired
      ? <InviteProblem badge="Link expired" title="This invite link has expired" body={invite.error.message} />
      : (
        <AuthCard width={CARD_WIDTH}>
          <Text v="display" as="h1">We couldn’t open your invite</Text>
          <FormAlert title="Something went wrong">{errorMessage(invite.error)}</FormAlert>
          <Button variant="primary" fullWidth icon="refresh" onClick={() => invite.refetch()}>Try again</Button>
        </AuthCard>
      )
  } else {
    content = <SetPasswordForm token={token} email={invite.data.email} brandName={invite.data.brandName} expiresAt={invite.data.expiresAt} next={safeNext(params.get('next'))} />
  }

  return <AuthLayout aside={null} footer={false}>{content}</AuthLayout>
}

function SetPasswordForm({ token, email, brandName, expiresAt, next }: { token: string; email: string; brandName: string; expiresAt: string; next: string }) {
  const { setSession } = useSession()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const rules = checkPassword(password, email)
  const allMet = rules.every(r => r.met)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    const found: typeof errors = {}
    if (!allMet) found.password = password ? 'Your password doesn’t meet all the rules below yet.' : 'Choose a password.'
    if (!confirm) found.confirm = 'Type your password again.'
    else if (confirm !== password) found.confirm = 'The passwords don’t match. Type it again.'
    setErrors(found)
    setFormError(null)
    if (found.password) return focusField('sp-password')
    if (found.confirm) return focusField('sp-confirm')

    setPending(true)
    try {
      const session = await api.setPassword(token, password)
      setSession(session)
      navigate(next, { replace: true })
    } catch (err) {
      setPending(false)
      if (err instanceof ApiError && err.field === 'password') {
        setErrors({ password: err.message })
        focusField('sp-password')
      } else {
        setFormError(errorMessage(err))
      }
    }
  }

  return (
    <AuthCard width={CARD_WIDTH}>
      <Chip>{brandName} is approved</Chip>
      <Text v="display" as="h1">Set a password to finish setting up</Text>
      <Text v="small" tone="muted" as="p">
        You were invited as the owner of {brandName}. This link expires on {inviteExpiry(expiresAt)}.
      </Text>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {formError && <FormAlert title="Your password wasn’t saved">{formError}</FormAlert>}
        <Stack gap={16}>
          {/* Lets password managers save the new password against the right account. */}
          <TextInput id="sp-email" label="Email" type="email" autoComplete="username" value={email} readOnly helper="Invited email · cannot be changed" />
          <TextInput
            id="sp-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => { setPassword(e.target.value); if (errors.password) setErrors(x => ({ ...x, password: undefined })) }}
            error={errors.password}
            aria-describedby={errors.password ? 'sp-password-help sp-rules' : 'sp-rules'}
          />
          <RuleList rules={rules} />
          <TextInput
            id="sp-confirm"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={e => { setConfirm(e.target.value); if (errors.confirm) setErrors(x => ({ ...x, confirm: undefined })) }}
            error={errors.confirm}
          />
        </Stack>
        <Button type="submit" variant="primary" fullWidth disabled={pending}>{pending ? 'Setting your password…' : 'Set password and continue'}</Button>
      </form>
    </AuthCard>
  )
}

function RuleList({ rules }: { rules: PasswordRule[] }) {
  return (
    <ul id="sp-rules" aria-label="Password rules" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rules.map(r => (
        <li key={r.id} data-met={r.met} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name={r.met ? 'check' : 'x'} size={14} color={r.met ? kit.ink : kit.subtle} />
          <Text v="small" tone={r.met ? 'ink' : 'subtle'} style={{ transition: 'color 150ms ease-out' }}>
            {r.label}
            <span className="shz-visually-hidden">{r.met ? ' (done)' : ' (not yet)'}</span>
          </Text>
        </li>
      ))}
    </ul>
  )
}

function InviteProblem({ badge, title, body }: { badge: string; title: string; body: string }) {
  return (
    <AuthCard width={CARD_WIDTH}>
      <span style={{ alignSelf: 'flex-start' }}><StatusBadge tone="failed" icon="clock">{badge}</StatusBadge></span>
      <Text v="display" as="h1">{title}</Text>
      <Text v="small" tone="muted" as="p">{body}</Text>
      <ButtonAnchor href={`mailto:${PARTNERS_EMAIL}?subject=${encodeURIComponent('New seller invite, please')}`} variant="primary" fullWidth>
        <Icon name="mail" size={16} />
        Ask us for a new invite
      </ButtonAnchor>
      <Rule />
      <Row gap={4} wrap>
        <Text v="small" tone="muted">Already set a password?</Text>
        <TextLink to="/sign-in" underline>Sign in</TextLink>
      </Row>
    </AuthCard>
  )
}

function LoadingCard() {
  return (
    <AuthCard width={CARD_WIDTH} aria-busy="true" aria-label="Opening your invite">
      <Skeleton width={172} height={23} radius={999} />
      <Stack gap={8}><Skeleton width="90%" height={28} /><Skeleton width="60%" height={28} /></Stack>
      <Skeleton width="100%" height={32} />
      <Stack gap={16}>
        {[0, 1, 2].map(i => <Stack key={i} gap={6}><Skeleton width={110} height={16} /><Skeleton height={33} radius={6} /></Stack>)}
      </Stack>
      <Skeleton height={33} radius={6} />
    </AuthCard>
  )
}
