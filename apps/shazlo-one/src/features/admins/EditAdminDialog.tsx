import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, TextField, Typography } from '@mui/material'
import { useId, useRef, useState, type FormEvent } from 'react'
import { api } from '../../api'
import type { components } from '../../api'
import { useConfirm } from '../../components/ConfirmDialog'
import { CountdownNotice } from '../../components/CountdownNotice'
import { useCountdown } from '../../hooks/useCountdown'
import { useSession } from '../../session/AuthProvider'
import { RoleCheckboxes, type RoleOption } from './formParts'
import { refusalOf, type Refusal, type Sent } from './refusals'
import { ResetPasswordDialog } from './ResetPasswordDialog'
import { checkEdit, DISPLAY_NAME_MAX, type Errors } from './rules'

type AdminOut = components['schemas']['AdminOut']

/** How long a role change takes to reach an admin's tokens (identity-api's access token lifetime). */
export const ROLE_CHANGE_DELAY = 'within 15 minutes'

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value) => b.includes(value))

interface Props {
  admin: AdminOut
  roles: readonly RoleOption[]
  /** The signed-in super admin is editing themselves. */
  isSelf: boolean
  onClose: () => void
  /** Something changed: the words to tell the super admin. The dialog closes. */
  onChanged: (message: string) => void
  /** The list is out of date (a refusal said so). */
  onStale: () => void
}

/**
 * Edits an admin: the name and the roles, deactivating and reactivating (with a confirmation that says their
 * sessions end at once), and resetting the password. Every refusal is shown in plain words next to the control
 * that caused it. A role change reaches the admin's tokens at their next token, within 15 minutes; when a super
 * admin edits themselves their session is refreshed at once, so they see their own new roles.
 */
