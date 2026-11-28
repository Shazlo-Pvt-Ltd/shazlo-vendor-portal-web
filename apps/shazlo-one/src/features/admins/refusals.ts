import { ApiError } from '../../api/errors'
import { friendlyError } from '../../api/friendlyError'

/** Where a refusal is shown: next to the control it is about, or above the form when it is about none. */
export type Control = 'email' | 'displayName' | 'password' | 'roles' | 'status' | 'form'

export interface Refusal {
  control: Control
  /** Plain words. Never a status code or a server detail the admin cannot act on. */
  message: string
  /** Seconds before another attempt will be accepted (a `429`). */
  retryAfter?: number
  /** The admin was removed or changed under us: reload the list. */
  staleList?: boolean
  /** The signed-in admin is no longer a super admin: refresh the session, which shows the 403 page. */
  lostAccess?: boolean
}

/** What the request that was refused tried to do, where the same code can mean two things. */
export interface Sent {
  /** The request changed the roles. */
  roles?: boolean
  /** The request deactivated the admin. */
  deactivate?: boolean
}

const FIELD_FOR_KEY: Array<[RegExp, Control]> = [
  [/^email/, 'email'],
  [/^display_name/, 'displayName'],
  [/^(new_)?password/, 'password'],
  [/^roles/, 'roles'],
]

/**
 * Turns what identity-api refused with into words, and says which control they belong next to
 * (`email_taken` by the email, `weak_password` by the password, `unknown_role` by the roles,
 * `cannot_deactivate_self` and `last_super_admin` by the control that asked for it, `admin_not_found`
 * above the form). Anything not listed gets the shell's usual plain message.
 */
export function refusalOf(error: unknown, sent: Sent = {}): Refusal {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'email_taken':
        return { control: 'email', message: 'An admin with this email address already exists. Email addresses are not case-sensitive.' }
      case 'weak_password':
        return {
          control: 'password',
          message: error.message.trim() === '' ? 'This password does not meet the rules.' : `This password does not meet the rules: ${error.message}`,
        }
      case 'unknown_role':
        return { control: 'roles', message: 'One of the chosen roles does not exist any more. Reload this page and choose the roles again.' }
      case 'cannot_deactivate_self':
        return { control: 'status', message: 'You cannot deactivate your own account. Ask another super admin to do it.' }
      case 'last_super_admin':
        return sent.deactivate === true || sent.roles !== true
          ? {
              control: 'status',
              message: 'This is the only active super admin. Deactivating them would lock everyone out of admin management. Make another admin a super admin first.',
            }
          : {
              control: 'roles',
              message: 'This is the only active super admin. Taking the super admin role away would lock everyone out of admin management. Make another admin a super admin first.',
            }
      case 'admin_not_found':
        return { control: 'form', message: 'This admin no longer exists. Someone else may have removed them, so the list has been reloaded.', staleList: true }
      case 'forbidden':
        return { control: 'form', message: 'You are no longer allowed to manage admins: your super admin role was removed.', lostAccess: true }
    }
    if (error.status === 422) {
      for (const [key, message] of Object.entries(error.fieldErrors)) {
        const match = FIELD_FOR_KEY.find(([pattern]) => pattern.test(key))
        if (match) return { control: match[1], message }
      }
    }
    const friendly = friendlyError(error)
    return friendly.retryAfter === undefined
      ? { control: 'form', message: friendly.message }
      : { control: 'form', message: friendly.message, retryAfter: friendly.retryAfter }
  }
  return { control: 'form', message: friendlyError(error).message }
}
