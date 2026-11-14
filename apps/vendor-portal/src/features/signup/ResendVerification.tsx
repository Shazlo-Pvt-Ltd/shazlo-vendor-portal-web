import { Alert, Box, Button, TextField, Typography } from '@mui/material'
import { useState, type FormEvent } from 'react'
import { api } from '../../api'
import { friendlyError } from '../errors'
import { EMAIL_PATTERN, LIMITS } from './rules'
import { useCountdown } from './useCountdown'

/** After a link is sent, another cannot be requested for this many seconds. */
export const RESEND_COOLDOWN_SECONDS = 60

interface Props {
  /** The address the vendor already typed, if any. */
  initialEmail?: string
}

/**
 * Asks for a new verification link. The answer is always the same ("if that address needs one, it
 * is on its way"), so it never reveals whether an address is registered. A cooldown stops a double
 * click from sending twice and the form from being used to flood an inbox.
 */
export function ResendVerification({ initialEmail = '' }: Props) {
  const [email, setEmail] = useState(initialEmail)
  const [error, setError] = useState<string | undefined>()
  const [sent, setSent] = useState(false)
  const cooldown = useCountdown()
  const resend = api.useMutation('post', '/v1/auth/resend-verification')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (cooldown.active || resend.isPending) return
    const address = email.trim()
    if (address === '' || address.length > LIMITS.email || !EMAIL_PATTERN.test(address)) {
      setError('Enter the email address you signed up with.')
      setSent(false)
      return
    }
    setError(undefined)
    try {
      await resend.mutateAsync({ body: { email: address } })
      setSent(true)
      cooldown.start(RESEND_COOLDOWN_SECONDS)
    } catch (caught) {
      const friendly = friendlyError(caught)
      setSent(false)
      setError(friendly.message)
      if (friendly.retryAfter) cooldown.start(friendly.retryAfter)
    }
  }

  const waiting = cooldown.active
  return (
    <Box component="form" onSubmit={submit} noValidate aria-label="Send a new verification link" sx={{ mt: 3 }}>
      <Typography component="h2" variant="h6" gutterBottom>
        Didn't get the email?
      </Typography>
      <TextField
        label="Email address"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={error !== undefined}
        helperText={error}
        fullWidth
        margin="normal"
        slotProps={{ htmlInput: { inputMode: 'email', maxLength: LIMITS.email } }}
      />
      {sent ? (
        <Alert severity="success" role="status" sx={{ mb: 2 }}>
          If that address needs a new link, it is on its way. Check your inbox and spam folder.
        </Alert>
      ) : null}
      <Button type="submit" variant="outlined" disabled={waiting || resend.isPending}>
        {waiting ? `Send again in ${cooldown.remaining} s` : 'Send a new link'}
      </Button>
    </Box>
  )
}
