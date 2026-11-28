import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { api } from '../../api'
import type { components } from '../../api'
import { CountdownNotice } from '../../components/CountdownNotice'
import { useCountdown } from '../../hooks/useCountdown'
import { registerSensitiveReset } from '../../security/sensitiveState'
import { useSession } from '../../session/AuthProvider'
import { LIMITS } from '../../session/passwordRules'
import { RoleCheckboxes, TemporaryPasswordField, type RoleOption } from './formParts'
import { refusalOf, type Refusal } from './refusals'
import { checkCreate, DISPLAY_NAME_MAX, type Errors } from './rules'

type AdminOut = components['schemas']['AdminOut']

interface Props {
  roles: readonly RoleOption[]
  onClose: () => void
  onCreated: (admin: AdminOut) => void
  /** The list is out of date (a refusal said so). */
  onStale: () => void
}

/**
 * Creates an admin: email, name, roles and a temporary password. The admin is created with
 * `must_change_password`, so the password is theirs for one sign-in only; it is never emailed, and the dialog
 * says how it must be handed over. The password leaves this component's state the moment it is sent, whatever
 * the answer, and the mutation keeps no copy.
 */
export function CreateAdminDialog({ roles, onClose, onCreated, onStale }: Props) {
  const formId = useId()
  const session = useSession()
  const create = api.useMutation('post', '/v1/admins', { gcTime: 0 })
  const countdown = useCountdown()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | undefined>()
  const refs = { email: useRef<HTMLInputElement>(null), displayName: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null) }

  useEffect(() => registerSensitiveReset(() => setPassword('')), [])

  const show = (refusal: Refusal) => {
    if (refusal.staleList) onStale()
    if (refusal.retryAfter) countdown.start(refusal.retryAfter)
    // The signed-in admin lost the super admin role: read the session again, which shows the 403 page.
    if (refusal.lostAccess) void session.renew()
    if (refusal.control === 'form' || refusal.control === 'status') return setFormError(refusal.message)
    setErrors({ [refusal.control]: refusal.message })
    refs[refusal.control as 'email' | 'displayName' | 'password']?.current?.focus()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (create.isPending || countdown.active) return
    setFormError(undefined)
    const problems = checkCreate({ email, displayName, password, roles: chosen })
    setErrors(problems)
    const first = (['email', 'displayName', 'password'] as const).find((field) => problems[field])
    if (first) return void refs[first].current?.focus()
    if (problems.roles) return

    // The temporary password leaves state as it is sent, whatever the answer.
    const body = { email: email.trim(), display_name: displayName.trim(), password, roles: chosen }
    setPassword('')
    try {
      const created = await create.mutateAsync({ body })
      onCreated(created)
    } catch (caught) {
      show(refusalOf(caught))
    } finally {
      // The mutation object keeps what it was called with: drop it, or the password stays in the query cache.
      create.reset()
    }
  }

  return (
    <Dialog open onClose={create.isPending ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby={`${formId}-title`}>
      <DialogTitle id={`${formId}-title`}>Create an admin</DialogTitle>
      <DialogContent>
        {formError ? (
          <Alert severity="error" role="alert" sx={{ mb: 2 }}>
            {formError}
          </Alert>
        ) : null}
        {countdown.active ? <CountdownNotice seconds={countdown.remaining} /> : null}
        <Box component="form" id={formId} noValidate onSubmit={submit} aria-label="Create an admin" sx={{ pt: 1 }}>
          <Stack spacing={2}>
            <TextField
              label="Email address"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={errors.email !== undefined}
              helperText={errors.email}
              inputRef={refs.email}
              slotProps={{ htmlInput: { maxLength: LIMITS.email, inputMode: 'email' } }}
              fullWidth
            />
            <TextField
              label="Name"
              autoComplete="off"
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              error={errors.displayName !== undefined}
              helperText={errors.displayName}
              inputRef={refs.displayName}
              slotProps={{ htmlInput: { maxLength: DISPLAY_NAME_MAX } }}
              fullWidth
            />
            <RoleCheckboxes roles={roles} value={chosen} onChange={setChosen} error={errors.roles} />
            <TemporaryPasswordField
              label="Temporary password"
              value={password}
              onChange={setPassword}
              error={errors.password}
              inputRef={refs.password}
            />
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" form={formId} variant="contained" disabled={create.isPending || countdown.active}>
          {create.isPending ? 'Creating…' : 'Create admin'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
