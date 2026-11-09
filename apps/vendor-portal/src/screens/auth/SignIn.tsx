import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { Button, Checkbox, kit, Row, Rule, Stack, Text, TextInput, TextLink } from '@shazlo/ui/components'
import { api, ApiError, type Session } from '../../api'
import { useSession } from '../../app/session'
import { AuthLayout, PARTNERS_EMAIL } from './AuthLayout'
import { AuthCard, errorMessage, focusField, FormAlert, isEmail, safeNext } from './parts'

// Penpot V-01 · Sign in. Notes: email + password only; identical error copy for an unknown
// email and a wrong password; after 5 failed tries the button cools down for 60 s; password
// reset sends the same response whether or not the email exists; prospects go to V-02.

export const MAX_TRIES = 5
export const COOLDOWN_MS = 60_000

type Mode = 'signIn' | 'reset' | 'resetSent'

export function SignIn() {
  const { session, setSession } = useSession()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  useEffect(() => {
    // Move focus to the new heading when the card switches between sign in and reset.
    if (firstRender.current) { firstRender.current = false; return }
    heading.current?.focus()
  }, [mode])

  if (session) return <Navigate to={next} replace />

  return (
    <AuthLayout>
      <AuthCard width={440}>
        {mode === 'signIn' && (
          <SignInForm headingRef={heading} email={email} setEmail={setEmail} onForgot={() => setMode('reset')} onSignedIn={setSession} />
        )}
        {mode === 'reset' && (
          <ResetForm headingRef={heading} email={email} setEmail={setEmail} onSent={() => setMode('resetSent')} onBack={() => setMode('signIn')} />
        )}
        {mode === 'resetSent' && <ResetSent headingRef={heading} email={email} onBack={() => setMode('signIn')} />}
      </AuthCard>
    </AuthLayout>
  )
}

interface PartProps {
  headingRef: React.RefObject<HTMLHeadingElement | null>
}

function SignInForm({ headingRef, email, setEmail, onForgot, onSignedIn }: PartProps & {
  email: string
  setEmail: (v: string) => void
  onForgot: () => void
  onSignedIn: (s: Session) => void
}) {
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [failures, setFailures] = useState(0)
  const [coolUntil, setCoolUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (coolUntil == null) return
    const t = window.setInterval(() => {
      const at = Date.now()
      setNow(at)
      if (at >= coolUntil) {
        setCoolUntil(null)
        setFailures(0)
        setFormError(null)
      }
    }, 1000)
    return () => window.clearInterval(t)
  }, [coolUntil])

  const secondsLeft = coolUntil == null ? 0 : Math.max(1, Math.ceil((coolUntil - now) / 1000))
  const cooling = coolUntil != null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pending || cooling) return
    const next: typeof errors = {}
    if (!email.trim()) next.email = 'Enter your work email.'
    else if (!isEmail(email)) next.email = 'Enter an email address, like you@yourlabel.in.'
    if (!password) next.password = 'Enter your password.'
    setErrors(next)
    if (next.email) return focusField('signin-email')
    if (next.password) return focusField('signin-password')

    setPending(true)
    setFormError(null)
    try {
      const session = await api.signIn(email.trim(), password, remember)
      onSignedIn(session)
    } catch (err) {
      setPending(false)
      setPassword('')
      if (err instanceof ApiError && err.code === 'invalid_credentials') {
        const tries = failures + 1
        setFailures(tries)
        if (tries >= MAX_TRIES) {
          const at = Date.now()
          setNow(at)
          setCoolUntil(at + COOLDOWN_MS)
        }
      }
      setFormError(errorMessage(err))
      focusField('signin-password')
    }
  }

  return (
    <>
      <Stack gap={24}>
        <Text v="display" as="h1" ref={headingRef} tabIndex={-1} style={{ outline: 'none' }}>Sign in to your seller account</Text>
        <Text v="small" tone="muted" as="p">Manage your brand page, products and review status.</Text>
      </Stack>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {formError && (
          cooling
            ? <FormAlert title="Too many tries">For your security, wait a minute before trying again, or reset your password.</FormAlert>
            : <FormAlert title="Couldn’t sign you in">{formError}</FormAlert>
        )}
        <Stack gap={16}>
          <TextInput
            id="signin-email"
            label="Work email"
            type="email"
            autoComplete="username"
            inputMode="email"
            spellCheck={false}
            value={email}
            onChange={e => setEmail(e.target.value)}
            error={errors.email}
          />
          <TextInput
            id="signin-password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            error={errors.password}
          />
          <Row justify="space-between" gap={12} wrap>
            <Checkbox label="Keep me signed in on this device" checked={remember} onChange={e => setRemember(e.target.checked)} />
            <TextLink underline onClick={onForgot}>Forgot password?</TextLink>
          </Row>
        </Stack>
        <Button type="submit" variant="primary" fullWidth disabled={pending || cooling} aria-describedby={cooling ? 'signin-cooldown' : undefined}>
          {cooling ? `Try again in ${secondsLeft} s` : pending ? 'Signing in…' : 'Sign in'}
        </Button>
        {cooling && <span id="signin-cooldown" className="shz-visually-hidden">Sign in is paused for a minute after {MAX_TRIES} failed tries.</span>}
      </form>
      <Rule />
      <Row gap={4} wrap>
        <Text v="small" tone="muted">New to Shazlo?</Text>
        <TextLink to="/apply" underline>Apply to sell</TextLink>
      </Row>
    </>
  )
}

