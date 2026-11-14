import { Alert, Box, Button, Link as MuiLink, Stack, Typography } from '@mui/material'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '../../api'
import { ApiError } from '../../api/errors'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PasswordField } from '../../security/PasswordField'
import { registerSensitiveReset } from '../../security/sensitiveState'
import { friendlyError } from '../errors'
import { LIMITS, PASSWORD_MIN_LENGTH } from '../signup/rules'
import { useCountdown } from '../signup/useCountdown'
import { CountdownNotice } from './CountdownNotice'

type Stage = 'form' | 'saved' | 'invalid'

/**
 * `/set-password?token=…`: where an emailed invite or reset link lands. The token is read once into
 * memory and removed from the address bar and the history at once; it is a credential until spent.
 */
export function SetPasswordPage() {
  usePageTitle('Set your password')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [token] = useState(() => params.get('token')?.trim() ?? '')
  const [stage, setStage] = useState<Stage>(token === '' ? 'invalid' : 'form')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [formError, setFormError] = useState<string | undefined>()
  const countdown = useCountdown()
  const setPasswordCall = api.useMutation('post', '/v1/auth/set-password')
  const passwordInput = useRef<HTMLInputElement>(null)
  const confirmInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (token !== '') void navigate('/set-password', { replace: true })
  }, []) // once per page load

  useEffect(
    () =>
      registerSensitiveReset(() => {
        setPassword('')
        setConfirm('')
      }),
    [],
  )

  useEffect(() => {
    if (stage !== 'form') heading.current?.focus()
  }, [stage])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (setPasswordCall.isPending || countdown.active) return
    const problems: { password?: string; confirm?: string } = {}
    if (password === '') problems.password = 'Choose a password.'
    else if (password.length < PASSWORD_MIN_LENGTH) problems.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`
    else if (password.length > LIMITS.passwordMax) problems.password = `Use at most ${LIMITS.passwordMax} characters.`
    if (confirm !== password) problems.confirm = 'The two passwords do not match.'
    setErrors(problems)
    setFormError(undefined)
    if (problems.password) return void passwordInput.current?.focus()
    if (problems.confirm) return void confirmInput.current?.focus()

    try {
      await setPasswordCall.mutateAsync({ body: { token, password } })
      setPassword('')
      setConfirm('')
      setStage('saved')
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 400) {
        setPassword('')
        setConfirm('')
        setStage('invalid')
        return
      }
      if (caught instanceof ApiError && caught.status === 422) {
        const message = caught.fieldErrors.password ?? (caught.code === 'weak_password' ? caught.message : undefined)
        if (message) {
          setErrors({ password: message })
          passwordInput.current?.focus()
        } else {
          setFormError(caught.message)
        }
        return
      }
      const friendly = friendlyError(caught)
      setFormError(friendly.message)
      if (friendly.retryAfter) countdown.start(friendly.retryAfter)
    }
  }

  if (stage === 'saved') {
    return (
      <Box component="main" sx={{ p: 2, maxWidth: 440, mx: 'auto', mt: { xs: 2, sm: 8 } }}>
        <Typography component="h1" variant="h4" gutterBottom tabIndex={-1} ref={heading}>
          Your password is saved
        </Typography>
        <Typography sx={{ mb: 3 }}>Sign in with your new password.</Typography>
        <Button component={Link} to="/login" variant="contained" size="large">
          Sign in
        </Button>
      </Box>
    )
  }

  if (stage === 'invalid') {
    return (
      <Box component="main" sx={{ p: 2, maxWidth: 440, mx: 'auto', mt: { xs: 2, sm: 8 } }}>
        <Typography component="h1" variant="h4" gutterBottom tabIndex={-1} ref={heading}>
          This link has expired or was already used
        </Typography>
        <Typography sx={{ mb: 2 }}>
          Invite and reset links work once and expire after a while. Ask for a new reset link, or sign in if you already
          chose a password.
        </Typography>
        <Stack direction="row" spacing={2}>
          <Button component={Link} to="/forgot-password" variant="contained">
            Send a new link
          </Button>
          <Button component={Link} to="/login" variant="outlined">
            Sign in
          </Button>
        </Stack>
      </Box>
    )
  }

  return (
    <Box component="main" sx={{ p: 2, maxWidth: 440, mx: 'auto', mt: { xs: 2, sm: 8 }, minWidth: 0 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        Set your password
      </Typography>
      <Typography sx={{ mb: 2 }}>Choose a password for your vendor account.</Typography>
      {formError ? (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          {formError}
        </Alert>
      ) : null}
      {countdown.active ? <CountdownNotice seconds={countdown.remaining} /> : null}
      <Box component="form" onSubmit={submit} noValidate aria-label="Set your password">
        <Stack spacing={2}>
          <PasswordField
            purpose="new"
            label="New password"
            name="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password !== undefined}
            helperText={errors.password ?? `At least ${PASSWORD_MIN_LENGTH} characters.`}
            inputRef={passwordInput}
            fullWidth
          />
          <PasswordField
            purpose="new"
            label="Confirm new password"
            name="confirm_password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            error={errors.confirm !== undefined}
            helperText={errors.confirm}
            inputRef={confirmInput}
            fullWidth
          />
          <Button type="submit" variant="contained" size="large" disabled={setPasswordCall.isPending || countdown.active}>
            {setPasswordCall.isPending ? 'Saving…' : 'Save password'}
          </Button>
        </Stack>
      </Box>
      <Typography sx={{ mt: 3 }}>
        <MuiLink component={Link} to="/login">
          Back to sign in
        </MuiLink>
      </Typography>
    </Box>
  )
}
