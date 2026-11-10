import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography, useMediaQuery, useTheme } from '@mui/material'
import { Banner, fontFamily } from '@shazlo/ui'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { ApiError } from '../../api/http'
import { temporaryPassword, useCreateAdmin, useRoles } from '../../api/queries'
import { adminsCopy } from '../../copy/admins'
import { fieldProps } from '../../lib/forms'
import { CopyButton, CopyRow, RoleChecklist, type Admin } from './shared'

const copy = adminsCopy.inviteDialog
const errors = copy.errors
const touch = { minHeight: { xs: 44, md: 36 } }

const schema = z.object({
  display_name: z.string().trim().min(1, errors.nameRequired),
  email: z.string().trim().min(1, errors.emailRequired).email(errors.emailFormat),
  roles: z.array(z.string()).min(1, errors.rolesRequired),
  password: z.string(),
})
type Values = z.infer<typeof schema>
const FIELDS = ['display_name', 'email', 'roles'] as const

function InviteForm({ onCreated, onClose }: { onCreated: (admin: Admin, password: string) => void; onClose: () => void }) {
  const roles = useRoles()
  const create = useCreateAdmin()
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, control, setValue, setError, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { display_name: '', email: '', roles: [], password: temporaryPassword() },
  })
  const password = useWatch({ control, name: 'password' })

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null)
    try {
      const admin = await create.mutateAsync({ display_name: values.display_name.trim(), email: values.email.trim().toLowerCase(), roles: values.roles, password: values.password })
      onCreated(admin, values.password)
    } catch (error) {
      if (error instanceof ApiError) {
        const known = FIELDS.filter((f) => error.fields[f])
        known.forEach((f, i) => setError(f, { type: 'server', message: error.fields[f] }, { shouldFocus: i === 0 }))
        if (known.length === 0) setFailure(error.fields.password ?? error.message)
      } else setFailure(errors.generic)
    }
  })

  return (
    // A flex column, so on a full-screen phone dialog the fields scroll and the buttons stay in view.
    <Box component="form" noValidate onSubmit={onSubmit} sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          {copy.intro}
        </Typography>
        <Stack spacing={2.5}>
          {failure && <Banner tone="error" title={failure} />}
          <TextField label={copy.name} autoComplete="off" {...fieldProps(register('display_name'), formState.errors.display_name)} />
          <TextField label={copy.email} type="email" autoComplete="off" {...fieldProps(register('email'), formState.errors.email)} slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'none' } }} />
          <Controller
            control={control}
            name="roles"
            render={({ field, fieldState }) => <RoleChecklist roles={roles.data} value={field.value} onChange={field.onChange} error={fieldState.error?.message} firstRef={field.ref} />}
          />
          <Box>
            <TextField
              label={copy.password}
              value={password}
              fullWidth
              helperText={copy.passwordHint}
              slotProps={{ htmlInput: { readOnly: true, spellCheck: false, sx: { fontFamily: fontFamily.mono } } }}
            />
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <CopyButton text={password} label={copy.copyPassword} />
              <Button variant="text" size="small" onClick={() => setValue('password', temporaryPassword())} startIcon={<RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />} sx={{ minHeight: { xs: 44, md: 32 } }}>
                {copy.generate}
              </Button>
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="text" onClick={onClose} sx={touch}>
          {adminsCopy.cancel}
        </Button>
        <Button type="submit" variant="contained" disabled={formState.isSubmitting} sx={touch}>
          {formState.isSubmitting ? copy.submitting : copy.submit}
        </Button>
      </DialogActions>
    </Box>
  )
}

function Sent({ admin, password, onClose }: { admin: Admin; password: string; onClose: () => void }) {
  return (
    <>
      <DialogTitle>{copy.sentTitle(admin.display_name)}</DialogTitle>
      <DialogContent>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          {copy.sentBody}
        </Typography>
        <CopyRow label={copy.email} value={admin.email} copyLabel={copy.copyEmail} />
        <CopyRow label={copy.password} value={password} copyLabel={copy.copyPassword} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="contained" onClick={onClose} sx={touch}>
          {adminsCopy.done}
        </Button>
      </DialogActions>
    </>
  )
}

// Create, then a second step with the details to send; the dialog keeps the password until it closes.
export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sent, setSent] = useState<{ admin: Admin; password: string } | null>(null)
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })
  return (
    <Dialog open={open} onClose={onClose} fullWidth fullScreen={phone} maxWidth="sm" slotProps={{ transition: { onExited: () => setSent(null) } }}>
      {sent ? <Sent admin={sent.admin} password={sent.password} onClose={onClose} /> : <InviteForm onCreated={(admin, password) => setSent({ admin, password })} onClose={onClose} />}
    </Dialog>
  )
}
