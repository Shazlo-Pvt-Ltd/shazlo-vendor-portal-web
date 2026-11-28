import { ApiError } from '../../api/errors'
import type { TeamUser } from '../../api/model'
import { authCopy } from '../../copy/auth'
import { hubsCopy } from '../../copy/hubs'
import { checkEmail } from '../../lib/account'
import { failureOf } from '../../lib/failure'

// The Team page's rules (main's features/team/rules.ts), on the TeamUser view model.

const copy = hubsCopy.team

const STATUS_ORDER: Record<TeamUser['status'], number> = { active: 0, invited: 1, disabled: 2 }

/** The owner first, then active, invited and turned-off staff, each by email. */
export function sortTeam(team: readonly TeamUser[]): TeamUser[] {
  return [...team].sort(
    (a, b) =>
      Number(b.role === 'owner') - Number(a.role === 'owner') ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.email.localeCompare(b.email),
  )
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The problem with an address to invite, or undefined. Someone already on the team is named
 * before anything is sent (vendor-api answers every invite the same way, so it would not say).
 */
export function checkInvite(email: string, team: readonly TeamUser[]): string | undefined {
  if (email.trim() === '') return copy.invite.required
  const problem = checkEmail(email)
  if (problem) return problem
  const member = team.find((u) => sameEmail(u.email, email))
  if (!member) return undefined
  if (member.status === 'invited') return copy.invite.alreadyInvited(member.email)
  if (member.status === 'disabled') return copy.invite.alreadyOff(member.email)
  return copy.invite.alreadyMember(member.email)
}

/** Owners and the signed-in user themself have no actions: a store always keeps its owner. */
export function canActOn(member: TeamUser, myId: string | undefined): boolean {
  return member.role !== 'owner' && member.id !== myId
}

export type TeamAction = 'invite' | 'resend' | 'disable' | 'enable'

/** What to tell the owner when a team action is refused. */
export function teamFailure(error: unknown, action: TeamAction): string {
  if (error instanceof ApiError) {
    const worded = copy.refusals[error.code as keyof typeof copy.refusals]
    if (worded) return worded
    if (error.status === 429 && action === 'invite') return copy.tooManyInvites(Math.max(1, Math.ceil((error.retryAfter ?? 60) / 60)))
    if (error.status === 422 && action === 'invite') return error.fields.email ?? authCopy.rules.emailFormat
  }
  return failureOf(error).message
}
