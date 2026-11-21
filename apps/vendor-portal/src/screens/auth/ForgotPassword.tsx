import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Divider, Link, Stack, TextField, Typography } from '@mui/material'
import { Banner } from '@shazlo/ui'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link as RouterLink } from 'react-router'
import { z } from 'zod'
import { ApiError } from '../../api/errors'
import { useForgotPassword } from '../../api/queries'
import { paths } from '../../app/paths'
import { authCopy } from '../../copy/auth'
import { onboardingCopy } from '../../copy/onboarding'
import { EMAIL_MAX, EMAIL_PATTERN } from '../../lib/account'
import { failureOf } from '../../lib/failure'
import { fieldProps } from '../../lib/forms'
import { useCountdown } from '../../session/useCountdown'
import { AuthLayout, AuthTitle } from './AuthLayout'
import { WaitBanner } from './WaitBanner'
import { ignoreRepeatClick } from '../../lib/clicks'

const copy = onboardingCopy.forgot
const errors = authCopy.signIn.errors

const schema = z.object({
  email: z.string().trim().min(1, errors.emailRequired).max(EMAIL_MAX, errors.emailFormat).regex(EMAIL_PATTERN, errors.emailFormat),
})
type Values = z.infer<typeof schema>

function CheckYourEmail({ email }: { email: string }) {
  const ref = useRef<HTMLDivElement>(null)
  // The form this replaces held focus; hand it to the confirmation so it is read out.
  useEffect(() => ref.current?.focus(), [])
  return (
    <Box ref={ref} tabIndex={-1} sx={{ outline: 'none' }}>
      <AuthTitle title={copy.sentTitle} subtitle={<Box component="span" sx={{ overflowWrap: 'anywhere' }}>{copy.sentBody(email)}</Box>} />
      <Typography variant="body2" color="text.secondary">
        {copy.sentHelp} <Link href={`mailto:${onboardingCopy.partnersEmail}`}>{onboardingCopy.partnersEmail}</Link>.
      </Typography>
      <Divider sx={{ my: 3 }} />
      <Button variant="outlined" size="large" component={RouterLink} to={paths.signIn} sx={{ minHeight: 44 }}>
        {copy.backToSignIn}
      </Button>
    </Box>
  )
}

/**
 * Asks vendor-api for a link to choose a new password (`POST /v1/auth/forgot-password`). The
 * answer is the same whether or not the address has an account, so the page never says which.
 */
export default function ForgotPassword() {
  const forgot = useForgotPassword()
  const wait = useCountdown()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, formState, setError } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } })

  const onSubmit = handleSubmit(async ({ email }) => {
    if (wait.active) return
    setFailure(null)
    try {
      await forgot.mutateAsync(email)
      setSentTo(email)
    } catch (error) {
      // Only a request that did not go through is worth showing; anything about the account would give it away.
      if (error instanceof ApiError && error.status === 404) setSentTo(email)
      else if (error instanceof ApiError && error.status === 422) setError('email', { message: errors.emailFormat }, { shouldFocus: true })
      else {
        const { message, retryAfter } = failureOf(error)
        if (retryAfter) wait.start(retryAfter)
        else setFailure(message)
      }
    }
  })

  if (sentTo !== null) {
    return (
      <AuthLayout>
        <CheckYourEmail email={sentTo} />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <AuthTitle title={copy.title} subtitle={copy.subtitle} />
      <Box component="form" noValidate onSubmit={onSubmit}>
        <Stack spacing={2.5}>
          {failure && <Banner tone="error" title={failure} />}
          {wait.active && <WaitBanner seconds={wait.remaining} />}
          <TextField
            label={copy.email}
            type="email"
            autoComplete="username"
            slotProps={{ htmlInput: { inputMode: 'email', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, maxLength: EMAIL_MAX } }}
            {...fieldProps(register('email'), formState.errors.email)}
          />
          <Button type="submit" variant="contained" size="large" fullWidth disabled={formState.isSubmitting || wait.active} onClick={ignoreRepeatClick} sx={{ minHeight: 44 }}>
            {formState.isSubmitting ? copy.submitting : copy.submit}
          </Button>
        </Stack>
      </Box>
      <Divider sx={{ my: 3 }} />
      <Link component={RouterLink} to={paths.signIn} variant="body1">
        {copy.backToSignIn}
      </Link>
    </AuthLayout>
  )
}
