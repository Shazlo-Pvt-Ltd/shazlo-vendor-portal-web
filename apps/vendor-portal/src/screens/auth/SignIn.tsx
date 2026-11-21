import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Divider, Link, Stack, TextField, Typography } from '@mui/material'
import { Banner, brand } from '@shazlo/ui'
import { Layers, ShieldCheck, Wallet } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { paths } from '../../app/paths'
import { authCopy } from '../../copy/auth'
import { frameCopy } from '../../copy/frame'
import { srOnly } from '../../lib/a11y'
import { fieldProps } from '../../lib/forms'
import { PasswordField } from '../../security/PasswordField'
import { registerSensitiveReset } from '../../security/sensitiveState'
import { useCountdown } from '../../session/useCountdown'
import { useLogin } from '../../session/useLogin'
import { AuthLayout, AuthTitle } from './AuthLayout'

const copy = authCopy.signIn
// The longest address vendor-api accepts.
const EMAIL_MAX = 320

const schema = z.object({
  email: z.string().trim().min(1, copy.errors.emailRequired).max(EMAIL_MAX, copy.errors.emailFormat).email(copy.errors.emailFormat),
  password: z.string().min(1, copy.errors.passwordRequired),
})
type Values = z.infer<typeof schema>

const ICONS = [Layers, ShieldCheck, Wallet]

function WhySell() {
  const id = useId()
  return (
    <Box component="aside" aria-labelledby={id} sx={{ maxWidth: 420 }}>
      <Typography variant="informal" sx={{ color: brand.brown, mb: 1 }}>
        {authCopy.why.tagline}
      </Typography>
      <Typography id={id} variant="display2" component="h2" sx={{ fontSize: '2.25rem', lineHeight: 1.15, mb: 4 }}>
        {authCopy.why.title}
      </Typography>
      <Stack component="ul" spacing={3} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {authCopy.why.points.map((point, i) => {
          const Icon = ICONS[i]!
          return (
            <Stack component="li" key={point.title} direction="row" spacing={2}>
              <Box sx={{ color: brand.brown, pt: '3px', flexShrink: 0 }}>
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
              </Box>
              <Box>
                <Typography variant="h3" component="h3">
                  {point.title}
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
                  {point.body}
                </Typography>
              </Box>
            </Stack>
          )
        })}
      </Stack>
    </Box>
  )
}

/**
 * V-01. Signs in through the session (src/session): the access token stays in memory and the
 * refresh cookie keeps the seller signed in, so there is no "keep me signed in". Once signed in,
 * the `PublicOnly` guard sends the seller to `?next` (checked by safeReturnTo) or Home. The
 * password leaves the form the moment it is sent.
 */
export default function SignIn() {
  const login = useLogin()
  const location = useLocation()
  const navigate = useNavigate()
  const countdown = useCountdown()
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, formState, setValue, setFocus } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })
  const expired = (location.state as { expired?: boolean } | null)?.expired === true

  // A typed password never outlives the session that ends (sign-out in another tab, for one).
  useEffect(() => registerSensitiveReset(() => setValue('password', '')), [setValue])

  const onSubmit = handleSubmit(async ({ email, password }) => {
    if (countdown.active) return
    setFailure(null)
    setValue('password', '')
    const result = await login.submit(email, password)
    if (result.ok) return
    if (result.reason === 'blocked') {
      // The explanation page lives behind the signed-in guard; it never loops back here.
      void navigate(paths.overview, { replace: true })
      return
    }
    // "Too many attempts" is said once, by the countdown; anything else by the error banner.
    if (result.retryAfter) countdown.start(result.retryAfter)
    else setFailure(result.message)
    setFocus('password')
  })

  const busy = formState.isSubmitting || login.pending
  return (
    <AuthLayout aside={<WhySell />}>
      <AuthTitle title={copy.title} subtitle={copy.subtitle} />
      <Box component="form" noValidate onSubmit={onSubmit}>
        <Stack spacing={2.5}>
          {expired && !failure && <Banner tone="info" title={frameCopy.sessionEnded} />}
          {failure && <Banner tone="error" title={failure} />}
          {countdown.active && (
            <Banner
              tone="warning"
              title={
                <>
                  <Box component="span" sx={srOnly}>
                    {copy.waitAnnounced}
                  </Box>
                  <span aria-hidden="true">{copy.wait(countdown.remaining)}</span>
                </>
              }
            />
          )}
          <TextField label={copy.email} type="email" autoComplete="username" inputMode="email" {...fieldProps(register('email'), formState.errors.email)} />
          <PasswordField purpose="current" label={copy.password} {...fieldProps(register('password'), formState.errors.password)} />
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1 }}>
            <Link component={RouterLink} to={paths.forgotPassword} sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
              {copy.forgot}
            </Link>
          </Stack>
          <Button type="submit" variant="contained" size="large" fullWidth disabled={busy || countdown.active}>
            {busy ? copy.submitting : copy.submit}
          </Button>
        </Stack>
      </Box>
      <Divider sx={{ my: 3 }} />
      <Typography variant="body1" color="text.secondary">
        {copy.newHere}{' '}
        <Link component={RouterLink} to={paths.apply}>
          {copy.apply}
        </Link>
      </Typography>
    </AuthLayout>
  )
}