export function EditAdminDialog({ admin, roles, isSelf, onClose, onChanged, onStale }: Props) {
  const formId = useId()
  const confirm = useConfirm()
  const session = useSession()
  const patch = api.useMutation('patch', '/v1/admins/{admin_id}', { gcTime: 0 })
  const countdown = useCountdown()
  const [displayName, setDisplayName] = useState(admin.display_name)
  const [chosen, setChosen] = useState<string[]>([...admin.roles])
  const [errors, setErrors] = useState<Errors>({})
  const [statusError, setStatusError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | undefined>()
  const [resetting, setResetting] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)

  const nameChanged = displayName.trim() !== admin.display_name
  const rolesChanged = !sameSet(chosen, admin.roles)

  const show = (refusal: Refusal) => {
    if (refusal.staleList) onStale()
    if (refusal.retryAfter) countdown.start(refusal.retryAfter)
    // The signed-in admin lost the super admin role: read the session again, which shows the 403 page.
    if (refusal.lostAccess) void session.renew()
    switch (refusal.control) {
      case 'status':
        return setStatusError(refusal.message)
      case 'form':
        return setFormError(refusal.message)
      default:
        setErrors({ [refusal.control]: refusal.message })
        if (refusal.control === 'displayName') nameInput.current?.focus()
    }
  }

  const clearMessages = () => {
    setErrors({})
    setStatusError(undefined)
    setFormError(undefined)
  }

  /** Sends a change; returns whether it was accepted. */
  async function send(body: components['schemas']['UpdateAdminRequest'], sent: Sent): Promise<boolean> {
    try {
      await patch.mutateAsync({ params: { path: { admin_id: admin.id } }, body })
      return true
    } catch (caught) {
      show(refusalOf(caught, sent))
      return false
    } finally {
      patch.reset()
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (patch.isPending || countdown.active || (!nameChanged && !rolesChanged)) return
    clearMessages()
    const problems = checkEdit({ displayName, roles: chosen })
    setErrors(problems)
    if (problems.displayName) return void nameInput.current?.focus()
    if (problems.roles) return
    const body = { ...(nameChanged ? { display_name: displayName.trim() } : {}), ...(rolesChanged ? { roles: chosen } : {}) }
    if (!(await send(body, { roles: rolesChanged }))) return
    if (isSelf && rolesChanged) {
      // Their own token still carries the old roles for up to 15 minutes: read the session again now.
      await session.renew()
    }
    const note = rolesChanged
      ? isSelf
        ? ' Your own roles were refreshed.'
        : ` The new roles reach their tokens at their next token, ${ROLE_CHANGE_DELAY}.`
      : ''
    onChanged(`Saved ${displayName.trim()}.${note}`)
  }

  async function toggleActive() {
    if (patch.isPending || countdown.active) return
    clearMessages()
    const deactivate = admin.is_active
    const agreed = await confirm(
      deactivate
        ? {
            title: `Deactivate ${admin.display_name}?`,
            message: `Their sessions end at once and they cannot sign in until you reactivate them.`,
            confirmLabel: 'Deactivate',
            destructive: true,
          }
        : {
            title: `Reactivate ${admin.display_name}?`,
            message: `They can sign in again with their current password. Their old sessions stay ended.`,
            confirmLabel: 'Reactivate',
          },
    )
    if (!agreed) return
    if (!(await send({ is_active: !deactivate }, { deactivate }))) return
    onChanged(
      deactivate
        ? `${admin.display_name} was deactivated. Their sessions ended at once.`
        : `${admin.display_name} was reactivated and can sign in again.`,
    )
  }

  return (
    <>
      <Dialog open onClose={patch.isPending ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby={`${formId}-title`}>
        <DialogTitle id={`${formId}-title`}>Edit {admin.display_name}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 2, overflowWrap: 'anywhere' }}>
            {admin.email}
            {isSelf ? ' (you)' : ''}
          </Typography>
          {formError ? (
            <Alert severity="error" role="alert" sx={{ mb: 2 }}>
              {formError}
            </Alert>
          ) : null}
          {countdown.active ? <CountdownNotice seconds={countdown.remaining} /> : null}

          <Box component="form" id={formId} noValidate onSubmit={save} aria-label="Edit admin">
            <Stack spacing={2}>
              <TextField
                label="Name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                error={errors.displayName !== undefined}
                helperText={errors.displayName}
                inputRef={nameInput}
                slotProps={{ htmlInput: { maxLength: DISPLAY_NAME_MAX } }}
                fullWidth
              />
              <RoleCheckboxes roles={roles} held={admin.roles} value={chosen} onChange={setChosen} error={errors.roles} />
              <Typography variant="body2" color="text.secondary">
                {isSelf
                  ? 'When you save, your own session is refreshed at once, so you see your new roles straight away.'
                  : `A role change reaches ${admin.display_name}'s tokens at their next token, ${ROLE_CHANGE_DELAY}.`}
              </Typography>
              <Box>
                <Button type="submit" variant="contained" disabled={patch.isPending || countdown.active || (!nameChanged && !rolesChanged)}>
                  {patch.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </Box>
            </Stack>
          </Box>

          <Divider sx={{ my: 3 }} />

          <Stack spacing={1} component="section" aria-labelledby={`${formId}-status`}>
            <Typography id={`${formId}-status`} component="h3" variant="subtitle1">
              Access: {admin.is_active ? 'active' : 'deactivated'}
            </Typography>
            {statusError ? (
              <Alert severity="error" role="alert">
                {statusError}
              </Alert>
            ) : null}
            <Box>
              <Button
                type="button"
                variant="outlined"
                color={admin.is_active ? 'error' : 'primary'}
                onClick={() => void toggleActive()}
                disabled={patch.isPending || countdown.active || (isSelf && admin.is_active)}
              >
                {admin.is_active ? 'Deactivate' : 'Reactivate'}
              </Button>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {isSelf && admin.is_active
                ? 'You cannot deactivate your own account. Ask another super admin.'
                : admin.is_active
                  ? 'Deactivating ends their sessions at once and stops them signing in.'
                  : 'They cannot sign in. Reactivating lets them sign in again with their current password.'}
            </Typography>
          </Stack>

          <Divider sx={{ my: 3 }} />

          <Stack spacing={1} component="section" aria-labelledby={`${formId}-password`}>
            <Typography id={`${formId}-password`} component="h3" variant="subtitle1">
              Password
            </Typography>
            <Box>
              <Button type="button" variant="outlined" onClick={() => setResetting(true)} disabled={patch.isPending}>
                Reset password…
              </Button>
            </Box>
            <Typography variant="body2" color="text.secondary">
              Sets a temporary password, ends all their sessions at once, and makes them choose a new one at their next sign-in.
              {admin.must_change_password ? ' They have not changed their current temporary password yet.' : ''}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={patch.isPending}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {resetting ? (
        <ResetPasswordDialog
          admin={admin}
          onClose={() => setResetting(false)}
          onStale={onStale}
          onDone={() =>
            onChanged(
              `The password of ${admin.display_name} was reset. Their sessions ended and they must choose a new password at their next sign-in. Hand the temporary password over safely: it is never emailed.`,
            )
          }
        />
      ) : null}
    </>
  )
}
