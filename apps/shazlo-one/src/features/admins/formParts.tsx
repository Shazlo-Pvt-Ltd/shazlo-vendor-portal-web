import { Box, Button, Checkbox, FormControl, FormControlLabel, FormGroup, FormHelperText, FormLabel, Typography } from '@mui/material'
import { useState } from 'react'
import { PasswordField } from '../../security/PasswordField'
import { LIMITS, PASSWORD_MIN_LENGTH } from '../../session/passwordRules'
import { generateTemporaryPassword } from './password'
import { roleLabel } from './rules'

export interface RoleOption {
  name: string
  description: string
}

/**
 * The roles that exist (from `GET /v1/roles`), each with its description so the choice is informed. A role the
 * admin already holds that is no longer in the list stays visible, so saving does not silently drop it.
 */
export function RoleCheckboxes({
  roles,
  held = [],
  value,
  onChange,
  error,
  disabled,
}: {
  roles: readonly RoleOption[]
  /** Roles the admin has now: shown even if the list no longer has them. */
  held?: readonly string[]
  value: readonly string[]
  onChange: (roles: string[]) => void
  error?: string | undefined
  disabled?: boolean
}) {
  const options: RoleOption[] = [...roles]
  for (const name of held) if (!options.some((option) => option.name === name)) options.push({ name, description: 'This role is no longer defined.' })
  return (
    <FormControl component="fieldset" error={error !== undefined} disabled={disabled} variant="standard" sx={{ width: '100%' }}>
      <FormLabel component="legend">Roles</FormLabel>
      <FormGroup>
        {options.map((option) => (
          <Box key={option.name}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={value.includes(option.name)}
                  onChange={(event) =>
                    onChange(event.target.checked ? [...value, option.name] : value.filter((name) => name !== option.name))
                  }
                />
              }
              label={roleLabel(option.name)}
            />
            <Typography variant="body2" color="text.secondary" sx={{ ml: 4, mt: -0.5, mb: 0.5 }}>
              {option.description}
            </Typography>
          </Box>
        ))}
      </FormGroup>
      {error ? <FormHelperText role="alert">{error}</FormHelperText> : null}
    </FormControl>
  )
}

/**
 * A temporary password the super admin types or generates. A generated one is shown, because it has to be read
 * once to be handed over. What is typed never leaves this field's owner's state after the call (the dialogs
 * clear it as they send), and the hint says what the password is for and how it must be passed on.
 */
export function TemporaryPasswordField({
  label,
  value,
  onChange,
  error,
  inputRef,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string | undefined
  inputRef?: React.Ref<HTMLInputElement>
  disabled?: boolean
}) {
  // A new key remounts the field, so a generated password starts shown.
  const [generations, setGenerations] = useState(0)
  return (
    <Box>
      <PasswordField
        key={generations}
        purpose="new"
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={error !== undefined}
        helperText={error ?? `At least ${PASSWORD_MIN_LENGTH} characters, and not the email address.`}
        initiallyVisible={generations > 0}
        inputRef={inputRef}
        disabled={disabled}
        slotProps={{ htmlInput: { maxLength: LIMITS.passwordMax } }}
        fullWidth
      />
      <Button
        type="button"
        size="small"
        sx={{ mt: 1 }}
        disabled={disabled}
        onClick={() => {
          onChange(generateTemporaryPassword())
          setGenerations((count) => count + 1)
        }}
      >
        Generate a password
      </Button>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        They must change it at their first sign-in. Hand it over in person or through a secure channel: it is never emailed.
      </Typography>
    </Box>
  )
}
