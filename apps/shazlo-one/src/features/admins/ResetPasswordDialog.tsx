import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack } from '@mui/material'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { api } from '../../api'
import type { components } from '../../api'
import { CountdownNotice } from '../../components/CountdownNotice'
import { useConfirm } from '../../components/ConfirmDialog'
import { useCountdown } from '../../hooks/useCountdown'
import { registerSensitiveReset } from '../../security/sensitiveState'
import { useSession } from '../../session/AuthProvider'
import { TemporaryPasswordField } from './formParts'
import { refusalOf, type Refusal } from './refusals'
import { checkPassword } from './rules'

type AdminOut = components['schemas']['AdminOut']

interface Props {
  admin: AdminOut
  onClose: () => void
  onDone: () => void
  onStale: () => void
}

/**
 * Sets a temporary password for an admin: it ends all their sessions at once and they must choose a new
 * password at their next sign-in. A confirmation says so before anything is sent. The password leaves state as
 * it is sent, and the mutation keeps no copy.
 */
export function ResetPasswordDialog({ admin, onClose, onDone, onStale }: Props) {
  const formId = useId()
  const confirm = useConfirm()
  const session = useSession()
  const reset = api.useMutation('post', '/v1/admins/{admin_id}/reset-password', { gcTime: 0 })
  const countdown = useCountdown()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | undefined>()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => registerSensitiveReset(() => setPassword('')), [])

  const show = (refusal: Refusal) => {
    if (refusal.staleList) onStale()
    if (refusal.retryAfter) countdown.start(refusal.retryAfter)
    // The signed-in admin lost the super admin role: read the session again, which shows the 403 page.
    if (refusal.lostAccess) void session.renew()
    if (refusal.control === 'password') {
      setError(refusal.message)
      input.current?.focus()
    } else {
      setFormError(refusal.message)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (reset.isPending || countdown.active) return
    setFormError(undefined)
    const problem = checkPassword(password, admin.email)
    setError(problem)
    if (problem) return void input.current?.focus()

    const agreed = await confirm({
      title: `Reset ${admin.display_name}'s password?`,
      message: `Their current sessions end at once, and they must choose a new password at their next sign-in. Hand the temporary password over in person or through a secure channel: it is never emailed.`,
      confirmLabel: 'Reset password',
      destructive: true,
    })
    if (!agreed) return

    // The temporary password leaves state as it is sent, whatever the answer.
    const body = { new_password: password }
    setPassword('')
    try {
      await reset.mutateAsync({ params: { path: { admin_id: admin.id } }, body })
      onDone()
    } catch (caught) {
      show(refusalOf(caught))
    } finally {
      reset.reset()
    }
  }

  return (
    <Dialog open onClose={reset.isPending ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby={`${formId}-title`} slotProps={{ paper: { sx: { overflowWrap: 'anywhere' } } }}>
      <DialogTitle id={`${formId}-title`}>Reset the password of {admin.display_name}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          This sets a temporary password for {admin.email}, ends all their sessions at once, and makes them choose a new password the next time they sign in.
        </DialogContentText>
        {formError ? (
          <Alert severity="error" role="alert" sx={{ mb: 2 }}>
            {formError}
          </Alert>
        ) : null}
        {countdown.active ? <CountdownNotice seconds={countdown.remaining} /> : null}
        <Box component="form" id={formId} noValidate onSubmit={submit} aria-label="Reset password">
          <Stack spacing={2}>
            <TemporaryPasswordField label="New temporary password" value={password} onChange={setPassword} error={error} inputRef={input} />
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={reset.isPending}>
          Cancel
        </Button>
        <Button type="submit" form={formId} variant="contained" color="error" disabled={reset.isPending || countdown.active}>
          {reset.isPending ? 'Resetting…' : 'Reset password…'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
