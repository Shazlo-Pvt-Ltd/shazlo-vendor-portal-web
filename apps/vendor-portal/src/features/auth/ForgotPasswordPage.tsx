import { Alert, Box, Button, Link as MuiLink, TextField, Typography } from '@mui/material'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api } from '../../api'
import { usePageTitle } from '../../hooks/usePageTitle'
import { friendlyError } from '../errors'
import { EMAIL_PATTERN, LIMITS } from '../signup/rules'
import { useCountdown } from '../signup/useCountdown'
import { CountdownNotice } from './CountdownNotice'

/** The one confirmation, whatever the address. It must never say whether the address is registered. */
export const FORGOT_CONFIRMATION =
  'If an account uses that email address, we have sent a link to choose a new password. It can take a few minutes; check your spam folder too.'

export function ForgotPasswordPage() {
  usePageTitle('Reset your password')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [sent, setSent] = useState(false)
  const countdown = useCountdown()
  const forgot = api.useMutation('post', '/v1/auth/forgot-password')
  const input = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (sent) heading.current?.focus()
  }, [sent])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (forgot.isPending || countdown.active) return
    const address = email.trim()
    if (address === '' || address.length > LIMITS.email || !EMAIL_PATTERN.test(address)) {
      setError('Enter the email address you signed up with.')
      input.current?.focus()
      return
    }
    setError(undefined)
    try {
      await forgot.mutateAsync({ body: { email: address } })
      setSent(true)
    } catch (caught) {
      const friendly = friendlyError(caught)
      setError(friendly.message)
      if (friendly.retryAfter) countdown.start(friendly.retryAfter)
    }
  }

  if (sent) {
    return (
      <Box component="main" sx={{ p: 2, maxWidth: 440, mx: 'auto', mt: { xs: 2, sm: 8 } }}>
        <Typography component="h1" variant="h4" gutterBottom tabIndex={-1} ref={heading}>
          Check your email
        </Typography>
        <Typography sx={{ mb: 3 }}>{FORGOT_CONFIRMATION}</Typography>
        <MuiLink component={Link} to="/login">
          Back to sign in
        </MuiLink>
      </Box>
    )
  }

  return (
    <Box component="main" sx={{ p: 2, maxWidth: 440, mx: 'auto', mt: { xs: 2, sm: 8 }, minWidth: 0 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        Reset your password
      </Typography>
      <Typography sx={{ mb: 2 }}>Enter your email address and we will send you a link to choose a new password.</Typography>
      {countdown.active ? <CountdownNotice seconds={countdown.remaining} /> : null}
      <Box component="form" onSubmit={submit} noValidate aria-label="Reset your password">
        <TextField
          label="Email address"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error !== undefined}
          helperText={error}
          inputRef={input}
          slotProps={{ htmlInput: { inputMode: 'email', maxLength: LIMITS.email } }}
          fullWidth
          margin="normal"
        />
        <Button type="submit" variant="contained" size="large" disabled={forgot.isPending || countdown.active}>
          {forgot.isPending ? 'Sending…' : 'Send the link'}
        </Button>
      </Box>
      <Alert severity="info" sx={{ mt: 3 }}>
        For your safety the answer is the same whether or not the address has an account.
      </Alert>
      <Typography sx={{ mt: 2 }}>
        <MuiLink component={Link} to="/login">
          Back to sign in
        </MuiLink>
      </Typography>
    </Box>
  )
}
