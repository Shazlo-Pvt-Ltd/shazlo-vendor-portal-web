import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api } from '../api'
import { ApiError } from '../api/errors'
import { friendlyError } from '../api/friendlyError'
import { CountdownNotice } from '../components/CountdownNotice'
import { useCountdown } from '../hooks/useCountdown'
import { usePageTitle } from '../hooks/usePageTitle'
import { PasswordField } from '../security/PasswordField'
import { registerSensitiveReset } from '../security/sensitiveState'
import { useSession } from '../session/AuthProvider'
import { LIMITS, PASSWORD_MIN_LENGTH, checkPasswords, type Errors, type Field } from '../session/passwordRules'
import { safeReturnTo } from '../session/returnTo'
import { isSessionResponse } from '../session/store'

const EMPTY: Record<Field, string> = { current: '', next: '', confirm: '' }

/**
 * Two uses of one form. An admin who must change their password (a new account, or a reset by a
 * super admin) sees "Choose your password", can reach nothing else, and afterwards continues to
 * where they were going. Any other admin reaches it from the account menu to change it later. Either
 * way the API ends every other session and returns a new one, which the shell adopts.
 */
export function ChangePasswordPage() {
  const session = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const forced = session.status === 'passwordChangeRequired'
  usePageTitle(forced ? 'Choose your password' : 'Change password')
  const change = api.useMutation('post', '/v1/auth/change-password', { gcTime: 0 })
  const countdown = useCountdown()
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | undefined>()
  const [done, setDone] = useState(false)
  const refs = { current: useRef<HTMLInputElement>(null), next: useRef<HTMLInputElement>(null), confirm: useRef<HTMLInputElement>(null) }

  useEffect(() => registerSensitiveReset(() => setValues(EMPTY)), [])

  const focus = (problems: Errors) => {
    const first = (['current', 'next', 'confirm'] as const).find((field) => problems[field])
    if (first) refs[first].current?.focus()
  }

  function set(field: Field, value: string) {
    setValues((old) => ({ ...old, [field]: value }))
    if (errors[field]) setErrors((old) => ({ ...old, [field]: undefined }))
    setDone(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (change.isPending || countdown.active) return
    setFormError(undefined)
    setDone(false)
    const problems = checkPasswords(values)
    setErrors(problems)
    if (Object.keys(problems).length > 0) return focus(problems)
    // The passwords leave component state the moment they are sent, whatever the answer.
    const body = { current_password: values.current, new_password: values.next }
    setValues(EMPTY)
    try {
      const fresh = await change.mutateAsync({ body })
      if (!isSessionResponse(fresh)) {
        setFormError('Something went wrong on our side. Please try again in a moment.')
        return
      }
      // The API ended every session, this one included, and started a new one: use it.
      session.signIn(fresh)
      if (forced) {
        void navigate(safeReturnTo(params.get('return-to')), { replace: true })
      } else {
        setDone(true)
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'invalid_current_password') {
        const next = { current: 'This is not your current password.' }
        setErrors(next)
        focus(next)
      } else if (caught instanceof ApiError && caught.status === 401) {
        // The session behind the call is gone (another password change or a deactivation finished
        // first) or its token ran out; `/v1/auth/*` is never renewed on its own. Check it again:
        // the guards then show the login screen, or this step with a fresh token.
        void session.retry()
      } else if (caught instanceof ApiError && caught.status === 422) {
        const message = caught.fieldErrors.new_password ?? (caught.code === 'weak_password' ? caught.message : undefined)
        if (message) {
          const next = { next: message }
          setErrors(next)
          focus(next)
        } else {
          setFormError(caught.fieldErrors.current_password ?? caught.message)
        }
      } else {
        const friendly = friendlyError(caught)
        // A wait has its own notice, which goes away when the wait is over.
        if (friendly.retryAfter) countdown.start(friendly.retryAfter)
        else setFormError(friendly.message)
      }
    } finally {
      // A finished call keeps no copy of the passwords (the mutation's variables).
      change.reset()
    }
  }

  const title = forced ? 'Choose your password' : 'Change your password'
  return (
    <Box component="main" sx={{ p: 2, maxWidth: 520, mx: 'auto', mt: { xs: 2, sm: 6 }, minWidth: 0 }}>
      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
        {title}
      </Typography>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {forced
            ? `You signed in with a password someone else set. Choose your own to continue. Use at least ${PASSWORD_MIN_LENGTH} characters.`
            : `At least ${PASSWORD_MIN_LENGTH} characters. Changing it signs you out on every other device and browser; you stay signed in here.`}
        </Typography>
        {done ? (
          <Alert severity="success" role="status" sx={{ mb: 2 }}>
            Your password is changed. You have been signed out everywhere else.
          </Alert>
        ) : null}
        {formError ? (
          <Alert severity="error" role="alert" sx={{ mb: 2 }}>
            {formError}
          </Alert>
        ) : null}
        {countdown.active ? <CountdownNotice seconds={countdown.remaining} /> : null}
        <Box component="form" noValidate onSubmit={submit} aria-label={title}>
          {/* Lets a password manager tie the new password to the right account. */}
          <input type="text" name="username" autoComplete="username" value={session.admin?.email ?? ''} readOnly hidden />
          <Stack spacing={2}>
            <PasswordField
              purpose="current"
              label={forced ? 'Current (temporary) password' : 'Current password'}
              inputRef={refs.current}
              value={values.current}
              onChange={(event) => set('current', event.target.value)}
              error={errors.current !== undefined}
              helperText={errors.current}
              slotProps={{ htmlInput: { maxLength: LIMITS.passwordMax } }}
            />
            <PasswordField
              purpose="new"
              label="New password"
              inputRef={refs.next}
              value={values.next}
              onChange={(event) => set('next', event.target.value)}
              error={errors.next !== undefined}
              helperText={errors.next ?? `At least ${PASSWORD_MIN_LENGTH} characters. A few unrelated words work well.`}
              slotProps={{ htmlInput: { maxLength: LIMITS.passwordMax } }}
            />
            <PasswordField
              purpose="new"
              label="Repeat the new password"
              inputRef={refs.confirm}
              value={values.confirm}
              onChange={(event) => set('confirm', event.target.value)}
              error={errors.confirm !== undefined}
              helperText={errors.confirm}
              slotProps={{ htmlInput: { maxLength: LIMITS.passwordMax } }}
            />
            <Box>
              <Button type="submit" variant="contained" disabled={change.isPending || countdown.active}>
                {change.isPending ? 'Saving…' : forced ? 'Save and continue' : 'Change password'}
              </Button>
            </Box>
          </Stack>
        </Box>
      </Paper>
    </Box>
  )
}