function ResetForm({ headingRef, email, setEmail, onSent, onBack }: PartProps & {
  email: string
  setEmail: (v: string) => void
  onSent: () => void
  onBack: () => void
}) {
  const [error, setError] = useState<string>()
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    const problem = !email.trim() ? 'Enter your work email.' : !isEmail(email) ? 'Enter an email address, like you@yourlabel.in.' : undefined
    setError(problem)
    if (problem) return focusField('reset-email')
    setPending(true)
    setFormError(null)
    try {
      // Same response whether or not an account exists, so this never reveals who sells here.
      await api.requestPasswordReset(email.trim())
      onSent()
    } catch (err) {
      setPending(false)
      setFormError(errorMessage(err))
    }
  }

  return (
    <>
      <Stack gap={24}>
        <Text v="display" as="h1" ref={headingRef} tabIndex={-1} style={{ outline: 'none' }}>Reset your password</Text>
        <Text v="small" tone="muted" as="p">Enter the email you sign in with and we’ll send you a link to set a new password.</Text>
      </Stack>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {formError && <FormAlert title="Couldn’t send the link">{formError}</FormAlert>}
        <TextInput
          id="reset-email"
          label="Work email"
          type="email"
          autoComplete="username"
          inputMode="email"
          spellCheck={false}
          value={email}
          onChange={e => setEmail(e.target.value)}
          error={error}
        />
        <Button type="submit" variant="primary" fullWidth disabled={pending}>{pending ? 'Sending…' : 'Send reset link'}</Button>
      </form>
      <Rule />
      <Row gap={4} wrap>
        <Text v="small" tone="muted">Remembered it?</Text>
        <TextLink underline onClick={onBack}>Back to sign in</TextLink>
      </Row>
    </>
  )
}

function ResetSent({ headingRef, email, onBack }: PartProps & { email: string; onBack: () => void }) {
  return (
    <>
      <Stack gap={24}>
        <Text v="display" as="h1" ref={headingRef} tabIndex={-1} style={{ outline: 'none' }}>Check your email</Text>
        <Text v="small" tone="muted" as="p" role="status">
          If there’s a seller account for <span style={{ color: kit.ink }}>{email.trim()}</span>,
          we’ve sent a link to reset your password. It works once and expires in 1 hour.
        </Text>
        <Text v="small" tone="muted" as="p">
          Nothing after 10 minutes? Check your spam folder, or write to {PARTNERS_EMAIL}.
        </Text>
      </Stack>
      <Button variant="secondary" fullWidth onClick={onBack}>Back to sign in</Button>
    </>
  )
}
