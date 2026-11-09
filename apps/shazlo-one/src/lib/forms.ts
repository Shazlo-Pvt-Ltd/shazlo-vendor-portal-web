import type { FieldError, UseFormRegisterReturn } from 'react-hook-form'

// Connects a React Hook Form field to an MUI TextField: the ref goes to the <input> (so focus
// moves to the first invalid field) and the error becomes the field's described-by text.
export function fieldProps(registration: UseFormRegisterReturn, error?: FieldError, hint?: string) {
  const { ref, ...rest } = registration
  return {
    ...rest,
    inputRef: ref,
    error: Boolean(error),
    helperText: error?.message ?? hint,
    fullWidth: true,
  }
}
