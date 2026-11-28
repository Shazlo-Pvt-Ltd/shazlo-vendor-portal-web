import { describe, expect, it } from 'vitest'
import { NO_FILTERS, PAGE_SIZE, filtersFromSearch, hasActiveFilters, pageCount, queryFromFilters, searchFromFilters } from './filters'
import { generateTemporaryPassword, TEMPORARY_PASSWORD_LENGTH } from './password'
import { ApiError } from '../../api/errors'
import { refusalOf } from './refusals'
import { checkCreate, checkDisplayName, checkEdit, checkPassword, checkRoles, roleLabel } from './rules'

const valid = { email: 'asha@shazlo.test', displayName: 'Asha Admin', password: 'a long enough password', roles: ['vendor_reviewer'] }
const refused = (status: number, code: string, message = code, fieldErrors: Record<string, string> = {}) =>
  new ApiError({ status, code, message, fieldErrors })

describe('the filters in the address', () => {
  it('read a full address', () => {
    expect(filtersFromSearch(new URLSearchParams('q=asha&role=super_admin&status=active&page=3'))).toEqual({
      q: 'asha',
      role: 'super_admin',
      status: 'active',
      page: 3,
    })
  })

  it('ignore anything invalid, so a hand-edited link never breaks the page', () => {
    expect(filtersFromSearch(new URLSearchParams('status=deleted&role=bad role!&page=-4'))).toEqual(NO_FILTERS)
    expect(filtersFromSearch(new URLSearchParams('page=abc')).page).toBe(1)
    expect(filtersFromSearch(new URLSearchParams('page=1.5')).page).toBe(1)
    expect(filtersFromSearch(new URLSearchParams('page=99999999')).page).toBe(1)
    expect(filtersFromSearch(new URLSearchParams(`q=${'x'.repeat(500)}`)).q).toHaveLength(200)
    expect(filtersFromSearch(new URLSearchParams('q=%20%20spaced%20%20')).q).toBe('spaced')
  })

  it('write only what is not a default, so the plain list has a plain address', () => {
    expect(searchFromFilters(NO_FILTERS).toString()).toBe('')
    expect(searchFromFilters({ q: 'a b', role: 'super_admin', status: 'inactive', page: 2 }).toString()).toBe('q=a+b&role=super_admin&status=inactive&page=2')
  })

  it('round-trip', () => {
    const filters = { q: 'asha', role: 'vendor_reviewer', status: 'active' as const, page: 4 }
    expect(filtersFromSearch(searchFromFilters(filters))).toEqual(filters)
  })

  it('know whether any filter is on (the page does not count)', () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false)
    expect(hasActiveFilters({ ...NO_FILTERS, page: 5 })).toBe(false)
    for (const patch of [{ q: 'a' }, { role: 'r' }, { status: 'active' as const }]) expect(hasActiveFilters({ ...NO_FILTERS, ...patch })).toBe(true)
  })

  it('become the query the endpoint takes, with the page as an offset', () => {
    expect(queryFromFilters(NO_FILTERS)).toEqual({ limit: PAGE_SIZE, offset: 0 })
    expect(queryFromFilters({ q: 'a', role: 'r', status: 'inactive', page: 3 })).toEqual({
      q: 'a',
      role: 'r',
      is_active: false,
      limit: PAGE_SIZE,
      offset: 2 * PAGE_SIZE,
    })
    expect(queryFromFilters({ ...NO_FILTERS, status: 'active' }).is_active).toBe(true)
  })

  it('count pages, at least one', () => {
    expect([0, 1, 25, 26, 50, 51].map(pageCount)).toEqual([1, 1, 1, 2, 2, 3])
  })
})

describe('the checks before sending', () => {
  it('accept a valid new admin', () => {
    expect(checkCreate(valid)).toEqual({})
  })

  it.each([
    ['no email', { email: '' }, 'email', /Enter an email/],
    ['an email without a domain', { email: 'asha@' }, 'email', /valid email/],
    ['an email with a space', { email: 'as ha@shazlo.test' }, 'email', /valid email/],
    ['no name', { displayName: '   ' }, 'displayName', /Enter a name/],
    ['a name over 200 characters', { displayName: 'n'.repeat(201) }, 'displayName', /at most 200/],
    ['no password', { password: '' }, 'password', /Enter a temporary password/],
    ['a short password', { password: 'short' }, 'password', /at least 12/],
    ['a password over 128 characters', { password: 'p'.repeat(129) }, 'password', /at most 128/],
    ['the email as the password', { password: 'asha@shazlo.test' }, 'password', /must not be the email/],
    ['the email in other letters as the password', { password: 'ASHA@shazlo.test' }, 'password', /must not be the email/],
    ['no role', { roles: [] }, 'roles', /at least one role/],
    ['too many roles', { roles: Array.from({ length: 21 }, (_, i) => `r${i}`) }, 'roles', /at most 20/],
  ])('refuse %s', (_name, patch, field, message) => {
    const errors = checkCreate({ ...valid, ...patch })
    expect(Object.keys(errors)).toEqual([field])
    expect(errors[field as keyof typeof errors]).toMatch(message)
  })

  it('report every problem at once', () => {
    expect(Object.keys(checkCreate({ email: '', displayName: '', password: '', roles: [] })).sort()).toEqual(['displayName', 'email', 'password', 'roles'])
  })

  it('check an edit: a name and at least one role', () => {
    expect(checkEdit({ displayName: 'New', roles: ['a'] })).toEqual({})
    expect(Object.keys(checkEdit({ displayName: '', roles: [] })).sort()).toEqual(['displayName', 'roles'])
  })

  it('have the individual checks', () => {
    expect(checkPassword('a long enough password', '')).toBeUndefined()
    expect(checkDisplayName('A')).toBeUndefined()
    expect(checkRoles(['a'])).toBeUndefined()
  })

  it('write role names as words', () => {
    expect(roleLabel('vendor_reviewer')).toBe('vendor reviewer')
  })
})

