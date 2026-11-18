import { Button, InputAdornment, TextField, type TextFieldProps } from '@mui/material'
import { useState } from 'react'

type Props = Omit<TextFieldProps, 'type' | 'autoComplete'> & {
  /**
   * `current` for signing in or confirming the old password; `new` when choosing one (signup, set
   * and change password). The browser's password manager relies on the right value.
   */
  purpose: 'current' | 'new'
}

/**
 * The only way to render a password input. It sets the right `autocomplete`, switches off
 * autocapitalisation and spell-checking, lets the user show what they typed (a toggle that is
 * announced as pressed) and never blocks pasting, which password managers rely on.
 */
export function PasswordField({ purpose, slotProps, ...rest }: Props) {
  const [visible, setVisible] = useState(false)
  return (
    <TextField
      {...rest}
      type={visible ? 'text' : 'password'}
      autoComplete={purpose === 'new' ? 'new-password' : 'current-password'}
      slotProps={{
        ...slotProps,
        input: {
          ...(slotProps?.input as object),
          endAdornment: (
            <InputAdornment position="end">
              <Button
                type="button"
                size="small"
                aria-pressed={visible}
                aria-label={visible ? 'Hide password' : 'Show password'}
                onClick={() => setVisible((current) => !current)}
              >
                {visible ? 'Hide' : 'Show'}
              </Button>
            </InputAdornment>
          ),
        },
        htmlInput: { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, ...(slotProps?.htmlInput as object) },
      }}
    />
  )
}
