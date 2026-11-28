import { describe, expect, it } from 'vitest'
import { authPayload, envelope, USER } from '../test/harness'
import { isEnvelope, isModulePath, parseModuleToShell, parseShellToModule } from './validate'

const V1 = { acceptedVersions: [1] }
const toShell = (data: unknown) => parseModuleToShell(data, V1)
const toModule = (data: unknown) => parseShellToModule(data, V1)

function dropped(result: { ok: boolean; reason?: string }) {
  if (result.ok) throw new Error('expected the message to be dropped')
  return result.reason
}

describe('the envelope', () => {
  it('accepts every field of a well-formed message, including replyTo', () => {
    const replyTo = '11111111-2222-4333-8444-555555555555'
    const result = toModule(envelope('navigate', { path: '/orders' }, { replyTo }))
    expect(result.ok && result.message.replyTo).toBe(replyTo)
  })

  it.each([
    ['null', null, 'not_an_object'],
    ['a string', 'shazlo-one', 'not_an_object'],
    ['a number', 42, 'not_an_object'],
    ['an array', [], 'not_an_object'],
    ['undefined', undefined, 'not_an_object'],
  ])('drops %s', (_name, data, reason) => {
    expect(dropped(toShell(data))).toBe(reason)
    expect(dropped(toModule(data))).toBe(reason)
  })

  it.each([
    ['another protocol', { protocol: 'other' }],
    ['no protocol', { protocol: undefined }],
    ['a different case', { protocol: 'Shazlo-One' }],
  ])('drops a message with %s', (_name, overrides) => {
    expect(dropped(toShell(envelope('logout', {}, overrides)))).toBe('wrong_protocol')
  })

  it.each([
    ['a string version', { v: '1' }],
    ['a fractional version', { v: 1.5 }],
    ['version zero', { v: 0 }],
    ['a negative version', { v: -1 }],
    ['no version', { v: undefined }],
    ['a non-string type', { type: 7 }],
    ['no id', { id: undefined }],
    ['an id that is not a UUID', { id: 'abc' }],
    ['a replyTo that is not a UUID', { replyTo: 'abc' }],
    ['a replyTo that is a number', { replyTo: 4 }],
    ['a string sentAt', { sentAt: 'now' }],
    ['a negative sentAt', { sentAt: -5 }],
    ['an infinite sentAt', { sentAt: Infinity }],
    ['no payload', { payload: undefined }],
  ])('drops a message with %s', (_name, overrides) => {
    expect(dropped(toShell(envelope('logout', {}, overrides)))).toBe('invalid_envelope')
  })

  it('drops a version the receiver does not speak, for every type but ready (shell side) and error (module side)', () => {
    expect(dropped(toShell(envelope('logout', {}, { v: 2 })))).toBe('wrong_version')
    expect(dropped(toModule(envelope('navigate', { path: '/' }, { v: 2 })))).toBe('wrong_version')
    expect(dropped(toModule(envelope('auth', authPayload(), { v: 2 })))).toBe('wrong_version')
  })

  it('still reads a shell error of another version, so a module learns why it was refused', () => {
    const result = toModule(envelope('error', { code: 'version_unsupported', message: 'No common version.' }, { v: 7 }))
    expect(result.ok && result.message.v).toBe(7)
  })

  it('still reads a ready of another version, so the shell can answer version_unsupported', () => {
    const result = toShell(envelope('ready', { module: 'm', supportedVersions: [7], moduleVersion: '1' }, { v: 7 }))
    expect(result.ok && result.message.v).toBe(7)
  })

  it('drops an unknown type, naming it for a log', () => {
    const result = toShell(envelope('exfiltrate', {}))
    expect(result).toEqual({ ok: false, reason: 'unknown_type', type: 'exfiltrate' })
  })

  it('never puts an unsafe or long type name in the result (it would end up in a log line)', () => {
    const result = toShell(envelope('x'.repeat(100), {}))
    expect(result).toEqual({ ok: false, reason: 'unknown_type' })
    expect(toShell(envelope('<script>', {}))).toEqual({ ok: false, reason: 'unknown_type' })
  })

  it('does not take a type for the wrong direction: the shell sends auth, a module does not', () => {
    expect(dropped(toShell(envelope('auth', authPayload())))).toBe('unknown_type')
    expect(dropped(toModule(envelope('ready', { module: 'm', supportedVersions: [1], moduleVersion: '1' })))).toBe('unknown_type')
  })

  it('isEnvelope checks the shape ADR 0001 names and nothing about the payload', () => {
    expect(isEnvelope(envelope('anything', 'not an object'))).toBe(true)
    expect(isEnvelope(envelope('x', {}, { protocol: 'other' }))).toBe(false)
    expect(isEnvelope(null)).toBe(false)
    expect(isEnvelope(envelope('x', {}, { payload: undefined }))).toBe(false)
    // The same envelope rules the parsers apply, so the two can never disagree.
    expect(isEnvelope(envelope('x', {}, { v: 1.5 }))).toBe(false)
    expect(isEnvelope(envelope('x', {}, { id: 'abc' }))).toBe(false)
    expect(isEnvelope(envelope('x', {}, { replyTo: 'abc' }))).toBe(false)
    expect(isEnvelope(envelope('x', {}, { sentAt: Infinity }))).toBe(false)
    expect(isEnvelope(new Proxy({}, { get: () => { throw new Error('hostile') } }))).toBe(false)
  })
})

