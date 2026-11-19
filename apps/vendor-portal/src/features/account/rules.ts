import { LIMITS, PASSWORD_MIN_LENGTH } from '../signup/rules'

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
