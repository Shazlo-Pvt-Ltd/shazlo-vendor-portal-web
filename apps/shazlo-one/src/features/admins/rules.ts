import { EMAIL_PATTERN, LIMITS, PASSWORD_MIN_LENGTH } from '../../session/passwordRules'

export const DISPLAY_NAME_MAX = 200
export const MAX_ROLES = 20

export type Field = 'email' | 'displayName' | 'password' | 'roles'
export type Errors = Partial<Record<Field, string>>

/**
 * The checks before sending a password: at least 12 characters, at most 128, and not the admin's email
 * address. The server has the last word (`422 weak_password`); these only save a round trip.
 */
export function checkPassword(password: string, email: string): string | undefined {
  if (password === '') return 'Enter a temporary password.'
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  if (password.length > LIMITS.passwordMax) return `Use at most ${LIMITS.passwordMax} characters.`
  if (email.trim() !== '' && password.toLowerCase() === email.trim().toLowerCase()) return 'The password must not be the email address.'
  return undefined
}

export function checkDisplayName(displayName: string): string | undefined {
  const name = displayName.trim()
  if (name === '') return 'Enter a name.'
  if (name.length > DISPLAY_NAME_MAX) return `Use at most ${DISPLAY_NAME_MAX} characters.`
  return undefined
}

export function checkRoles(roles: readonly string[]): string | undefined {
  if (roles.length === 0) return 'Choose at least one role.'
  if (roles.length > MAX_ROLES) return `Choose at most ${MAX_ROLES} roles.`
  return undefined
}

export interface CreateValues {
  email: string
  displayName: string
  password: string
  roles: readonly string[]
}

/** Everything wrong with a new admin, by field. Empty when it can be sent. */
export function checkCreate(values: CreateValues): Errors {
  const errors: Errors = {}
  const email = values.email.trim()
  if (email === '') errors.email = 'Enter an email address.'
  else if (email.length > LIMITS.email || !EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address, such as name@shazlo.com.'
  const name = checkDisplayName(values.displayName)
  if (name) errors.displayName = name
  const password = checkPassword(values.password, values.email)
  if (password) errors.password = password
  const roles = checkRoles(values.roles)
  if (roles) errors.roles = roles
  return errors
}

/** Everything wrong with an edit, by field. */
export function checkEdit(values: { displayName: string; roles: readonly string[] }): Errors {
  const errors: Errors = {}
  const name = checkDisplayName(values.displayName)
  if (name) errors.displayName = name
  const roles = checkRoles(values.roles)
  if (roles) errors.roles = roles
  return errors
}

/** Role names read as words: `vendor_reviewer` becomes "vendor reviewer". */
export const roleLabel = (role: string): string => role.replace(/_/g, ' ')