describe('auth (shell to module)', () => {
  it('accepts a full auth, with and without a locale, and keeps only the known fields', () => {
    const noisy = authPayload({ locale: 'en-IN', extra: 'ignored', user: { ...USER, admin: true } })
    const result = toModule(envelope('auth', noisy))
    expect(result.ok && result.message.payload).toEqual({
      accessToken: 'token-1',
      expiresAt: 2_000_000_000,
      user: USER,
      locale: 'en-IN',
    })
    expect(toModule(envelope('auth', authPayload())).ok).toBe(true)
  })

  it.each([
    ['no token', { accessToken: undefined }],
    ['an empty token', { accessToken: '' }],
    ['a numeric token', { accessToken: 12 }],
    ['a token with a control character', { accessToken: 'a\u0000b' }],
    ['an oversize token', { accessToken: 'a'.repeat(8193) }],
    ['a string expiresAt', { expiresAt: '2000000000' }],
    ['no expiresAt', { expiresAt: undefined }],
    ['a zero expiresAt', { expiresAt: 0 }],
    ['a NaN expiresAt', { expiresAt: NaN }],
    ['an expiresAt in milliseconds, not seconds', { expiresAt: 1_700_000_900_000 }],
    ['no user', { user: undefined }],
    ['a user that is a string', { user: 'asha' }],
    ['a user with no id', { user: { ...USER, id: undefined } }],
    ['a user with no email', { user: { ...USER, email: undefined } }],
    ['an email without an @', { user: { ...USER, email: 'nobody' } }],
    ['roles that are not an array', { user: { ...USER, roles: 'super_admin' } }],
    ['a role that is not a string', { user: { ...USER, roles: [1] } }],
    ['too many roles', { user: { ...USER, roles: Array.from({ length: 51 }, (_, i) => `r${i}`) } }],
    ['a locale that is not a string', { locale: 5 }],
    ['an oversize locale', { locale: 'x'.repeat(36) }],
  ])('drops an auth with %s', (_name, overrides) => {
    expect(dropped(toModule(envelope('auth', authPayload(overrides))))).toBe('invalid_payload')
  })

  it('drops a payload that is not an object', () => {
    for (const payload of [null, 'token', 5, [], undefined]) {
      expect(toModule(envelope('auth', payload, payload === undefined ? { payload: undefined } : {})).ok).toBe(false)
    }
  })
})

