import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from '../../api/errors'
import { checkInviteEmail, sortMembers, statusLabel, teamErrorMessage, type Member } from './rules'

const m = (email: string, role: string, status: string): Member => ({ id: email, email, role, status, last_login_at: null, created_at: '2026-11-01T00:00:00Z' })

describe('team rules', () => {
  it('sorts the owner first, then by status and email', () => {
    const sorted = sortMembers([m('d@x', 'staff', 'disabled'), m('b@x', 'staff', 'invited'), m('c@x', 'staff', 'active'), m('o@x', 'owner', 'active'), m('a@x', 'staff', 'active')])
    expect(sorted.map((x) => x.email)).toEqual(['o@x', 'a@x', 'c@x', 'b@x', 'd@x'])
  })

  it('shows an unknown status as it is', () => {
    expect(statusLabel('invited')).toBe('Invited')
    expect(statusLabel('locked')).toBe('locked')
  })

  it('checks an address to invite', () => {
    expect(checkInviteEmail(' ')).toMatch(/Enter the email address/)
    expect(checkInviteEmail('a@b')).toMatch(/like name@example.com/)
    expect(checkInviteEmail(' asha@brand.test ')).toBeUndefined()
  })

  it('words each refusal', () => {
    const api = (status: number, code: string, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) => new ApiError({ status, code, message: code, ...extra })
    expect(teamErrorMessage(api(409, 'cannot_disable_self'), 'disable')).toMatch(/your own account/)
    expect(teamErrorMessage(api(409, 'owner_cannot_be_disabled'), 'disable')).toMatch(/keeps its owner/)
    expect(teamErrorMessage(api(409, 'not_invited'), 'resend')).toMatch(/already set a password/)
    expect(teamErrorMessage(api(404, 'user_not_found'), 'enable')).toMatch(/no longer on your team/)
    expect(teamErrorMessage(api(429, 'rate_limited', { retryAfter: 61 }), 'invite')).toMatch(/2 minutes/)
    expect(teamErrorMessage(api(422, 'validation_error', { fieldErrors: { email: 'use plain letters' } }), 'invite')).toBe('use plain letters')
    expect(teamErrorMessage(new NetworkError('network'), 'invite')).toMatch(/connection/)
  })
})
