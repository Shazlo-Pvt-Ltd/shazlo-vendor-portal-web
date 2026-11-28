import { Box, Button, Card, Stack } from '@mui/material'
import { Banner, PageHeader } from '@shazlo/ui'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ApiError } from '../../api/errors'
import { useChangePassword } from '../../api/queries'
import { hubsCopy } from '../../copy/hubs'
import { checkPasswordChange, PASSWORD_MAX, PASSWORD_MIN, type PasswordChangeErrors, type PasswordChangeField } from '../../lib/account'
import { failureOf } from '../../lib/failure'
import { PasswordField } from '../../security/PasswordField'
import { registerSensitiveReset } from '../../security/sensitiveState'
import { useSession } from '../../session/AuthProvider'
import { useCountdown } from '../../session/useCountdown'
import { FORM_MAX_WIDTH } from '../../shell/layout'
import { WaitBanner } from '../auth/WaitBanner'
import { ignoreRepeatClick } from '../../lib/clicks'

const copy = hubsCopy.changePassword
const EMPTY: Record<PasswordChangeField, string> = { current: '', next: '', confirm: '' }
const ORDER: readonly PasswordChangeField[] = ['current', 'next', 'confirm']
const inputText = { '& .MuiInputBase-input': { fontSize: '1rem' } } as const
// Room for more than the rule allows, so a pasted password that is too long is named, not cut short.
const slotProps = { htmlInput: { maxLength: PASSWORD_MAX * 2 } }

/**
 * `/account/password` (main's AccountPage › Change password): the current password and the new one
 * twice. vendor-api ends every other session and answers with a new one, which the session takes
 * so this tab stays signed in. A wrong current password shows on that field.
 */
export default function ChangePassword() {
  const session = useSession()
  const change = useChangePassword()
  const wait = useCountdown()
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState<PasswordChangeErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const sending = useRef(false)
  const currentInput = useRef<HTMLInputElement>(null)
  const nextInput = useRef<HTMLInputElement>(null)
  const confirmInput = useRef<HTMLInputElement>(null)

  // Typed passwords never outlive the session.
  useEffect(() => registerSensitiveReset(() => setValues(EMPTY)), [])

  const focusFirst = (problems: PasswordChangeErrors) => {
    const first = ORDER.find((field) => problems[field])
    const input = { current: currentInput, next: nextInput, confirm: confirmInput }
    if (first) input[first].current?.focus()
  }

  function set(field: PasswordChangeField, value: string) {
    setValues((old) => ({ ...old, [field]: value }))
    if (errors[field]) setErrors((old) => ({ ...old, [field]: undefined }))
    setDone(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || wait.active) return
    setFailure(null)
    setDone(false)
    const problems = checkPasswordChange(values, session.user?.email)
    setErrors(problems)
    if (Object.values(problems).some(Boolean)) return focusFirst(problems)
    sending.current = true
    try {
      const fresh = await change.mutateAsync({ currentPassword: values.current, newPassword: values.next })
      // vendor-api ended every session, this one included, and started a new one: use it.
      session.signIn(fresh)
      setValues(EMPTY)
      setDone(true)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_current_password') {
        setValues((old) => ({ ...old, current: '' }))
        const next = { current: copy.wrongCurrent }
        setErrors(next)
        focusFirst(next)
      } else if (error instanceof ApiError && error.status === 422) {
        const next = error.fields.current_password ? { current: error.fields.current_password } : { next: error.fields.new_password ?? error.message }
        setErrors(next)
        focusFirst(next)
      } else {
        const { message, retryAfter } = failureOf(error)
        if (retryAfter) wait.start(retryAfter)
        else setFailure(message)
      }
    } finally {
      sending.current = false
      // A finished call keeps no copy of the passwords.
      change.reset()
    }
  }

  // What the three fields share.
  const props = (field: PasswordChangeField) => ({
    value: values[field],
    onChange: (event: ChangeEvent<HTMLInputElement>) => set(field, event.target.value),
    error: Boolean(errors[field]),
    fullWidth: true,
    sx: inputText,
    slotProps,
  })

  return (
    <Box sx={{ maxWidth: FORM_MAX_WIDTH }}>
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 3 }}>
        <Box component="form" noValidate onSubmit={(event) => void submit(event)} aria-label={copy.title}>
          {/* Lets a password manager tie the new password to the right account. */}
          <input type="text" name="username" autoComplete="username" value={session.user?.email ?? ''} readOnly hidden />
          <Stack spacing={2.5}>
            {done && <Banner tone="success" title={copy.done} />}
            {failure && <Banner tone="error" title={failure} />}
            {wait.active && <WaitBanner seconds={wait.remaining} />}
            <PasswordField purpose="current" label={copy.current} name="current_password" helperText={errors.current} inputRef={currentInput} {...props('current')} />
            <PasswordField purpose="new" label={copy.next} name="new_password" helperText={errors.next ?? copy.nextHint(PASSWORD_MIN)} inputRef={nextInput} {...props('next')} />
            <PasswordField purpose="new" label={copy.confirm} name="confirm_password" helperText={errors.confirm} inputRef={confirmInput} {...props('confirm')} />
            <Box>
              <Button type="submit" variant="contained" size="large" disabled={change.isPending || wait.active} onClick={ignoreRepeatClick} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}>
                {change.isPending ? copy.submitting : copy.submit}
              </Button>
            </Box>
          </Stack>
        </Box>
      </Card>
    </Box>
  )
}