describe('the temporary password generator', () => {
  it('gives 20 characters from an alphabet without look-alikes, enough for the policy', () => {
    const password = generateTemporaryPassword()
    expect(password).toHaveLength(TEMPORARY_PASSWORD_LENGTH)
    expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/)
    expect(checkPassword(password, 'someone@shazlo.test')).toBeUndefined()
  })

  it('gives a different one each time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()))
    expect(seen.size).toBe(200)
  })

  it('draws every character without bias: a byte that would favour the first characters is thrown away', () => {
    // 256 is not a multiple of 56: bytes 224 and up would favour the first 32 characters, so they are skipped.
    const biased = new Uint8Array(32).fill(255)
    let calls = 0
    const random = (bytes: Uint8Array) => {
      calls += 1
      // The first draws are all biased bytes; then every character comes from byte value 0.
      return calls < 3 ? biased : new Uint8Array(bytes.length)
    }
    const password = generateTemporaryPassword(random)
    expect(password).toBe('a'.repeat(TEMPORARY_PASSWORD_LENGTH))
    expect(calls).toBeGreaterThanOrEqual(3)
  })

  it('uses every character of the alphabet over many passwords, evenly enough', () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 400; i += 1) for (const char of generateTemporaryPassword()) counts.set(char, (counts.get(char) ?? 0) + 1)
    expect(counts.size).toBe(56)
    const values = [...counts.values()]
    // 8000 characters over 56: about 143 each; nothing far from that.
    expect(Math.min(...values)).toBeGreaterThan(80)
    expect(Math.max(...values)).toBeLessThan(220)
  })
})

describe('refusals in plain words, next to the right control', () => {
  it('email_taken is by the email', () => {
    expect(refusalOf(refused(409, 'email_taken'))).toMatchObject({ control: 'email', message: expect.stringMatching(/already exists/) })
  })

  it('weak_password is by the password, with what the server said', () => {
    const refusal = refusalOf(refused(422, 'weak_password', 'Password must be at least 12 characters'))
    expect(refusal.control).toBe('password')
    expect(refusal.message).toMatch(/does not meet the rules: Password must be at least 12 characters/)
    expect(refusalOf(refused(422, 'weak_password', ' ')).message).toBe('This password does not meet the rules.')
  })

  it('unknown_role is by the roles', () => {
    expect(refusalOf(refused(422, 'unknown_role'))).toMatchObject({ control: 'roles', message: expect.stringMatching(/does not exist any more/) })
  })

  it('cannot_deactivate_self is by the status control', () => {
    expect(refusalOf(refused(409, 'cannot_deactivate_self'))).toMatchObject({ control: 'status', message: expect.stringMatching(/cannot deactivate your own account/) })
  })

  it('last_super_admin is by the control that asked: the status for a deactivation, the roles for a role change', () => {
    const deactivate = refusalOf(refused(409, 'last_super_admin'), { deactivate: true })
    expect(deactivate.control).toBe('status')
    expect(deactivate.message).toMatch(/only active super admin.*Deactivating/)
    const demote = refusalOf(refused(409, 'last_super_admin'), { roles: true })
    expect(demote.control).toBe('roles')
    expect(demote.message).toMatch(/only active super admin.*Taking the super admin role away/)
    expect(refusalOf(refused(409, 'last_super_admin')).control).toBe('status')
  })

  it('admin_not_found is above the form, and says the list is stale', () => {
    expect(refusalOf(refused(404, 'admin_not_found'))).toMatchObject({ control: 'form', staleList: true, message: expect.stringMatching(/no longer exists/) })
  })

  it('a 403 means the signed-in admin lost the role', () => {
    expect(refusalOf(refused(403, 'forbidden'))).toMatchObject({ control: 'form', lostAccess: true })
  })

  it('a field error from validation goes by its field', () => {
    expect(refusalOf(refused(422, 'validation_error', 'x', { email: 'Not an email' }))).toEqual({ control: 'email', message: 'Not an email' })
    expect(refusalOf(refused(422, 'validation_error', 'x', { display_name: 'Too long' })).control).toBe('displayName')
    expect(refusalOf(refused(422, 'validation_error', 'x', { 'roles.0': 'Bad' })).control).toBe('roles')
    expect(refusalOf(refused(422, 'validation_error', 'x', { new_password: 'Bad' })).control).toBe('password')
  })

  it('a rate limit has a countdown, and anything else gets the usual plain message', () => {
    const limited = new ApiError({ status: 429, code: 'rate_limited', message: 'slow', retryAfter: 30 })
    expect(refusalOf(limited)).toEqual({ control: 'form', message: 'Too many attempts.', retryAfter: 30 })
    expect(refusalOf(refused(503, 'unavailable', 'redis down at 10.0.0.4'))).toEqual({
      control: 'form',
      message: 'Something went wrong on our side. Please try again in a moment.',
    })
    expect(refusalOf(new Error('boom'))).toEqual({ control: 'form', message: 'Something went wrong. Please try again.' })
  })
})
