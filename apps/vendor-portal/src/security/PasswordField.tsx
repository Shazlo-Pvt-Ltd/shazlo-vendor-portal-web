import { TextField, type TextFieldProps } from '@mui/material'

type Props = Omit<TextFieldProps, 'type' | 'autoComplete'> & {
  /**
   * `current` for signing in or confirming the old password; `new` when choosing one (signup, set
   * and change password). The browser's password manager relies on the right value.
   */
  purpose: 'current' | 'new'
}

/**
 * The only way to render a password input. It sets the right `autocomplete`, and switches off
 * autocapitalisation and spell-checking, which have no business near a password.
 */
export function PasswordField({ purpose, slotProps, ...rest }: Props) {
  return (
    <TextField
      {...rest}
      type="password"
      autoComplete={purpose === 'new' ? 'new-password' : 'current-password'}
      slotProps={{
        ...slotProps,
        htmlInput: { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, ...(slotProps?.htmlInput as object) },
      }}
    />
  )
}
