import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import PreRegister from '../models/PreRegister.js'
import { EMAIL_PATTERN, MAX_EMAIL_LENGTH, isObjectIdString, isPlainObject, isValidEmail } from '../lib/validation.js'
import { DEFAULT_RATE_LIMITS, rateLimitOptions } from '../lib/rateLimits.js'
import { parseTrustProxy } from '../lib/trustProxy.js'

// Generous for a loaded runner: linear matching takes well under a millisecond here, while the
// old backtracking pattern needs seconds at 30 characters and never finishes at 240.
const FAST_MS = 500
const elapsed = (work) => {
  const start = performance.now()
  const result = work()
  return { result, ms: performance.now() - start }
}

// The shapes CodeQL reported for the old pattern (js/redos, alerts 14 and 15), plus near misses
// that fail only at the last character, which is where a backtracking engine explodes.
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

describe('email validation (replaces the exponential pattern in models/PreRegister.js)', () => {
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

  it('accepts the 254-character maximum and rejects one more', () => {
    const domain = '@example.com'
    expect(isValidEmail('a'.repeat(MAX_EMAIL_LENGTH - domain.length) + domain)).toBe(true)
    expect(isValidEmail('a'.repeat(MAX_EMAIL_LENGTH - domain.length + 1) + domain)).toBe(false)
  })

  it.each(adversarial(240))('answers adversarial input below the length cap quickly: %#', (input) => {
    const { result, ms } = elapsed(() => isValidEmail(input))
    expect(result).toBe(false)
    expect(ms).toBeLessThan(FAST_MS)
  })

  it.each(adversarial(100_000))('matches in linear time even without the length cap: %#', (input) => {
    const { result, ms } = elapsed(() => EMAIL_PATTERN.test(input))
    expect(result).toBe(false)
    expect(ms).toBeLessThan(FAST_MS)
  })

  it('validates an adversarial pre-registration email quickly through the model', async () => {
    const start = performance.now()
    await expect(new PreRegister({ email: `a@a${'a'.repeat(240)}!`, name: 'Asha', ipAddress: '127.0.0.1', userAgent: 'test' })
      .validate()).rejects.toHaveProperty('errors.email')
    expect(performance.now() - start).toBeLessThan(FAST_MS)
  })

  it('still lets the model accept addresses the old pattern rejected for their top-level domain', async () => {
    await expect(new PreRegister({ email: 'asha@shazlo.store', name: 'Asha', ipAddress: '127.0.0.1', userAgent: 'test' })
      .validate()).resolves.toBeUndefined()
  })
})

describe('id and shape checks', () => {
  it.each(['507f1f77bcf86cd799439011', '507F1F77BCF86CD799439011'])('accepts the ObjectId %s', (id) => {
    expect(isObjectIdString(id)).toBe(true)
  })

  it.each(['admin123', 'aaaaaaaaaaaa', '507f1f77bcf86cd79943901', '507f1f77bcf86cd799439011 ', { $gt: '' }, ['507f1f77bcf86cd799439011'], 7])(
    'rejects %j as an ObjectId', (value) => {
      expect(isObjectIdString(value)).toBe(false)
    })

  it('treats only non-array objects as catalog rows', () => {
    expect([{}, { name: 'Shirt' }].every(isPlainObject)).toBe(true)
    expect([null, [], 'row', 1].some(isPlainObject)).toBe(false)
  })
})

describe('rate limit configuration', () => {
  it('gives public writes the strictest budget and admin screens the largest', () => {
    const { publicSubmit, lookup, upload, admin } = DEFAULT_RATE_LIMITS
    expect(publicSubmit.limit).toBeLessThan(upload.limit)
    expect(upload.limit).toBeLessThan(lookup.limit)
    expect(lookup.limit).toBeLessThan(admin.limit)
  })

  it('applies per-class overrides and standard headers', () => {
    expect(rateLimitOptions('admin', { admin: { limit: 2 } })).toMatchObject({
      limit: 2, windowMs: DEFAULT_RATE_LIMITS.admin.windowMs, standardHeaders: 'draft-8', legacyHeaders: false,
    })
    expect(rateLimitOptions('upload', { admin: { limit: 2 } }).limit).toBe(DEFAULT_RATE_LIMITS.upload.limit)
  })

  it('refuses an unknown class', () => {
    expect(() => rateLimitOptions('everything')).toThrow(/Unknown rate limit class/)
  })
})

describe('TRUST_PROXY parsing', () => {
  it.each([[undefined, false], ['', false], ['  ', false], ['false', false], ['FALSE', false], ['0', 0], ['1', 1], ['3', 3]])(
    '%j becomes %j', (value, expected) => {
      expect(parseTrustProxy(value)).toBe(expected)
    })

  it('accepts a comma-separated list of proxy addresses or subnets', () => {
    expect(parseTrustProxy('loopback, uniquelocal ,10.0.0.0/8')).toEqual(['loopback', 'uniquelocal', '10.0.0.0/8'])
  })

  it.each(['true', 'TRUE'])('refuses %s, which would trust a client-supplied X-Forwarded-For', (value) => {
    expect(() => parseTrustProxy(value)).toThrow(/number of proxy hops/)
  })
})
