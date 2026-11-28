import { ApiError } from '../../api/http'
import { adminsCopy } from '../../copy/admins'

const errors = adminsCopy.manage.errors

/** Where a refusal is shown: next to the control it is about, or above the form when it is about none. */
export type Control = 'email' | 'display_name' | 'password' | 'roles' | 'status' | 'form'

export interface Refusal {
  control: Control
  message: string
  /** The admin was removed or changed under us: the list is reloaded. */
  staleList?: boolean
  /** The signed-in admin is no longer a super admin (the session is read again on any 403). */
  lostAccess?: boolean
}

/** What the refused request tried to do, where one code means two things. */
export interface Sent {
  roles?: boolean
  deactivate?: boolean
}

/**
 * What identity-api refused, in words, next to the control it is about (services/identity-api,
 * api/admins.py): `cannot_deactivate_self` and `last_super_admin` (409) by the control that asked,
 * `admin_not_found` (404) above the form with the list reloaded, `forbidden` (403) when the role was
 * just removed. A 422's fields go next to their own control; anything else keeps identity-api's message.
 */
export function refusalOf(error: unknown, sent: Sent = {}): Refusal {
  if (!(error instanceof ApiError)) return { control: 'form', message: adminsCopy.inviteDialog.errors.generic }
  switch (error.code) {
    case 'cannot_deactivate_self':
      return { control: 'status', message: errors.selfDeactivate }
    case 'last_super_admin':
      return sent.roles && !sent.deactivate ? { control: 'roles', message: errors.lastSuperAdminRole } : { control: 'status', message: errors.lastSuperAdminStatus }
    case 'admin_not_found':
      return { control: 'form', message: errors.notFound, staleList: true }
    case 'forbidden':
      return { control: 'form', message: errors.forbidden, lostAccess: true }
  }
  for (const control of ['email', 'display_name', 'password', 'roles'] as const) {
    if (error.fields[control]) return { control, message: error.fields[control] }
  }
  return { control: 'form', message: error.message }
}
