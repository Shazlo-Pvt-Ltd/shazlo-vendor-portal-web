import { describe, expect, it } from 'vitest'
import { MAX_MESSAGE_BYTES } from './constants'
import { createDropLogger } from './logger'
import { ProtocolConfigError, assertExactOrigin } from './origin'
import { newMessageId, postExact } from './post'
import { isWithinSizeLimit } from './size'
import { isTrustedMessage } from './trust'
import { negotiateVersion, shellSupportedVersions } from './version'

describe('the size limit', () => {
  it('accepts a message up to 64 KB and drops one over it, measured as JSON bytes', () => {
    const overhead = JSON.stringify({ s: '' }).length
    expect(isWithinSizeLimit({ s: 'a'.repeat(MAX_MESSAGE_BYTES - overhead) })).toBe(true)
    expect(isWithinSizeLimit({ s: 'a'.repeat(MAX_MESSAGE_BYTES - overhead + 1) })).toBe(false)
  })

  it('counts bytes, not characters: multi-byte text over the limit is over', () => {
    // 22 000 three-byte characters are 66 000 bytes but only 22 000 characters.
    expect(isWithinSizeLimit({ s: '€'.repeat(22_000) })).toBe(false)
    expect(isWithinSizeLimit({ s: '€'.repeat(20_000) })).toBe(true)
  })

  it('treats what cannot be JSON as too large, and a plain small value as fine', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(isWithinSizeLimit(cycle)).toBe(false)
    expect(isWithinSizeLimit({ n: 10n })).toBe(false)
    expect(isWithinSizeLimit(undefined)).toBe(true)
    expect(isWithinSizeLimit('small')).toBe(true)
  })
})

describe('isTrustedMessage', () => {
  const source = {} as MessageEventSource
  const other = {} as MessageEventSource

  it('needs the exact origin and the exact window', () => {
    expect(isTrustedMessage({ origin: 'https://a.test', source }, { origin: 'https://a.test', source })).toBe(true)
    expect(isTrustedMessage({ origin: 'https://b.test', source }, { origin: 'https://a.test', source })).toBe(false)
    expect(isTrustedMessage({ origin: 'https://a.test', source: other }, { origin: 'https://a.test', source })).toBe(false)
  })

  it('does not trust a prefix, a sub-domain or a look-alike of the origin', () => {
    for (const origin of ['https://a.test.evil.example', 'https://evil.a.test', 'http://a.test', 'https://a.test:8443', 'https://A.test']) {
      expect(isTrustedMessage({ origin, source }, { origin: 'https://a.test', source })).toBe(false)
    }
  })

  it('never trusts when the expected window is missing, even if the sender window is missing too', () => {
    expect(isTrustedMessage({ origin: 'https://a.test', source: null }, { origin: 'https://a.test', source: null })).toBe(false)
  })

  it('never trusts a wildcard, empty or opaque expected origin', () => {
    for (const origin of ['*', '', 'null']) {
      expect(isTrustedMessage({ origin, source }, { origin, source })).toBe(false)
    }
  })
})

describe('versions', () => {
  it('the shell speaks the current version and the previous one', () => {
    expect(shellSupportedVersions(1)).toEqual([1])
    expect(shellSupportedVersions(2)).toEqual([2, 1])
    expect(shellSupportedVersions(3)).toEqual([3, 2])
    expect(shellSupportedVersions()).toEqual([1])
  })

  it('picks the highest version both sides support', () => {
    expect(negotiateVersion([2, 1], [1, 2, 3])).toBe(2)
    expect(negotiateVersion([2, 1], [1])).toBe(1)
    expect(negotiateVersion([1], [1])).toBe(1)
  })

  it('finds none when they share no version', () => {
    expect(negotiateVersion([2, 1], [3])).toBeUndefined()
    expect(negotiateVersion([1], [])).toBeUndefined()
  })
})

