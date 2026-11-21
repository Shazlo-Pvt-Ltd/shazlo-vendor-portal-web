import { Box, Button, Divider, Link, Stack } from '@mui/material'
import { Banner, EmptyIllustration } from '@shazlo/ui'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../../api/errors'
import { useAcceptInvite, useSetPassword } from '../../api/queries'
import { paths } from '../../app/paths'
import { onboardingCopy } from '../../copy/onboarding'
import { checkPasswordPair, PASSWORD_MAX, PASSWORD_MIN } from '../../lib/account'
import { failureOf } from '../../lib/failure'
import { linkToken } from '../../lib/linkToken'
import { PasswordField } from '../../security/PasswordField'
import { registerSensitiveReset } from '../../security/sensitiveState'
import { useCountdown } from '../../session/useCountdown'
import { AuthLayout, AuthTitle } from './AuthLayout'
import { withNotice } from './notice'
import { WaitBanner } from './WaitBanner'
import { ignoreRepeatClick } from '../../lib/clicks'

const copy = onboardingCopy.setPassword

const INVITE_PATH = '/accept-invite'
const inputText = { '& .MuiInputBase-input': { fontSize: '1rem' } } as const
// Room for more than the rule allows, so a pasted password that is too long is named, not cut short.
const htmlInput = { maxLength: PASSWORD_MAX * 2 }

function LinkExpired({ invite }: { invite: boolean }) {
  const e = copy.expired
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  return (
    <Stack sx={{ alignItems: 'center', textAlign: 'center' }}>
      <Box sx={{ mb: 2 }}>
        <EmptyIllustration name="clock" />
      </Box>
      <AuthTitle headingRef={heading} title={e.title} subtitle={invite ? e.invite : e.reset} />
      {invite ? (
        <Button variant="contained" size="large" component={RouterLink} to={paths.signIn} sx={{ minHeight: 44 }}>
          {e.signIn}
        </Button>
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          <Button variant="contained" size="large" component={RouterLink} to={paths.forgotPassword} sx={{ minHeight: 44 }}>
            {e.newLink}
          </Button>
          <Button variant="outlined" size="large" component={RouterLink} to={paths.signIn} sx={{ minHeight: 44 }}>
            {e.signIn}
          </Button>
        </Stack>
      )}
    </Stack>
  )
}

/**
 * Where an emailed reset or invite link lands: `/reset-password#token=…`, `/accept-invite#token=…`
 * (vendor-api's links) or `/set-password` (main's SetPasswordPage). The token is read once into
 * memory and removed from the address bar and the history at once. Saving does not sign in
 * (vendor-api ends every session of the user): the seller goes to sign in, with a notice there.
 * vendor-api has no route that says who an invite is for, so the page greets nobody by name.
 */
export default function SetPassword() {
  const location = useLocation()
  const navigate = useNavigate()
  const invite = location.pathname === INVITE_PATH
  const [token] = useState(() => linkToken(location))
  const [expired, setExpired] = useState(token === '')
  const [values, setValues] = useState({ password: '', confirm: '' })
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const wait = useCountdown()
  const resetCall = useSetPassword()
  const inviteCall = useAcceptInvite()
  const call = invite ? inviteCall : resetCall
  const sending = useRef(false)
  const passwordInput = useRef<HTMLInputElement>(null)
  const confirmInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // The same path, so this page (and the token it holds) stays.
    if (location.hash !== '' || location.search !== '') void navigate(location.pathname, { replace: true })
    // Once per page load.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // A typed password never outlives the session.
  useEffect(() => registerSensitiveReset(() => setValues({ password: '', confirm: '' })), [])

  function set(field: 'password' | 'confirm', value: string) {
    setValues((old) => ({ ...old, [field]: value }))
    if (errors[field]) setErrors((old) => ({ ...old, [field]: undefined }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || wait.active) return
    setFailure(null)
    const problems = checkPasswordPair(values.password, values.confirm)
    setErrors(problems)
    if (problems.password) return void passwordInput.current?.focus()
    if (problems.confirm) return void confirmInput.current?.focus()
    sending.current = true
    try {
      await call.mutateAsync({ token, password: values.password })
      setValues({ password: '', confirm: '' })
      void navigate(paths.signIn, { replace: true, state: withNotice(copy.saved) })
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.status === 404 || (error.status === 422 && error.fields.token))) {
        setValues({ password: '', confirm: '' })
        setExpired(true)
      } else if (error instanceof ApiError && error.status === 422) {
        setErrors({ password: error.fields.password ?? error.message })
        passwordInput.current?.focus()
      } else {
        const { message, retryAfter } = failureOf(error)
        if (retryAfter) wait.start(retryAfter)
        else setFailure(message)
      }
    } finally {
      sending.current = false
      // A finished call keeps no copy of the token and the password.
      call.reset()
    }
  }

  if (expired) {
    return (
      <AuthLayout>
        <LinkExpired invite={invite} />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <AuthTitle title={copy.title} subtitle={invite ? copy.inviteSubtitle : copy.subtitle} />
      <Box component="form" noValidate onSubmit={(event) => void submit(event)} aria-label={copy.title}>
        <Stack spacing={2.5}>
          {failure && <Banner tone="error" title={failure} />}
          {wait.active && <WaitBanner seconds={wait.remaining} />}
          <PasswordField
            purpose="new"
            label={copy.password}
            name="password"
            inputRef={passwordInput}
            value={values.password}
            onChange={(event) => set('password', event.target.value)}
            error={Boolean(errors.password)}
            helperText={errors.password ?? copy.passwordHint(PASSWORD_MIN)}
            fullWidth
            sx={inputText}
            slotProps={{ htmlInput }}
          />
          <PasswordField
            purpose="new"
            label={copy.confirm}
            name="confirm_password"
            inputRef={confirmInput}
            value={values.confirm}
            onChange={(event) => set('confirm', event.target.value)}
            error={Boolean(errors.confirm)}
            helperText={errors.confirm}
            fullWidth
            sx={inputText}
            slotProps={{ htmlInput }}
          />
          <Button type="submit" variant="contained" size="large" fullWidth disabled={call.isPending || wait.active} onClick={ignoreRepeatClick} sx={{ minHeight: 44 }}>
            {call.isPending ? copy.submitting : copy.submit}
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
