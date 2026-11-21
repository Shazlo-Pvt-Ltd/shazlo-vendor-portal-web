import { describe, expect, it } from 'vitest'
import PreRegister from '../models/PreRegister.js'
import { EMAIL_PATTERN, isValidEmail } from '../lib/validation.js'
import { parseTrustProxy } from '../lib/trustProxy.js'

// The shapes CodeQL reported for the old pattern (js/redos, alerts 14 and 15), plus near misses
// that fail only at the last character, which is where a backtracking engine explodes. The old
// pattern needed 27 s for a 31-character input, so at these lengths it would never finish.
// As in the font URL fix (docs/testing.md), results are asserted directly with no machine-speed
// threshold; the CodeQL gate checks the computational side.
const adversarial = (n) => [
  'a'.repeat(n),
  `${'a'.repeat(n)}!`,
  `a@a${'a'.repeat(n)}`,
  `a@a${'a'.repeat(n)}!`,
  `a@${'a.'.repeat(n / 2)}`,
  `${'a.'.repeat(n / 2)}@a`,
  `a@a.${'a'.repeat(n)} `,
  `${'a-'.repeat(n / 2)}@a-a`,
]

const registration = (email) => ({ email, name: 'Asha', ipAddress: '127.0.0.1', userAgent: 'test' })

describe('pre-registration email check (CodeQL js/redos, models/PreRegister.js)', () => {
  it.each(adversarial(100_000))('rejects the adversarial address %#', async (email) => {
    await expect(new PreRegister(registration(email)).validate()).rejects.toHaveProperty('errors.email')
  })

  it('accepts addresses the old pattern refused for a top-level domain longer than three letters', async () => {
    await expect(new PreRegister(registration('asha@shazlo.store')).validate()).resolves.toBeUndefined()
  })
})

describe('isValidEmail', () => {
  it.each([
    'asha@example.com', 'ASHA@EXAMPLE.COM', 'first.last+tag@sub.example.co.in', "o'brien@example.ie",
    'user_name-1@example-domain.store', 'a@b.co',
  ])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true)
  })

  it.each([
    '', 'plainaddress', '@example.com', 'asha@', 'asha@example', 'asha@@example.com', 'asha@exa@mple.com',
    'asha @example.com', 'asha@exam ple.com', ' asha@example.com', 'asha@example..com', 'asha@.example.com',
    'asha@example.com.', 'asha@example.com\n',
  ])('rejects %j', (email) => {
    expect(isValidEmail(email)).toBe(false)
  })

  it.each([null, undefined, 42, { $gt: '' }, ['asha@example.com'], { toString: () => 'asha@example.com' }])(
    'rejects the non-string %j', (value) => {
      expect(isValidEmail(value)).toBe(false)
    })

  it('accepts a 254-character address and rejects a 255-character one', () => {
    const domain = '@example.com'
    expect(isValidEmail('a'.repeat(254 - domain.length) + domain)).toBe(true)
    expect(isValidEmail('a'.repeat(255 - domain.length) + domain)).toBe(false)
  })

  // The pattern itself, without the length cap in front of it, so a future pattern that
  // backtracks fails here even if the cap stays.
  it.each(adversarial(100_000))('the pattern rejects the 100k-character adversarial input %#', (input) => {
    expect(EMAIL_PATTERN.test(input)).toBe(false)
  })
})

describe('TRUST_PROXY parsing (the client address every rate limit keys on)', () => {
  it.each([[undefined, false], ['', false], ['  ', false], ['false', false], ['FALSE', false], ['0', 0], ['1', 1], ['3', 3]])(
    '%j becomes %j', (value, expected) => {
      expect(parseTrustProxy(value)).toBe(expected)
    })

  it('accepts a comma-separated list of proxy addresses or subnets', () => {
    expect(parseTrustProxy('loopback, uniquelocal ,10.0.0.0/8')).toEqual(['loopback', 'uniquelocal', '10.0.0.0/8'])
  })

  it.each(['true', 'TRUE', ' true '])('refuses %j, which would trust a client-supplied X-Forwarded-For', (value) => {
    expect(() => parseTrustProxy(value)).toThrow(/number of proxy hops/)
  })

  it.each(['0.0.0.0/0', '::/0', 'loopback, 0.0.0.0/00'])('refuses %s, a subnet that matches every address', (value) => {
    expect(() => parseTrustProxy(value)).toThrow(/would trust every address/)
  })
})