describe('assertExactOrigin', () => {
  const check = (origin: unknown, development = false) => assertExactOrigin(origin, { development, name: 'The origin' })

  it('accepts one exact https origin, with a port', () => {
    expect(check('https://one.shazlo.com')).toBe('https://one.shazlo.com')
    expect(check('https://one.shazlo.com:8443')).toBe('https://one.shazlo.com:8443')
  })

  it.each([undefined, null, '', '   ', 5])('refuses a missing value (%j)', (value) => {
    expect(() => check(value)).toThrow(/is not set/)
  })

  it.each(['*', 'https://*.shazlo.com', 'https://*', '*.shazlo.com'])('refuses the wildcard %s', (value) => {
    expect(() => check(value)).toThrow(/wildcard/)
    expect(() => check(value, true)).toThrow(/wildcard/)
  })

  it.each([
    ['a trailing slash', 'https://one.shazlo.com/'],
    ['a path', 'https://one.shazlo.com/app'],
    ['a user name', 'https://user@one.shazlo.com'],
    ['upper case', 'https://One.Shazlo.com'],
    ['a default port', 'https://one.shazlo.com:443'],
  ])('refuses an origin with %s', (_name, value) => {
    expect(() => check(value)).toThrow(/only the scheme, host and port/)
  })

  it('refuses what is not an origin at all', () => {
    expect(() => check('one.shazlo.com')).toThrow(/not a valid origin/)
    expect(() => check('javascript:alert(1)')).toThrow(ProtocolConfigError)
    expect(() => check('data:text/html,x')).toThrow(ProtocolConfigError)
    expect(() => check('null')).toThrow(ProtocolConfigError)
  })

  it('refuses http outside a development build, and in development for anything but localhost', () => {
    expect(() => check('http://localhost:5173')).toThrow(/https/)
    expect(() => check('http://one.shazlo.com', true)).toThrow(/only for localhost/)
    expect(check('http://localhost:5173', true)).toBe('http://localhost:5173')
    expect(check('http://127.0.0.1:5173', true)).toBe('http://127.0.0.1:5173')
  })
})

describe('postExact', () => {
  it('posts to the exact origin it was given', () => {
    const calls: unknown[][] = []
    const target = { postMessage: (...args: unknown[]) => void calls.push(args) } as unknown as Window
    expect(postExact(target, { a: 1 }, 'https://a.test')).toBe(true)
    expect(calls).toEqual([[{ a: 1 }, 'https://a.test']])
  })

  it.each(['*', '', 'null'])('refuses to post to %j, whatever the caller does', (origin) => {
    const calls: unknown[][] = []
    const target = { postMessage: (...args: unknown[]) => void calls.push(args) } as unknown as Window
    expect(() => postExact(target, {}, origin)).toThrow(ProtocolConfigError)
    expect(calls).toEqual([])
  })

  it('sends nothing to a missing window, an oversize message, or something the browser cannot clone', () => {
    expect(postExact(null, {}, 'https://a.test')).toBe(false)
    expect(postExact(undefined, {}, 'https://a.test')).toBe(false)
    const calls: unknown[][] = []
    const target = { postMessage: (...args: unknown[]) => void calls.push(args) } as unknown as Window
    expect(postExact(target, { s: 'a'.repeat(MAX_MESSAGE_BYTES + 1) }, 'https://a.test')).toBe(false)
    const throwing = { postMessage: () => { throw new Error('DataCloneError') } } as unknown as Window
    expect(postExact(throwing, {}, 'https://a.test')).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('newMessageId', () => {
  it('gives a UUID each time', () => {
    const a = newMessageId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(newMessageId()).not.toBe(a)
  })

  it('still gives a UUID where crypto.randomUUID does not exist', () => {
    const original = globalThis.crypto
    const withoutUuid = { getRandomValues: original.getRandomValues.bind(original) }
    Object.defineProperty(globalThis, 'crypto', { value: withoutUuid, configurable: true })
    try {
      expect(newMessageId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true })
    }
  })
})

describe('the drop logger', () => {
  it('logs the reason, type and origin in development, never anything else', () => {
    const lines: unknown[][] = []
    const log = createDropLogger({ development: true, log: (...args) => void lines.push(args) })
    log('invalid_payload', { type: 'auth', origin: 'https://a.test' })
    log('too_large')
    expect(lines).toEqual([
      ['[shell-protocol] dropped a message: invalid_payload type=auth origin=https://a.test'],
      ['[shell-protocol] dropped a message: too_large'],
    ])
  })

  it('stays silent in production', () => {
    const lines: unknown[][] = []
    const log = createDropLogger({ development: false, log: (...args) => void lines.push(args) })
    log('invalid_payload', { type: 'auth' })
    expect(lines).toEqual([])
  })

  it('writes a warning to the console by default in development', () => {
    const lines: unknown[][] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => void lines.push(args)
    try {
      createDropLogger({ development: true })('unknown_type', { type: 'x' })
    } finally {
      console.warn = original
    }
    expect(lines).toHaveLength(1)
  })
})
