import { Box, Button, Checkbox, FormControlLabel, FormHelperText, Skeleton, Stack, Typography } from '@mui/material'
import { brand, neutral, radius, StatusPill, useSnackbar } from '@shazlo/ui'
import { Copy } from 'lucide-react'
import { useCallback, useId, type Ref } from 'react'
import type { components } from '../../api/identity'
import { adminsCopy as copy } from '../../copy/admins'

export type Admin = components['schemas']['Admin']
export type Role = components['schemas']['Role']

export const roleName = (role: string) => copy.roleNames[role] ?? role

// Roles are not statuses, so they get a quiet outlined tag rather than a StatusPill.
export function RolePill({ role }: { role: string }) {
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', height: 22, px: 1, borderRadius: `${radius.pill}px`, border: `1px solid ${neutral.line}`, bgcolor: neutral.surface, color: neutral.ink, typography: 'caption', lineHeight: 1, whiteSpace: 'nowrap' }}
    >
      {roleName(role)}
    </Box>
  )
}

export function AdminStatus({ admin }: { admin: Admin }) {
  if (!admin.is_active) return <StatusPill status="archived" label={copy.status.inactive} />
  if (admin.must_change_password) return <StatusPill status="pending" label={copy.status.invited} />
  return <StatusPill status="live" label={copy.status.active} />
}

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

export function useCopyText() {
  const notify = useSnackbar()
  return useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        notify(copy.copied)
      } catch {
        notify(copy.copyFailed)
      }
    },
    [notify],
  )
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const copyText = useCopyText()
  return (
    <Button variant="outlined" size="small" aria-label={label} onClick={() => void copyText(text)} startIcon={<Copy size={16} strokeWidth={1.5} aria-hidden="true" />} sx={{ minHeight: { xs: 44, md: 32 }, flexShrink: 0, bgcolor: 'background.paper' }}>
      {copy.copy}
    </Button>
  )
}

// A value to read aloud or paste: shown in mono, with its own Copy button.
export function CopyRow({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', py: 1.5, borderTop: `1px solid ${neutral.line}` }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="mono" component="p" sx={{ fontSize: '1rem', color: neutral.ink, overflowWrap: 'anywhere', userSelect: 'all' }}>
          {value}
        </Typography>
      </Box>
      <CopyButton text={value} label={copyLabel} />
    </Stack>
  )
}

// One checkbox per role with its description underneath (the description is not part of the name).
export function RoleChecklist({
  roles,
  value,
  onChange,
  locked,
  lockedNote,
  error,
  firstRef,
}: {
  roles: Role[] | undefined
  value: string[]
  onChange: (next: string[]) => void
  locked?: string
  lockedNote?: string
  error?: string
  firstRef?: Ref<HTMLInputElement>
}) {
  const legendId = useId()
  const errorId = useId()
  const base = useId()
  return (
    <Box component="fieldset" aria-describedby={error ? errorId : undefined} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
      <Typography component="legend" id={legendId} variant="body2" color="text.secondary" sx={{ mb: 0.5, p: 0 }}>
        {copy.inviteDialog.roles}
      </Typography>
      {!roles ? (
        <Box role="status" aria-label={copy.inviteDialog.rolesLoading}>
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="text" width="80%" />
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="text" width="80%" />
        </Box>
      ) : (
        <Stack spacing={1}>
          {roles.map((role, i) => {
            const descId = `${base}-${role.name}`
            const checked = value.includes(role.name)
            const isLocked = locked === role.name
            return (
              <Box key={role.name}>
                <FormControlLabel
                  label={roleName(role.name)}
                  disabled={isLocked}
                  sx={{ mr: 0, '& .MuiFormControlLabel-label.Mui-disabled': { color: neutral.ink } }}
                  control={
                    <Checkbox
                      checked={checked}
                      onChange={(event) => onChange(event.target.checked ? roles.filter((r) => r.name === role.name || value.includes(r.name)).map((r) => r.name) : value.filter((v) => v !== role.name))}
                      slotProps={{ input: { ref: i === 0 ? firstRef : undefined, 'aria-describedby': descId, 'aria-invalid': error ? true : undefined } as object }}
                    />
                  }
                />
                <Typography id={descId} variant="body2" color="text.secondary" sx={{ pl: 4, mt: -0.5, maxWidth: '60ch' }}>
                  {role.description}
                  {isLocked && lockedNote && (
                    <Box component="span" sx={{ display: 'block', color: brand.brown, mt: 0.25 }}>
                      {lockedNote}
                    </Box>
                  )}
                </Typography>
              </Box>
            )
          })}
        </Stack>
      )}
      {error && (
        <FormHelperText id={errorId} error sx={{ mx: 0, mt: 1 }}>
          {error}
        </FormHelperText>
      )}
    </Box>
  )
}
