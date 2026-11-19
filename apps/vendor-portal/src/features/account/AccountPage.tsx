import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../../api'
import { ApiError } from '../../api/errors'
import { PasswordField } from '../../security/PasswordField'
import { registerSensitiveReset } from '../../security/sensitiveState'
import { useSession } from '../../session/AuthProvider'
import { PageHeader } from '../../ui'
import { CountdownNotice } from '../auth/CountdownNotice'
import { friendlyError } from '../errors'
import { LIMITS, PASSWORD_MIN_LENGTH } from '../signup/rules'
import { checkPasswords, type Errors, type Field } from './rules'
import { useCountdown } from '../signup/useCountdown'
import { roleLabel } from '../team/rules'
import { exactTime } from '../time'

const VENDOR_STATUS: Record<string, string> = {
  pending: 'In review: our team is checking your application',
  approved: 'Approved',
  rejected: 'Not approved',
  suspended: 'Suspended',
}

function ChangePassword() {
  const session = useSession()
  const change = api.useMutation('post', '/v1/auth/change-password', { gcTime: 0 })
  const countdown = useCountdown()
  const [values, setValues] = useState<Record<Field, string>>({ current: '', next: '', confirm: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | undefined>()
  const [done, setDone] = useState(false)
  const refs = { current: useRef<HTMLInputElement>(null), next: useRef<HTMLInputElement>(null), confirm: useRef<HTMLInputElement>(null) }

  useEffect(() => registerSensitiveReset(() => setValues({ current: '', next: '', confirm: '' })), [])

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
    try {
      const fresh = await change.mutateAsync({ body: { current_password: values.current, new_password: values.next } })
      // The API ended every session, this one included, and started a new one: use it.
      session.signIn(fresh)
      setValues({ current: '', next: '', confirm: '' })
      setDone(true)
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'invalid_current_password') {
        setValues((old) => ({ ...old, current: '' }))
        const next = { current: 'This is not your current password.' }
        setErrors(next)
        focus(next)
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
        setFormError(friendly.message)
        if (friendly.retryAfter) countdown.start(friendly.retryAfter)
      }
    } finally {
      // A finished call keeps no copy of the passwords (the mutation's variables).
      change.reset()
    }
  }

  return (
    <Paper component="section" variant="outlined" aria-labelledby="password-heading" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography id="password-heading" component="h2" variant="h6" gutterBottom>
        Change your password
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        At least {PASSWORD_MIN_LENGTH} characters. Changing it signs you out on every other device and browser; you stay signed in here.
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
      <Box component="form" noValidate onSubmit={submit} aria-label="Change your password" sx={{ maxWidth: 440 }}>
        {/* Lets a password manager tie the new password to the right account. */}
        <input type="text" name="username" autoComplete="username" value={session.user?.email ?? ''} readOnly hidden />
        <Stack spacing={2}>
          <PasswordField
            purpose="current"
            label="Current password"
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
              {change.isPending ? 'Changing…' : 'Change password'}
            </Button>
          </Box>
        </Stack>
      </Box>
    </Paper>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography component="dt" variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  )
}

/** `/account`: who is signed in (from the session) and changing the password. */
export default function AccountPage() {
  const { user, vendor, role } = useSession()
  return (
    <>
      <PageHeader title="Account" description="Your sign-in details and password." />
      <Stack spacing={3}>
        <Paper component="section" variant="outlined" aria-labelledby="profile-heading" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography id="profile-heading" component="h2" variant="h6" gutterBottom>
            Your profile
          </Typography>
          <Box component="dl" sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, m: 0 }}>
            <Detail label="Email">{user?.email ?? '—'}</Detail>
            <Detail label="Role">{role ? `${roleLabel(role)}${role === 'owner' ? ' (manages the team)' : ''}` : '—'}</Detail>
            <Detail label="Vendor">{vendor?.name ?? '—'}</Detail>
            <Detail label="Vendor status">{vendor ? (VENDOR_STATUS[vendor.status] ?? vendor.status) : '—'}</Detail>
            <Detail label="Last sign-in">{user?.last_login_at ? exactTime(user.last_login_at) : '—'}</Detail>
          </Box>
        </Paper>
        <ChangePassword />
      </Stack>
    </>
  )
}
