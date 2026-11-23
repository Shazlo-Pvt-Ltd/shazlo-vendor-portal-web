export const LIMITS = { email: 320, passwordMax: 128 } as const

/** identity-api's `PASSWORD_MIN_LENGTH` setting (default 12; not in the OpenAPI file). The server has the last word. */
export const PASSWORD_MIN_LENGTH = 12

export const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/

export type Field = 'current' | 'next' | 'confirm'
export type Errors = Partial<Record<Field, string>>

/** The checks before sending; the server has the last word on the new password. */
export function checkPasswords(values: Record<Field, string>): Errors {
  const errors: Errors = {}
  if (values.current === '') errors.current = 'Enter your current password.'
  if (values.next === '') errors.next = 'Choose a new password.'
  else if (values.next.length < PASSWORD_MIN_LENGTH) errors.next = `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  else if (values.next.length > LIMITS.passwordMax) errors.next = `Use at most ${LIMITS.passwordMax} characters.`
  else if (values.next === values.current) errors.next = 'Choose a password different from the current one.'
  if (values.confirm !== values.next) errors.confirm = 'The two new passwords do not match.'
  return errors
}
