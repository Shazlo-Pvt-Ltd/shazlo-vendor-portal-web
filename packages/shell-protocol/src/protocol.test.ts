import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMessage, exactOrigin, listenAsModule, listenAsShell, MAX_MESSAGE_BYTES, parseMessage, pickVersion, sendTo } from './index'

const SHELL = 'https://one.shazlo.store'
const MODULE = 'https://vendor-admin.shazlo.store'

function dispatch(data: unknown, origin: string, source: MessageEventSource | null) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
}

afterEach(() => vi.restoreAllMocks())

describe('createMessage and parseMessage', () => {
  it('round-trips every catalogue message', () => {
    const ready = createMessage('ready', { module: 'vendor-admin', supportedVersions: [1], moduleVersion: '0.1.0' })
    expect(parseMessage(ready, 'module')).toEqual(ready)
    const auth = createMessage('auth', { accessToken: 't', expiresAt: 1_800_000_000, user: { id: 'a1', email: 'naman@shazlo.store', roles: ['super_admin'] } }, ready.id)
    expect(parseMessage(auth, 'shell')).toMatchObject({ type: 'auth', replyTo: ready.id })
    expect(parseMessage(createMessage('toast', { level: 'success', message: 'Approved' }), 'module')).not.toBeNull()
    expect(parseMessage(createMessage('title', { path: '/queue', title: 'Review queue' }), 'module')).not.toBeNull()
    expect(parseMessage(createMessage('token:request', { reason: 'expired' }), 'module')).not.toBeNull()
    expect(parseMessage(createMessage('logout', {}), 'module')).not.toBeNull()
    expect(parseMessage(createMessage('navigate', { path: '/vendors' }), 'shell')).not.toBeNull()
  })

  it('stamps namespace, version, a uuid and the time', () => {
    const msg = createMessage('logout', {})
    expect(msg).toMatchObject({ protocol: 'shazlo-one', v: 1, type: 'logout' })
    expect(msg.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof msg.sentAt).toBe('number')
  })

  it('drops anything outside the protocol without throwing', () => {
    const ok = createMessage('toast', { level: 'info', message: 'Hi' })
    expect(parseMessage({ ...ok, protocol: 'other' }, 'module')).toBeNull()
    expect(parseMessage({ ...ok, v: 99 }, 'module')).toBeNull()
    expect(parseMessage({ ...ok, type: 'eval' }, 'module')).toBeNull()
    expect(parseMessage('not an object', 'module')).toBeNull()
    expect(parseMessage(null, 'module')).toBeNull()
    // A module may not send shell-only types, and the other way round.
    expect(parseMessage(createMessage('auth', { accessToken: 't', expiresAt: 1, user: { id: 'a', email: 'e', roles: [] } }), 'module')).toBeNull()
    expect(parseMessage(createMessage('ready', { module: 'm', supportedVersions: [1], moduleVersion: '1' }), 'shell')).toBeNull()
  })

  it('validates payloads: toasts are short plain text, paths are module-relative', () => {
    expect(parseMessage(createMessage('toast', { level: 'info', message: 'x'.repeat(281) }), 'module')).toBeNull()
    expect(parseMessage(createMessage('toast', { level: 'shout', message: 'Hi' } as never), 'module')).toBeNull()
    expect(parseMessage(createMessage('navigate', { path: 'https://evil.example/' }), 'shell')).toBeNull()
    expect(parseMessage(createMessage('navigate', { path: '//evil.example' }), 'shell')).toBeNull()
    expect(parseMessage(createMessage('title', { path: '/q', title: '' }), 'module')).toBeNull()
  })

  it('drops messages over 64 KB', () => {
    const big = createMessage('error', { code: 'x', message: 'y'.repeat(MAX_MESSAGE_BYTES), fatal: false })
    expect(parseMessage(big, 'module')).toBeNull()
  })
})

describe('origins and versions', () => {
  it('accepts only exact origins, never wildcards', () => {
    expect(exactOrigin('https://vendor-admin.shazlo.store/queue')).toBe(MODULE)
    expect(() => exactOrigin('*')).toThrow()
    expect(() => exactOrigin('https://*.shazlo.store')).toThrow()
    expect(() => exactOrigin('not a url')).toThrow()
  })

  it('refuses "*" as a target origin', () => {
    const target = { postMessage: vi.fn() } as unknown as Window
    expect(() => sendTo(target, '*', createMessage('logout', {}))).toThrow()
    sendTo(target, MODULE, createMessage('logout', {}))
    expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'logout' }), MODULE)
  })

  it('picks the highest version both sides support (current and previous)', () => {
    expect(pickVersion([1])).toBe(1)
    expect(pickVersion([1, 2])).toBe(1)
    expect(pickVersion([7])).toBeNull()
  })
})

describe('listeners', () => {
  it('shell hears only its registered module origin and iframe window', () => {
    const iframeWindow = {} as Window
    const onMessage = vi.fn()
    const stop = listenAsShell({ origin: MODULE, source: () => iframeWindow, onMessage })
    const ready = createMessage('ready', { module: 'vendor-admin', supportedVersions: [1], moduleVersion: '0.1.0' })
    dispatch(ready, 'https://evil.example', iframeWindow)
    dispatch(ready, MODULE, window)
    dispatch({ ...ready, protocol: 'nope' }, MODULE, iframeWindow)
    expect(onMessage).not.toHaveBeenCalled()
    dispatch(ready, MODULE, iframeWindow)
    expect(onMessage).toHaveBeenCalledWith(ready)
    stop()
    dispatch(ready, MODULE, iframeWindow)
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('module hears only the shell origin from its parent window', () => {
    const onMessage = vi.fn()
    const stop = listenAsModule({ shellOrigin: SHELL, onMessage })
    const auth = createMessage('auth', { accessToken: 't', expiresAt: 1, user: { id: 'a', email: 'e', roles: [] } })
    dispatch(auth, 'https://evil.example', window.parent)
    expect(onMessage).not.toHaveBeenCalled()
    dispatch(auth, SHELL, window.parent)
    expect(onMessage).toHaveBeenCalledWith(auth)
    stop()
  })
})
