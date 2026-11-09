import { describe, expect, it } from 'vitest'
import { assertExactOrigin, createMessage, isTrustedMessage, negotiateVersion, parseModuleMessage, parseShellMessage, type ReadyMessage, type ToastMessage } from './index'

describe('shell protocol', () => {
  it('round-trips a ready message', () => {
    const msg = createMessage<ReadyMessage>('ready', { module: 'vendor-admin', supportedVersions: [1], moduleVersion: '1.4.0' })
    expect(parseModuleMessage(structuredClone(msg))).toEqual(msg)
  })

  it('drops foreign, malformed and oversize messages', () => {
    expect(parseModuleMessage({ type: 'ready' })).toBeNull()
    expect(parseModuleMessage({ ...createMessage<ReadyMessage>('ready', { module: 'x', supportedVersions: [1], moduleVersion: '1' }), protocol: 'other' })).toBeNull()
    const toast = createMessage<ToastMessage>('toast', { level: 'info', message: 'x'.repeat(281) })
    expect(parseModuleMessage(toast)).toBeNull()
    expect(parseModuleMessage({ ...toast, type: 'eval' })).toBeNull()
  })

  it('rejects navigate paths that could leave the module', () => {
    const nav = (path: string) => ({ protocol: 'shazlo-one', v: 1, type: 'navigate', id: '1', sentAt: 1, payload: { path } })
    expect(parseShellMessage(nav('/queue'))).not.toBeNull()
    expect(parseShellMessage(nav('//evil.example'))).toBeNull()
    expect(parseShellMessage(nav('https://evil.example'))).toBeNull()
  })

  it('checks origin and source together', () => {
    const source = {} as MessageEventSource
    expect(isTrustedMessage({ origin: 'https://a.shazlo.store', source }, { origin: 'https://a.shazlo.store', source })).toBe(true)
    expect(isTrustedMessage({ origin: 'https://a.shazlo.store', source: {} as MessageEventSource }, { origin: 'https://a.shazlo.store', source })).toBe(false)
    expect(isTrustedMessage({ origin: 'https://b.shazlo.store', source }, { origin: 'https://a.shazlo.store', source })).toBe(false)
  })

  it('negotiates the highest common version and refuses wildcards', () => {
    expect(negotiateVersion([1, 2])).toBe(1)
    expect(negotiateVersion([3])).toBeNull()
    expect(() => assertExactOrigin('*')).toThrow()
    expect(() => assertExactOrigin('https://one.shazlo.store/path')).toThrow()
    expect(assertExactOrigin('http://localhost:5174')).toBe('http://localhost:5174')
  })
})
