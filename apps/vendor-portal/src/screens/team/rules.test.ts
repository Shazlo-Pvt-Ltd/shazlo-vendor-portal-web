import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from '../../api/errors'
import type { TeamUser } from '../../api/model'
import { canActOn, checkInvite, sortTeam, teamFailure } from './rules'

const m = (email: string, role: TeamUser['role'], status: TeamUser['status'], id = email): TeamUser => ({ id, email, role, status, lastLoginAt: null, createdAt: '2026-11-01T00:00:00Z' })

describe('sortTeam', () => {
  it('puts the owner first, then active, invited and turned-off staff, each by email', () => {
    const sorted = sortTeam([m('d@x.in', 'staff', 'disabled'), m('b@x.in', 'staff', 'invited'), m('c@x.in', 'staff', 'active'), m('o@x.in', 'owner', 'active'), m('a@x.in', 'staff', 'active')])
    expect(sorted.map((x) => x.email)).toEqual(['o@x.in', 'a@x.in', 'c@x.in', 'b@x.in', 'd@x.in'])
  })

  it('does not change the list it was given', () => {
    const team = [m('b@x.in', 'staff', 'active'), m('a@x.in', 'staff', 'active')]
    sortTeam(team)
    expect(team.map((x) => x.email)).toEqual(['b@x.in', 'a@x.in'])
  })
})

describe('checkInvite', () => {
  const team = [m('kiran@kalkistudio.in', 'owner', 'active'), m('meera@kalkistudio.in', 'staff', 'active'), m('asha@kalkistudio.in', 'staff', 'invited'), m('ravi@kalkistudio.in', 'staff', 'disabled')]

  it('checks the address first', () => {
    expect(checkInvite(' ', team)).toBe('Enter the email of the person to invite.')
    expect(checkInvite('a@b', team)).toBe('Enter an email like name@brand.in.')
  })

  it('says when the person is already on the team, whatever the case and spaces', () => {
    expect(checkInvite(' Meera@KalkiStudio.in ', team)).toBe('meera@kalkistudio.in is already on your team.')
    expect(checkInvite('kiran@kalkistudio.in', team)).toBe('kiran@kalkistudio.in is already on your team.')
  })

  it('points to Resend for someone already invited, and to Turn on for someone turned off', () => {
    expect(checkInvite('asha@kalkistudio.in', team)).toBe('asha@kalkistudio.in already has an invite. Use "Resend invite" in the list below.')
    expect(checkInvite('ravi@kalkistudio.in', team)).toBe('ravi@kalkistudio.in is on your team but turned off. Use "Turn on" in the list below.')
  })

  it('accepts a new address', () => {
    expect(checkInvite(' new@kalkistudio.in ', team)).toBeUndefined()
  })
})

describe('canActOn', () => {
  it('never lets the owner act on themself or on another owner', () => {
    expect(canActOn(m('o@x.in', 'owner', 'active', 'u1'), 'u1')).toBe(false)
    expect(canActOn(m('o2@x.in', 'owner', 'active', 'u2'), 'u1')).toBe(false)
    expect(canActOn(m('s@x.in', 'staff', 'active', 'u3'), 'u3')).toBe(false)
    expect(canActOn(m('s@x.in', 'staff', 'active', 'u3'), 'u1')).toBe(true)
  })
})

describe('teamFailure', () => {
  const api = (status: number, code: string, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) => new ApiError({ status, code, message: code, ...extra })

  it('words each refusal', () => {
    expect(teamFailure(api(409, 'cannot_disable_self'), 'disable')).toBe('You cannot turn off your own access.')
    expect(teamFailure(api(409, 'owner_cannot_be_disabled'), 'disable')).toBe('The owner cannot be turned off: a store always keeps its owner.')
    expect(teamFailure(api(409, 'not_invited'), 'resend')).toBe('This person has already chosen a password, so there is no invite to resend. They can use "Forgot password?" on the sign-in page.')
    expect(teamFailure(api(404, 'user_not_found'), 'enable')).toBe('This person is no longer on your team. The list is up to date now.')
    expect(teamFailure(api(403, 'forbidden'), 'invite')).toBe('Only the owner of your store can manage the team.')
  })

  it('says how long to wait after too many invites', () => {
    expect(teamFailure(api(429, 'rate_limited', { retryAfter: 61 }), 'invite')).toBe('You have sent many invites in the last hour. Try again in 2 minutes.')
    expect(teamFailure(api(429, 'rate_limited', { retryAfter: 30 }), 'invite')).toBe('You have sent many invites in the last hour. Try again in 1 minute.')
  })

  it("puts the API's word on the address", () => {
    expect(teamFailure(api(422, 'validation_error', { fieldErrors: { email: 'use plain letters' } }), 'invite')).toBe('use plain letters')
    expect(teamFailure(api(422, 'validation_error'), 'invite')).toBe('Enter an email like name@brand.in.')
  })

  it('falls back to the plain failure words', () => {
    expect(teamFailure(new NetworkError('network'), 'invite')).toMatch(/connection/)
    expect(teamFailure(api(500, 'internal_error'), 'resend')).toBe('Something went wrong on our side. Try again in a moment.')
  })
})
