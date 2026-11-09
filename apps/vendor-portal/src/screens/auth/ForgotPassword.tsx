import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Divider, Link, Stack, TextField, Typography } from '@mui/material'
import { Banner } from '@shazlo/ui'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link as RouterLink } from 'react-router'
import { z } from 'zod'
import { ApiError } from '../../api/client'
import { useForgotPassword } from '../../api/queries'
import { paths } from '../../app/paths'
import { onboardingCopy } from '../../copy/onboarding'
import { fieldProps } from '../../lib/forms'
import { AuthLayout, AuthTitle } from './AuthLayout'

const copy = onboardingCopy.forgot

const schema = z.object({
  email: z.string().trim().min(1, copy.errors.emailRequired).email(copy.errors.emailFormat),
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

export default function ForgotPassword() {
  const forgot = useForgotPassword()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } })

  const onSubmit = handleSubmit(async ({ email }) => {
    setFailure(null)
    try {
      await forgot.mutateAsync(email)
      setSentTo(email)
    } catch (error) {
      // The answer never says whether the account exists; only a request that did not go through is worth showing.
      if (error instanceof ApiError && error.status === 404) setSentTo(email)
      else setFailure(error instanceof ApiError ? error.message : copy.failed)
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
          <TextField
            label={copy.email}
            type="email"
            autoComplete="username"
            slotProps={{ htmlInput: { inputMode: 'email', autoCapitalize: 'none', spellCheck: false } }}
            {...fieldProps(register('email'), formState.errors.email)}
          />
          <Button type="submit" variant="contained" size="large" fullWidth disabled={formState.isSubmitting} sx={{ minHeight: 44 }}>
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
