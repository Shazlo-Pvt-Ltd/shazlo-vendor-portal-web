/** The vendor's team (`/v1/vendor/users`), for the owner's Team page. */
import type { TeamUser } from '../model'
import type { UserOut } from '../wire'
import { isoOrNull, oneOf } from './common'

const STATUSES = ['active', 'invited', 'disabled'] as const satisfies readonly TeamUser['status'][]

export function teamUserFromApi(u: UserOut): TeamUser {
  return {
    id: String(u.id),
    email: String(u.email ?? ''),
    // An unknown role gets the least rights; an unknown status is shown as not able to sign in.
    role: u.role === 'owner' ? 'owner' : 'staff',
    status: oneOf(STATUSES, u.status) ?? 'disabled',
    lastLoginAt: isoOrNull(u.last_login_at),
    createdAt: String(u.created_at ?? ''),
  }
}
