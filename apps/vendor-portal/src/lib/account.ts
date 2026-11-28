import { authCopy } from '../copy/auth'

// Email and password rules for signing up, setting, resetting and changing a password, and
// inviting staff (main's features/signup/rules.ts). They mirror vendor-api (account.test.ts compares
// them with openapi.json); the server checks everything again and has the last word.

const copy = authCopy.rules

/** The longest address vendor-api accepts. */
export const EMAIL_MAX = 320

/** vendor-api's `password_min_length` setting (not in the OpenAPI file). */
export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

/** vendor-api's email pattern (`SignupRequest`, `ResendRequest`, `ForgotPasswordRequest`, `InviteRequest`). */
export const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/

/** The problem with an email address, or undefined. Spaces around it do not count. */
export function checkEmail(email: string): string | undefined {
  const value = email.trim()
  if (value === '') return copy.emailRequired
  if (value.length > EMAIL_MAX || !EMAIL_PATTERN.test(value)) return copy.emailFormat
  return undefined
}

// Characters as a person counts them: an emoji is one, not two UTF-16 units.
const length = (text: string) => Array.from(text).length

/**
 * The problem with a new password, or undefined. It is checked as typed (never trimmed). With
 * `email`, it may not be the email address (vendor-api's rule, ignoring case and spaces around).
 */
export function checkNewPassword(password: string, email = ''): string | undefined {
  if (password === '') return copy.passwordRequired
  if (length(password) < PASSWORD_MIN) return copy.passwordShort(PASSWORD_MIN)
  if (length(password) > PASSWORD_MAX) return copy.passwordLong(PASSWORD_MAX)
  if (email.trim() !== '' && password.trim().toLowerCase() === email.trim().toLowerCase()) return copy.passwordIsEmail
  return undefined
}

/** A new password typed twice (set or reset a password, accept an invite). */
export function checkPasswordPair(password: string, confirm: string): { password?: string; confirm?: string } {
  const problem = checkNewPassword(password)
  if (problem) return { password: problem }
  if (confirm === '') return { confirm: copy.confirmRequired }
  if (confirm !== password) return { confirm: copy.mismatch }
  return {}
}

export type PasswordChangeField = 'current' | 'next' | 'confirm'
export type PasswordChangeErrors = Partial<Record<PasswordChangeField, string>>

/** Changing the password while signed in: the current one, and the new one twice. */
export function checkPasswordChange(values: Record<PasswordChangeField, string>, email = ''): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {}
  if (values.current === '') errors.current = copy.currentRequired
  const next = values.next === '' ? copy.newRequired : checkNewPassword(values.next, email)
  if (next) errors.next = next
  else if (values.next === values.current) errors.next = copy.sameAsCurrent
  else if (values.confirm !== values.next) errors.confirm = copy.newMismatch
  return errors
}
