import { ApiError } from '../../api/errors'
import type { components } from '../../api'
import { friendlyError } from '../errors'
import { EMAIL_PATTERN, LIMITS } from '../signup/rules'

export type Member = components['schemas']['UserOut']

export const MEMBER_STATUSES = ['invited', 'active', 'disabled'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

/** Words for the status chip; the colour only helps. */
export const STATUS_LABEL: Record<MemberStatus, string> = { invited: 'Invited', active: 'Active', disabled: 'Disabled' }
export const STATUS_COLOR: Record<MemberStatus, 'info' | 'success' | 'default'> = { invited: 'info', active: 'success', disabled: 'default' }

export const isMemberStatus = (value: string): value is MemberStatus => (MEMBER_STATUSES as readonly string[]).includes(value)
export const statusLabel = (status: string) => (isMemberStatus(status) ? STATUS_LABEL[status] : status)
export const roleLabel = (role: string) => (role === 'owner' ? 'Owner' : role === 'staff' ? 'Staff' : role)

const STATUS_ORDER: Record<string, number> = { active: 0, invited: 1, disabled: 2 }

/** The owner first, then active, invited and disabled staff, each by email. */
export function sortMembers(members: readonly Member[]): Member[] {
  return [...members].sort(
    (a, b) =>
      Number(b.role === 'owner') - Number(a.role === 'owner') ||
      (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) ||
      a.email.localeCompare(b.email),
  )
}

/** The problem with an address to invite, or undefined. Mirrors the API's `InviteRequest`. */
export function checkInviteEmail(email: string): string | undefined {
  const value = email.trim()
  if (value === '') return 'Enter the email address of the person to invite.'
  if (value.length > LIMITS.email || !EMAIL_PATTERN.test(value)) return 'Enter an email address like name@example.com.'
  return undefined
}

export type TeamAction = 'invite' | 'resend' | 'disable' | 'enable'

/** What to tell the owner when a team action is refused. */
export function teamErrorMessage(error: unknown, action: TeamAction): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'cannot_disable_self':
        return 'You cannot disable your own account.'
      case 'owner_cannot_be_disabled':
        return 'The owner cannot be disabled: a vendor account always keeps its owner.'
      case 'not_invited':
        return 'This person has already set a password, so there is no invitation to resend. They can use "Forgot password" on the sign-in page.'
      case 'user_not_found':
        return 'This person is no longer on your team. The list has been refreshed.'
      case 'forbidden':
        return 'Only the owner of the vendor account can manage the team.'
    }
    if (error.status === 429) {
      const minutes = Math.max(1, Math.ceil((error.retryAfter ?? 60) / 60))
      return `You have sent many invitations in the last hour. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
    }
    if (error.status === 422 && action === 'invite') return error.fieldErrors.email ?? 'Enter an email address like name@example.com.'
  }
  return friendlyError(error).message
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const EXACT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "3 days ago", "yesterday", "just now". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000
  if (Number.isNaN(seconds)) return ''
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

/** "12 Nov 2026, 09:30". */
export function exactTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : EXACT.format(date)
}