describe('navigate (shell to module)', () => {
  it.each(['/', '/orders', '/orders/42?tab=2#top'])('accepts %s', (path) => {
    expect(toModule(envelope('navigate', { path })).ok).toBe(true)
  })

  it.each([
    ['a relative path', 'orders'],
    ['an empty path', ''],
    ['another site', 'https://evil.example/'],
    ['a protocol-relative address', '//evil.example/x'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a backslash', '/\\evil.example'],
    ['a control character', '/a\nb'],
    ['a number', 42],
    ['an oversize path', `/${'a'.repeat(512)}`],
    // The shell joins the path to the module's base path, so it may not climb out of it.
    ['a dot-dot segment', '/../admins'],
    ['an encoded dot-dot segment', '/%2e%2e/admins'],
    ['a dot segment', '/./queue'],
    ['whitespace', '/a b'],
  ])('drops a path that is %s', (_name, path) => {
    expect(dropped(toModule(envelope('navigate', { path })))).toBe('invalid_payload')
  })

  it('isModulePath is the same check', () => {
    expect(isModulePath('/ok')).toBe(true)
    expect(isModulePath('//no')).toBe(false)
    expect(isModulePath(undefined)).toBe(false)
  })
})

describe('error', () => {
  it('shell to module: a code and a message, no fatal flag needed', () => {
    const result = toModule(envelope('error', { code: 'version_unsupported', message: 'No common version.', fatal: true }))
    expect(result.ok && result.message.payload).toEqual({ code: 'version_unsupported', message: 'No common version.' })
  })

  it.each([
    ['no code', { message: 'x' }],
    ['no message', { code: 'x' }],
    ['an empty code', { code: '', message: 'x' }],
    ['an oversize message', { code: 'x', message: 'm'.repeat(501) }],
  ])('drops an error with %s', (_name, payload) => {
    expect(dropped(toModule(envelope('error', payload)))).toBe('invalid_payload')
    expect(dropped(toShell(envelope('error', { ...payload, fatal: false })))).toBe('invalid_payload')
  })

  it('module to shell: needs a boolean fatal', () => {
    expect(toShell(envelope('error', { code: 'boom', message: 'It broke.', fatal: true })).ok).toBe(true)
    expect(dropped(toShell(envelope('error', { code: 'boom', message: 'It broke.' })))).toBe('invalid_payload')
    expect(dropped(toShell(envelope('error', { code: 'boom', message: 'It broke.', fatal: 'yes' })))).toBe('invalid_payload')
  })
})

describe('ready (module to shell)', () => {
  const ready = { module: 'vendor-admin', supportedVersions: [1, 2], moduleVersion: '1.4.0' }

  it('accepts a ready and keeps only the known fields', () => {
    const result = toShell(envelope('ready', { ...ready, extra: 1 }))
    expect(result.ok && result.message.payload).toEqual(ready)
  })

  it.each([
    ['no module', { module: undefined }],
    ['an empty module', { module: '' }],
    ['no moduleVersion', { moduleVersion: undefined }],
    ['no versions', { supportedVersions: undefined }],
    ['an empty version list', { supportedVersions: [] }],
    ['versions that are not numbers', { supportedVersions: ['1'] }],
    ['a zero version', { supportedVersions: [0] }],
    ['a fractional version', { supportedVersions: [1.5] }],
    ['too many versions', { supportedVersions: Array.from({ length: 21 }, (_, i) => i + 1) }],
  ])('drops a ready with %s', (_name, overrides) => {
    expect(dropped(toShell(envelope('ready', { ...ready, ...overrides })))).toBe('invalid_payload')
  })

  it('does not share the version list with the message (a later change cannot reach it)', () => {
    const versions = [1]
    const result = toShell(envelope('ready', { ...ready, supportedVersions: versions }))
    versions.push(9)
    expect(result.ok && result.message.type === 'ready' && result.message.payload.supportedVersions).toEqual([1])
  })
})

describe('title (module to shell)', () => {
  it('accepts a path and a title', () => {
    expect(toShell(envelope('title', { path: '/orders/42', title: 'Order 42' })).ok).toBe(true)
  })

  it.each([
    ['a path that does not start with /', { path: 'orders', title: 'x' }],
    ['a protocol-relative path', { path: '//evil', title: 'x' }],
    ['no title', { path: '/x' }],
    ['an empty title', { path: '/x', title: '' }],
    ['an oversize title', { path: '/x', title: 't'.repeat(201) }],
    ['a title with a line break', { path: '/x', title: 'a\nb' }],
    ['a title that is markup', { path: '/x', title: '<img src=x onerror=alert(1)>' }],
  ])('drops a title with %s', (_name, payload) => {
    expect(dropped(toShell(envelope('title', payload)))).toBe('invalid_payload')
  })
})

describe('token:request (module to shell)', () => {
  it.each(['expired', 'unauthorized'])('accepts %s', (reason) => {
    expect(toShell(envelope('token:request', { reason })).ok).toBe(true)
  })

  it.each([undefined, 'other', 5, ''])('drops a reason of %j', (reason) => {
    expect(dropped(toShell(envelope('token:request', { reason })))).toBe('invalid_payload')
  })
})

describe('logout (module to shell)', () => {
  it('accepts an empty payload or a reason', () => {
    expect(toShell(envelope('logout', {})).ok).toBe(true)
    const result = toShell(envelope('logout', { reason: 'user_choice' }))
    expect(result.ok && result.message.payload).toEqual({ reason: 'user_choice' })
  })

  it('drops a reason that is not text, or too long', () => {
    expect(dropped(toShell(envelope('logout', { reason: 5 })))).toBe('invalid_payload')
    expect(dropped(toShell(envelope('logout', { reason: 'r'.repeat(201) })))).toBe('invalid_payload')
  })
})

describe('toast (module to shell)', () => {
  it.each(['info', 'success', 'warning', 'error'])('accepts level %s', (level) => {
    expect(toShell(envelope('toast', { level, message: 'Saved.' })).ok).toBe(true)
  })

  it('accepts a message of exactly 280 characters and refuses 281', () => {
    expect(toShell(envelope('toast', { level: 'info', message: 'm'.repeat(280) })).ok).toBe(true)
    expect(dropped(toShell(envelope('toast', { level: 'info', message: 'm'.repeat(281) })))).toBe('invalid_payload')
  })

  it('accepts a duration, and keeps only the known fields', () => {
    const result = toShell(envelope('toast', { level: 'info', message: 'Saved.', durationMs: 4000, extra: true }))
    expect(result.ok && result.message.payload).toEqual({ level: 'info', message: 'Saved.', durationMs: 4000 })
  })

  it.each([
    ['an unknown level', { level: 'fatal', message: 'x' }],
    ['no level', { message: 'x' }],
    ['no message', { level: 'info' }],
    ['an empty message', { level: 'info', message: '' }],
    ['a message that is markup', { level: 'info', message: 'Click <a href="https://evil.example">here</a>' }],
    ['a script tag', { level: 'info', message: '<script>alert(1)</script>' }],
    ['a control character', { level: 'info', message: 'a\u0000b' }],
    ['a string duration', { level: 'info', message: 'x', durationMs: '5' }],
    ['a negative duration', { level: 'info', message: 'x', durationMs: -1 }],
    ['an over-long duration', { level: 'info', message: 'x', durationMs: 60_001 }],
    ['an infinite duration', { level: 'info', message: 'x', durationMs: Infinity }],
  ])('drops a toast with %s', (_name, payload) => {
    expect(dropped(toShell(envelope('toast', payload)))).toBe('invalid_payload')
  })

  it('allows a line break and a plain "<" in text that is not a tag', () => {
    expect(toShell(envelope('toast', { level: 'info', message: 'Saved 3 < 5 items.\nSee the list.' })).ok).toBe(true)
  })
})

describe('bad input never throws', () => {
  const hostile: unknown[] = [
    Object.create(null),
    new Proxy({}, { get: () => { throw new Error('boom') }, has: () => { throw new Error('boom') } }),
    (() => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy })(),
    { get protocol(): never { throw new Error('getter') } },
    { protocol: 'shazlo-one', v: 1, type: { toString: () => { throw new Error('type') } }, id: 1, sentAt: 1, payload: 1 },
    { __proto__: { protocol: 'shazlo-one' } },
    JSON.parse('{"protocol":"shazlo-one","v":1,"type":"toast","id":"x","__proto__":{"polluted":true}}'),
    () => {},
    Symbol('x'),
    10n,
    new Date(),
    new Map(),
    new ArrayBuffer(8),
    envelope('toast', { level: 'info', get message(): never { throw new Error('payload getter') } }),
  ]

  it.each(hostile.map((value, index) => [index, value] as const))('input #%i is dropped, not thrown', (_index, value) => {
    expect(() => toShell(value)).not.toThrow()
    expect(() => toModule(value)).not.toThrow()
    expect(toShell(value).ok).toBe(false)
    expect(toModule(value).ok).toBe(false)
  })

  it('does not let a __proto__ key in the payload reach the result', () => {
    const payload = JSON.parse('{"level":"info","message":"hi","__proto__":{"polluted":true}}')
    const result = toShell(envelope('toast', payload))
    expect(result.ok && Object.hasOwn(result.message.payload as object, 'polluted')).toBe(false)
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })
})
