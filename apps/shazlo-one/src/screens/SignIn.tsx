import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { Button, Icon, kit, Logo, Rule, Text, TextInput, textStyle } from '@shazlo/ui/components'
import { ShellApiError, shellApi } from '../api/mock'
import { ENVIRONMENT } from '../app/ShellLayout'
import { useSession } from '../app/session'

type FieldErrors = { email?: string; password?: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Only same-app paths are allowed as a post-sign-in destination. */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/sign-in') ? next : '/'
}

/** A-01 · Sign in to Shazlo One. */
export function SignIn() {
  const { session, setSession } = useSession()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [pending, setPending] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const secondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0
  const locked = secondsLeft > 0

  useEffect(() => {
    if (!lockedUntil) return
    const id = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= lockedUntil) {
        setLockedUntil(null)
        setFormError(null)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [lockedUntil])

  useEffect(() => { document.title = 'Sign in · Shazlo One' }, [])

  // Redirect once the session context has the new session (setSession notifies on the next tick).
  if (session) return <Navigate to={safeNext(params.get('next'))} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (locked || pending) return
    const errors: FieldErrors = {}
    if (!email.trim()) errors.email = 'Enter your work email.'
    else if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter an email like name@shazlo.store.'
    if (!password) errors.password = 'Enter your password.'
    setFieldErrors(errors)
    if (errors.email || errors.password) {
      setFormError(null)
      ;(errors.email ? emailRef : passwordRef).current?.focus()
      return
    }
    setPending(true)
    setFormError(null)
    try {
      const s = await shellApi.signIn(email, password)
      setSession(s)
    } catch (err) {
      setPending(false)
      setPassword('')
      if (err instanceof ShellApiError && err.code === 'rate_limited') {
        const t = Date.now()
        setNow(t)
        setLockedUntil(t + (err.details.retryAfter ?? 60) * 1000)
        setFormError('locked')
      } else if (err instanceof ShellApiError && err.code === 'invalid_credentials') {
        const left = err.details.remaining ?? 0
        setFormError(`That email and password don’t match. ${left} ${left === 1 ? 'attempt' : 'attempts'} left before a 60-second wait.`)
        passwordRef.current?.focus()
      } else {
        setFormError('We couldn’t reach the sign-in service. Check your connection and try again.')
      }
    }
  }

  const errorText = formError === 'locked'
    ? `Too many attempts. Sign-in is paused for 60 seconds; try again in ${secondsLeft} s.`
    : formError

  return (
    <div className="shz-one-signin" style={{ minHeight: '100dvh', background: kit.navy, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <style>{css}</style>
      <header className="shz-one-signin-bar" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 40px' }}>
        <Logo tag="ONE" tone="inverse" />
        <span style={{ ...textStyle.overline, color: kit.field, border: `1px solid ${kit.subtle}`, borderRadius: 4, padding: '2px 6px' }}>{ENVIRONMENT.toUpperCase()}</span>
      </header>
      <main style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <form
          noValidate
          onSubmit={submit}
          aria-labelledby="signin-title"
          className="shz-one-signin-card"
          style={{ width: 420, maxWidth: '100%', background: kit.surface, borderRadius: 12, padding: 40, display: 'flex', flexDirection: 'column', gap: 24 }}
        >
          <Text v="display" as="h1" id="signin-title">Sign in to Shazlo One</Text>
          <Text v="small" tone="muted" as="p" style={{ marginTop: 0 }}>For the Shazlo team only. Every sign-in is recorded.</Text>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <TextInput
              ref={emailRef}
              label="Work email"
              type="email"
              name="email"
              autoComplete="username"
              autoFocus
              value={email}
              error={fieldErrors.email}
              onChange={e => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors(f => ({ ...f, email: undefined })) }}
            />
            <TextInput
              ref={passwordRef}
              label="Password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              error={fieldErrors.password}
              onChange={e => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors(f => ({ ...f, password: undefined })) }}
            />
          </div>
          {errorText && (
            <div role="alert" style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 6, background: kit.chip, alignItems: 'flex-start' }}>
              <Icon name="alert" size={16} color={kit.ink} style={{ flexShrink: 0 }} />
              <Text v="small" as="p" style={{ lineHeight: '16px' }}>{errorText}</Text>
            </div>
          )}
          <Button type="submit" variant="primary" fullWidth disabled={pending || locked} aria-disabled={pending || locked}>
            {pending ? 'Signing in…' : locked ? `Try again in ${secondsLeft} s` : 'Sign in'}
          </Button>
          <Rule />
          <Text v="caption" tone="subtle" as="p">Lost access? Ask a super admin to reset your password. There is no self sign-up.</Text>
        </form>
      </main>
    </div>
  )
}

const css = `
@media (max-width: 600px) {
  .shz-one-signin-bar { padding: 16px !important; }
  .shz-one-signin-card { padding: 28px 20px !important; }
}
`
