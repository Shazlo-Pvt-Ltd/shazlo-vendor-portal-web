import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { Banner } from '@shazlo/ui'
import { useId, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../../api/errors'
import { useResendVerification } from '../../api/queries'
import { authCopy } from '../../copy/auth'
import { onboardingCopy } from '../../copy/onboarding'
import { checkEmail, EMAIL_MAX } from '../../lib/account'
import { failureOf } from '../../lib/failure'
import { useCountdown } from '../../session/useCountdown'
import { ignoreRepeatClick } from '../../lib/clicks'

const copy = onboardingCopy.resend

/** After an email is sent, another cannot be asked for this many seconds. */
export const RESEND_COOLDOWN_SECONDS = 60

/**
 * Asks for another email to confirm an address (main's ResendVerification). With `email` (just
 * after sign-up) it is one button; without (an old link) the seller types the address. The answer
 * is the same whether or not the address has an account. A cooldown stops a double tap from
 * sending twice and the form from flooding an inbox.
 */
export function ResendEmail({ email, primary = false }: { email?: string; primary?: boolean }) {
  const resend = useResendVerification()
  const cooldown = useCountdown()
  const [address, setAddress] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const sending = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const titleId = useId()

  async function send(event?: FormEvent) {
    event?.preventDefault()
    if (sending.current || cooldown.active) return
    setFailure(null)
    setSent(null)
    if (email === undefined) {
      const problem = checkEmail(address)
      setFieldError(problem ?? null)
      if (problem) {
        input.current?.focus()
        return
      }
    }
    sending.current = true
    try {
      await resend.mutateAsync((email ?? address).trim())
      setSent(email === undefined ? copy.sent : copy.sentTo(email))
      cooldown.start(RESEND_COOLDOWN_SECONDS)
    } catch (caught) {
      if (email === undefined && caught instanceof ApiError && caught.status === 422) {
        setFieldError(caught.fields.email ?? authCopy.rules.emailFormat)
        input.current?.focus()
        return
      }
      const { message, retryAfter } = failureOf(caught)
      setFailure(message)
      if (retryAfter) cooldown.start(retryAfter)
    } finally {
      sending.current = false
    }
  }

  const button = (
    <Button
      type={email === undefined ? 'submit' : 'button'}
      variant={primary ? 'contained' : 'outlined'}
      size="large"
      onClick={(event) => (email === undefined ? ignoreRepeatClick(event) : event.detail > 1 || void send())}
      disabled={resend.isPending || cooldown.active}
      sx={{ minHeight: 44 }}
    >
      {cooldown.active ? copy.submitAgain(cooldown.remaining) : resend.isPending ? copy.sending : copy.submit}
    </Button>
  )
  const results = (
    <>
      {sent && <Banner tone="success" title={<Box component="span" sx={{ overflowWrap: 'anywhere' }}>{sent}</Box>} />}
      {failure && <Banner tone="error" title={failure} />}
    </>
  )

  if (email !== undefined) {
    return (
      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="body1">{copy.prompt}</Typography>
        {button}
        {results}
      </Stack>
    )
  }

  return (
    <Box component="form" noValidate onSubmit={(event) => void send(event)} aria-labelledby={titleId}>
      <Typography id={titleId} variant="h2" component="h2" sx={{ mb: 2 }}>
        {copy.formTitle}
      </Typography>
      <Stack spacing={2.5}>
        {results}
        <TextField
          inputRef={input}
          label={copy.email}
          type="email"
          name="email"
          autoComplete="email"
          value={address}
          onChange={(event) => {
            setAddress(event.target.value)
            if (fieldError) setFieldError(null)
          }}
          error={fieldError !== null}
          helperText={fieldError ?? undefined}
          fullWidth
          sx={{ '& .MuiInputBase-input': { fontSize: '1rem' } }}
          slotProps={{ htmlInput: { inputMode: 'email', maxLength: EMAIL_MAX, autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } }}
        />
        {button}
      </Stack>
    </Box>
  )
}
