import { Alert, Box, Button, Link as MuiLink, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { api } from '../../api'
import { ApiError } from '../../api/errors'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PasswordField } from '../../security/PasswordField'
import { registerSensitiveReset } from '../../security/sensitiveState'
import { useSession } from '../../session/AuthProvider'
import { isSessionResponse } from '../../session/store'
import { friendlyError } from '../errors'
import { EMAIL_PATTERN, LIMITS } from '../signup/rules'
import { useCountdown } from '../signup/useCountdown'
import { CountdownNotice } from './CountdownNotice'

/** The one answer for every bad login. It must never say which part was wrong. */
export const BAD_LOGIN_MESSAGE = 'The email or password is incorrect.'

/**
 * Sign in. Every kind of bad login (unknown email, wrong password, unverified, disabled) gets the
 * same message. A rejected or suspended vendor gets the explanation page. Once signed in, the
 * `PublicOnly` guard sends the user to `return-to` (checked) or the dashboard.
 */
export function LoginPage() {
  usePageTitle('Sign in')
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | undefined>()
  const countdown = useCountdown()
  const login = api.useMutation('post', '/v1/auth/login')
  const emailInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const expired = (location.state as { expired?: boolean } | null)?.expired === true

  useEffect(() => registerSensitiveReset(() => setPassword('')), [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (login.isPending || countdown.active) return
    const address = email.trim()
    const problems: { email?: string; password?: string } = {}
    if (address === '') problems.email = 'Enter your email address.'
    else if (address.length > LIMITS.email || !EMAIL_PATTERN.test(address)) {
      problems.email = 'Enter a valid email address, such as name@brand.com.'
    }
    if (password === '') problems.password = 'Enter your password.'
    setErrors(problems)
    setFormError(undefined)
    if (problems.email) return void emailInput.current?.focus()
    if (problems.password) return void passwordInput.current?.focus()

    // The password leaves component state the moment it is sent, whatever the answer.
    const typed = password
    setPassword('')
    try {
      const answer = await login.mutateAsync({ body: { email: address, password: typed } })
      if (!isSessionResponse(answer)) {
        setFormError('Something went wrong on our side. Please try again in a moment.')
        return
      }
      session.signIn(answer)
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'vendor_not_allowed') {
        session.markBlocked()
        void navigate('/', { replace: true })
        return
      }
      if (caught instanceof ApiError && caught.status === 401) {
        setFormError(BAD_LOGIN_MESSAGE)
      } else if (caught instanceof ApiError && caught.status === 422) {
        setFormError('Check your email address and password and try again.')
      } else {
        const friendly = friendlyError(caught)
        setFormError(friendly.message)
        if (friendly.retryAfter) countdown.start(friendly.retryAfter)
      }
      passwordInput.current?.focus()
    }
  }

  const throttled = countdown.active
  return (
    <Box component="main" sx={{ p: 2, maxWidth: 440, mx: 'auto', mt: { xs: 2, sm: 8 }, minWidth: 0 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        Sign in
      </Typography>
      {expired ? (
        <Alert severity="info" role="status" sx={{ mb: 2 }}>
          Your session ended. Sign in again to carry on where you were.
        </Alert>
      ) : null}
      {formError ? (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          {formError}
        </Alert>
      ) : null}
      {throttled ? <CountdownNotice seconds={countdown.remaining} /> : null}

      <Box component="form" onSubmit={submit} noValidate aria-label="Sign in">
        <Stack spacing={2}>
          <TextField
            label="Email address"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errors.email !== undefined}
            helperText={errors.email}
            inputRef={emailInput}
            slotProps={{ htmlInput: { inputMode: 'email', maxLength: LIMITS.email } }}
            fullWidth
          />
          <PasswordField
            purpose="current"
            label="Password"
            name="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password !== undefined}
            helperText={errors.password}
            inputRef={passwordInput}
            fullWidth
          />
          <Button type="submit" variant="contained" size="large" disabled={login.isPending || throttled}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </Stack>
      </Box>

      <Stack spacing={1} sx={{ mt: 3 }}>
        <MuiLink component={Link} to="/forgot-password">
          Forgot your password?
        </MuiLink>
        <Typography>
          New here?{' '}
          <MuiLink component={Link} to="/signup">
            Create a vendor account
          </MuiLink>
        </Typography>
      </Stack>
    </Box>
  )
}
