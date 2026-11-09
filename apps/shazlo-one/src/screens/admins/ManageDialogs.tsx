import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { Banner, useSnackbar } from '@shazlo/ui'
import { useRef, useState } from 'react'
import { ApiError } from '../../api/http'
import { temporaryPassword, useResetPassword, useRoles, useUpdateAdmin } from '../../api/queries'
import { adminsCopy } from '../../copy/admins'
import { CopyRow, RoleChecklist, type Admin } from './shared'

const touch = { minHeight: { xs: 44, md: 36 } }
const message = (error: unknown) => (error instanceof ApiError ? error.message : adminsCopy.inviteDialog.errors.generic)

export type DialogKind = 'roles' | 'reset' | 'deactivate'

function EditRoles({ admin, self, onClose }: { admin: Admin; self: boolean; onClose: () => void }) {
  const copy = adminsCopy.editRoles
  const roles = useRoles()
  const update = useUpdateAdmin()
  const notify = useSnackbar()
  const [value, setValue] = useState(admin.roles)
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)

  async function save() {
    setFailure(null)
    if (value.length === 0) {
      setError(adminsCopy.inviteDialog.errors.rolesRequired)
      firstRef.current?.focus()
      return
    }
    try {
      await update.mutateAsync({ id: admin.id, roles: value })
      notify(copy.saved)
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.fields.roles) setError(e.fields.roles)
      else setFailure(message(e))
    }
  }

  return (
    <>
      <DialogTitle>{copy.title(admin.display_name)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            {copy.intro}
          </Typography>
          {failure && <Banner tone="error" title={failure} />}
          <RoleChecklist
            roles={roles.data}
            value={value}
            onChange={(next) => {
              setValue(next)
              if (next.length) setError(null)
            }}
            locked={self && admin.roles.includes('super_admin') ? 'super_admin' : undefined}
            lockedNote={copy.selfSuper}
            error={error ?? undefined}
            firstRef={firstRef}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="text" onClick={onClose} sx={touch}>
          {adminsCopy.cancel}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={update.isPending} sx={touch}>
          {update.isPending ? copy.submitting : copy.submit}
        </Button>
      </DialogActions>
    </>
  )
}

function ResetPassword({ admin, onClose }: { admin: Admin; onClose: () => void }) {
  const copy = adminsCopy.reset
  const reset = useResetPassword()
  const [password, setPassword] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  async function confirm() {
    setFailure(null)
    const next = temporaryPassword()
    try {
      await reset.mutateAsync({ id: admin.id, password: next })
      setPassword(next)
    } catch (e) {
      setFailure(message(e))
    }
  }

  if (password)
    return (
      <>
        <DialogTitle>{copy.doneTitle(admin.display_name)}</DialogTitle>
        <DialogContent>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            {copy.doneBody}
          </Typography>
          <CopyRow label={adminsCopy.inviteDialog.email} value={admin.email} copyLabel={adminsCopy.inviteDialog.copyEmail} />
          <CopyRow label={adminsCopy.inviteDialog.password} value={password} copyLabel={adminsCopy.inviteDialog.copyPassword} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button variant="contained" onClick={onClose} sx={touch}>
            {adminsCopy.done}
          </Button>
        </DialogActions>
      </>
    )

  return (
    <>
      <DialogTitle>{copy.title(admin.display_name)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body1" color="text.secondary">
            {copy.body}
          </Typography>
          {failure && <Banner tone="error" title={failure} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="text" onClick={onClose} sx={touch}>
          {adminsCopy.cancel}
        </Button>
        <Button variant="contained" onClick={() => void confirm()} disabled={reset.isPending} sx={touch}>
          {reset.isPending ? copy.submitting : copy.submit}
        </Button>
      </DialogActions>
    </>
  )
}

function Deactivate({ admin, onClose }: { admin: Admin; onClose: () => void }) {
  const copy = adminsCopy.deactivate
  const update = useUpdateAdmin()
  const notify = useSnackbar()
  const [failure, setFailure] = useState<string | null>(null)

  async function confirm() {
    setFailure(null)
    try {
      await update.mutateAsync({ id: admin.id, is_active: false })
      notify(copy.done(admin.display_name))
      onClose()
    } catch (e) {
      setFailure(message(e))
    }
  }

  return (
    <>
      <DialogTitle>{copy.title(admin.display_name)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body1" color="text.secondary">
            {copy.body}
          </Typography>
          {failure && <Banner tone="error" title={failure} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="text" onClick={onClose} sx={touch}>
          {adminsCopy.cancel}
        </Button>
        <Button variant="contained" onClick={() => void confirm()} disabled={update.isPending} sx={touch}>
          {update.isPending ? copy.submitting : copy.submit}
        </Button>
      </DialogActions>
    </>
  )
}

// One dialog host; it keeps the last admin while closing so the content does not blank mid-fade.
export function ManageDialog({ target, selfId, onClose, onExited }: { target: { kind: DialogKind; admin: Admin; open: boolean } | null; selfId: string | undefined; onClose: () => void; onExited: () => void }) {
  return (
    <Dialog open={Boolean(target?.open)} onClose={onClose} fullWidth maxWidth="sm" slotProps={{ transition: { onExited } }}>
      {target?.kind === 'roles' && <EditRoles admin={target.admin} self={target.admin.id === selfId} onClose={onClose} />}
      {target?.kind === 'reset' && <ResetPassword admin={target.admin} onClose={onClose} />}
      {target?.kind === 'deactivate' && <Deactivate admin={target.admin} onClose={onClose} />}
    </Dialog>
  )
}
