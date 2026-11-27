import { describe, expect, it, vi } from 'vitest'
import { MAX_MESSAGE_BYTES } from '../src/constants'
import { ProtocolConfigError } from '../src/origin'
import { createModuleClient } from '../src/moduleClient'
import { createShellChannel, type ReadyInfo } from '../src/shellChannel'
import type { AuthPayload, LogoutPayload, ModuleErrorPayload, TitlePayload, ToastPayload, TokenRequestPayload } from '../src/types'
import { MODULE_ORIGIN, OTHER_ORIGIN, SHELL_ORIGIN, USER, authPayload, createFrames, envelope, flush } from './harness'

/** Both ends wired together over two real windows, with every event the shell sees recorded. */
function setup(options: { development?: boolean; moduleVersions?: number[]; shellVersions?: number[] } = {}) {
  const frames = createFrames()
  const lines: unknown[][] = []
  const log = (...args: unknown[]) => void lines.push(args)
  const seen = {
    ready: [] as ReadyInfo[],
    unsupported: [] as Array<Omit<ReadyInfo, 'version'>>,
    titles: [] as TitlePayload[],
    tokenRequests: [] as TokenRequestPayload[],
    logouts: [] as LogoutPayload[],
    toasts: [] as ToastPayload[],
    moduleErrors: [] as ModuleErrorPayload[],
  }
  const auths: AuthPayload[] = []
  const navigations: string[] = []
  const shellErrors: Array<{ code: string; message: string }> = []
  let clock = 1_700_000_000_000

  // The shell registers its listener first, then the frame would be given its `src`.
  const shell = createShellChannel({
    iframe: frames.moduleFrame,
    origin: MODULE_ORIGIN,
    window: frames.shellWindow,
    development: options.development,
    supportedVersions: options.shellVersions,
    now: () => clock,
    onReady: (info) => seen.ready.push(info),
    onVersionUnsupported: (info) => seen.unsupported.push(info),
    onTitle: (payload) => seen.titles.push(payload),
    onTokenRequest: (payload) => seen.tokenRequests.push(payload),
    onLogout: (payload) => seen.logouts.push(payload),
    onToast: (payload) => seen.toasts.push(payload),
    onModuleError: (payload) => seen.moduleErrors.push(payload),
    logger: options.development ? (reason, info) => log(reason, info) : undefined,
  })
  const client = createModuleClient({
    shellOrigin: SHELL_ORIGIN,
    window: frames.moduleWindow,
    module: 'vendor-admin',
    moduleVersion: '1.0.0',
    supportedVersions: options.moduleVersions,
    development: options.development,
    now: () => clock,
    onAuth: (auth) => auths.push(auth),
    onNavigate: (path) => navigations.push(path),
    onShellError: (error) => shellErrors.push(error),
    logger: options.development ? (reason, info) => log(reason, info) : undefined,
  })
  return {
    ...frames,
    shell,
    client,
    seen,
    auths,
    navigations,
    shellErrors,
    lines,
    tick: (ms: number) => {
      clock += ms
    },
    /** Runs the whole handshake: ready, then the shell's auth as the answer. */
    async handshake(auth: Record<string, unknown> = authPayload()) {
      expect(client.sendReady()).toBe(true)
      await flush()
      expect(seen.ready).toHaveLength(1)
      expect(shell.sendAuth(auth as unknown as AuthPayload, { replyTo: seen.ready[0]!.id })).toBe(true)
      await flush()
    },
  }
}

describe('the handshake', () => {
  it('ready from the module, auth from the shell as the answer, the token held in memory', async () => {
    const t = setup()
    await t.handshake()
    expect(t.seen.ready[0]).toMatchObject({ module: 'vendor-admin', moduleVersion: '1.0.0', supportedVersions: [1], version: 1 })
    expect(t.auths).toEqual([authPayload()])
    expect(t.client.getAccessToken()).toBe('token-1')
    expect(t.client.getUser()).toEqual(USER)
    expect(t.shell.version).toBe(1)
  })

  it('answers a ready with an auth that replies to it', async () => {
    const t = setup()
    await t.handshake()
    const auth = t.posts.find((post) => post.from === 'shell')!.data as { replyTo?: string; type: string }
    expect(auth.type).toBe('auth')
    expect(auth.replyTo).toBe(t.seen.ready[0]!.id)
  })

  it('does not send auth before a ready has been accepted', () => {
    const t = setup()
    expect(t.shell.version).toBeUndefined()
    expect(t.shell.sendAuth(authPayload() as unknown as AuthPayload)).toBe(false)
    expect(t.posts).toEqual([])
  })

  it('is idempotent: a module that reloads sends ready again and gets the current auth again', async () => {
    const t = setup()
    await t.handshake()
    // The module reloads: a new client in the same window.
    t.client.dispose()
    const reloaded = createModuleClient({
      shellOrigin: SHELL_ORIGIN,
      window: t.moduleWindow,
      module: 'vendor-admin',
      moduleVersion: '1.0.1',
      onAuth: (auth) => t.auths.push(auth),
    })
    reloaded.sendReady()
    await flush()
    expect(t.seen.ready).toHaveLength(2)
    expect(t.seen.ready[1]!.moduleVersion).toBe('1.0.1')
    t.shell.sendAuth(authPayload() as unknown as AuthPayload, { replyTo: t.seen.ready[1]!.id })
    await flush()
    expect(reloaded.getAccessToken()).toBe('token-1')
    reloaded.dispose()
  })

  it('negotiates the highest version both sides speak, and the shell answers on it', async () => {
    const t = setup({ moduleVersions: [1, 2], shellVersions: [2, 1] })
    await t.handshake()
    expect(t.shell.version).toBe(2)
    const auth = t.posts.find((post) => post.from === 'shell')!.data as { v: number }
    expect(auth.v).toBe(2)
  })

  it('falls back to the version the module also speaks (the shell supports the previous one)', async () => {
    const t = setup({ moduleVersions: [1], shellVersions: [2, 1] })
    await t.handshake()
    expect(t.shell.version).toBe(1)
    expect(t.client.getAccessToken()).toBe('token-1')
  })

  it('answers version_unsupported, tells the shell app, and lets the module learn why', async () => {
    const t = setup({ moduleVersions: [5], shellVersions: [2, 1] })
    t.client.sendReady()
    await flush()
    expect(t.seen.ready).toEqual([])
    expect(t.seen.unsupported).toEqual([
      expect.objectContaining({ module: 'vendor-admin', moduleVersion: '1.0.0', supportedVersions: [5] }),
    ])
    expect(t.shell.version).toBeUndefined()
    expect(t.shell.sendAuth(authPayload() as unknown as AuthPayload)).toBe(false)
    // The answer is an `error` on the shell's own highest version, which the module reads even
    // though it does not speak that version.
    expect(t.posts.find((post) => post.from === 'shell')).toMatchObject({ data: { type: 'error', v: 2, payload: { code: 'version_unsupported' } } })
    expect(t.shellErrors).toEqual([{ code: 'version_unsupported', message: expect.any(String) }])
    expect(t.client.getAccessToken()).toBeUndefined()
  })
})

describe('everything a module can say', () => {
  it('title, toast, token request, logout and error reach the shell as typed events', async () => {
    const t = setup()
    await t.handshake()
    expect(t.client.sendTitle('/orders/42', 'Order 42')).toBe(true)
    expect(t.client.sendToast({ level: 'success', message: 'Saved.', durationMs: 3000 })).toBe(true)
    expect(t.client.requestToken('unauthorized')).toBe(true)
    expect(t.client.sendLogout('user_choice')).toBe(true)
    expect(t.client.sendError('render_failed', 'The list did not load.', true)).toBe(true)
    await flush()
    expect(t.seen.titles).toEqual([{ path: '/orders/42', title: 'Order 42' }])
    expect(t.seen.toasts).toEqual([{ level: 'success', message: 'Saved.', durationMs: 3000 }])
    expect(t.seen.tokenRequests).toEqual([{ reason: 'unauthorized' }])
    expect(t.seen.logouts).toEqual([{ reason: 'user_choice' }])
    expect(t.seen.moduleErrors).toEqual([{ code: 'render_failed', message: 'The list did not load.', fatal: true }])
  })

  it('refuses to send what is not valid, so a bug in a module cannot put junk on the wire', async () => {
    const t = setup()
    await t.handshake()
    const before = t.posts.length
    expect(t.client.sendTitle('orders', 'x')).toBe(false)
    expect(t.client.sendToast({ level: 'info', message: 'x'.repeat(281) })).toBe(false)
    expect(t.client.sendToast({ level: 'info', message: '<b>hi</b>' })).toBe(false)
    expect(t.client.sendError('', 'x', false)).toBe(false)
    expect(t.posts.length).toBe(before)
  })

  it('asks for a token at most once every 30 seconds', async () => {
    const t = setup()
    await t.handshake()
    expect(t.client.requestToken('expired')).toBe(true)
    t.tick(29_999)
    expect(t.client.requestToken('expired')).toBe(false)
    t.tick(1)
    expect(t.client.requestToken('expired')).toBe(true)
    await flush()
    expect(t.seen.tokenRequests).toHaveLength(2)
  })
})

describe('everything the shell can say', () => {
  it('navigate and error reach the module', async () => {
    const t = setup()
    await t.handshake()
    expect(t.shell.sendNavigate('/orders/42?tab=2')).toBe(true)
    expect(t.shell.sendError('session_ending', 'Your session is ending.')).toBe(true)
    await flush()
    expect(t.navigations).toEqual(['/orders/42?tab=2'])
    expect(t.shellErrors).toEqual([{ code: 'session_ending', message: 'Your session is ending.' }])
  })

  it('refuses to send a path that is not inside the module, or an auth that is not valid', async () => {
    const t = setup()
    await t.handshake()
    const before = t.posts.length
    expect(t.shell.sendNavigate('//evil.example')).toBe(false)
    expect(t.shell.sendNavigate('https://evil.example')).toBe(false)
    expect(t.shell.sendAuth({ ...authPayload(), accessToken: '' } as unknown as AuthPayload)).toBe(false)
    expect(t.shell.sendError('', 'x')).toBe(false)
    expect(t.posts.length).toBe(before)
  })

  it('pushes a new auth on refresh, and the module replaces its token', async () => {
    const t = setup()
    await t.handshake()
    t.shell.sendAuth(authPayload({ accessToken: 'token-2', expiresAt: 2_000_000_900 }) as unknown as AuthPayload)
    await flush()
    expect(t.client.getAccessToken()).toBe('token-2')
    expect(t.auths).toHaveLength(2)
  })

  it('accepts the same expiry again (a resend), and a newer one', async () => {
    const t = setup()
    await t.handshake()
    t.shell.sendAuth(authPayload({ accessToken: 'resent' }) as unknown as AuthPayload)
    await flush()
    expect(t.client.getAccessToken()).toBe('resent')
  })
})

describe('the token in the module', () => {
  it('has none before the first auth and after it expires, and says when it needs a new one', async () => {
    const t = setup()
    expect(t.client.getAccessToken()).toBeUndefined()
    expect(t.client.needsToken()).toBe(true)
    // Expires at 1_700_000_900 s; the clock starts at 1_700_000_000 s.
    await t.handshake(authPayload({ expiresAt: 1_700_000_900 }))
    expect(t.client.needsToken()).toBe(false)
    t.tick(869_000)
    expect(t.client.needsToken()).toBe(false)
    t.tick(2_000)
    expect(t.client.getAccessToken()).toBe('token-1')
    expect(t.client.needsToken()).toBe(true)
    t.tick(30_000)
    expect(t.client.getAccessToken()).toBeUndefined()
  })

  it('is forgotten when the client is disposed', async () => {
    const t = setup()
    await t.handshake()
    t.client.dispose()
    expect(t.client.getAccessToken()).toBeUndefined()
  })
})

describe('hostile cases: a replayed auth', () => {
  it('ignores an auth with an older expiresAt than the token the module holds', async () => {
    const t = setup({ development: true })
    await t.handshake(authPayload({ accessToken: 'new', expiresAt: 2_000_000_900 }))
    t.shell.sendAuth(authPayload({ accessToken: 'old-replayed', expiresAt: 2_000_000_100 }) as unknown as AuthPayload)
    await flush()
    expect(t.client.getAccessToken()).toBe('new')
    expect(t.auths).toHaveLength(1)
    expect(t.lines.some((line) => line[0] === 'stale_auth')).toBe(true)
  })

  it('ignores a replay a hostile frame posts with the shell’s own earlier message', async () => {
    const t = setup()
    await t.handshake(authPayload({ accessToken: 'new', expiresAt: 2_000_000_900 }))
    const older = envelope('auth', authPayload({ accessToken: 'older', expiresAt: 2_000_000_100 }))
    t.toModule(older, SHELL_ORIGIN, t.shellWindow)
    await flush()
    expect(t.client.getAccessToken()).toBe('new')
  })
})

describe('hostile cases: the wrong sender', () => {
  const ready = () => envelope('ready', { module: 'vendor-admin', supportedVersions: [1], moduleVersion: '9' })

  it('the shell ignores a message from another origin, even from the module’s own window', async () => {
    const t = setup({ development: true })
    t.toShell(ready(), OTHER_ORIGIN, t.moduleWindow)
    await flush()
    expect(t.seen.ready).toEqual([])
    expect(t.posts).toEqual([])
  })

  it('the shell ignores a message from the right origin but another window (a second frame)', async () => {
    const t = setup()
    t.toShell(ready(), MODULE_ORIGIN, t.attackerWindow)
    t.toShell(ready(), MODULE_ORIGIN, null)
    t.toShell(ready(), MODULE_ORIGIN, t.shellWindow)
    await flush()
    expect(t.seen.ready).toEqual([])
    expect(t.posts).toEqual([])
  })

  it('the module ignores an auth from another origin, even from the parent window', async () => {
    const t = setup()
    t.toModule(envelope('auth', authPayload({ accessToken: 'stolen' })), OTHER_ORIGIN, t.shellWindow)
    await flush()
    expect(t.client.getAccessToken()).toBeUndefined()
    expect(t.auths).toEqual([])
  })

  it('the module ignores an auth from the shell’s origin but another window (an attacker who framed it)', async () => {
    const t = setup()
    t.toModule(envelope('auth', authPayload({ accessToken: 'stolen' })), SHELL_ORIGIN, t.attackerWindow)
    t.toModule(envelope('auth', authPayload({ accessToken: 'stolen' })), SHELL_ORIGIN, null)
    t.toModule(envelope('auth', authPayload({ accessToken: 'stolen' })), SHELL_ORIGIN, t.moduleWindow)
    await flush()
    expect(t.client.getAccessToken()).toBeUndefined()
  })

  it('a frame of another origin cannot navigate the module or end its session', async () => {
    const t = setup()
    await t.handshake()
    t.toModule(envelope('navigate', { path: '/admin/secret' }), OTHER_ORIGIN, t.attackerWindow)
    t.toModule(envelope('error', { code: 'x', message: 'y' }), OTHER_ORIGIN, t.attackerWindow)
    await flush()
    expect(t.navigations).toEqual([])
    expect(t.shellErrors).toEqual([])
  })

  it('the shell ignores a logout, toast or token request from a frame that is not its module', async () => {
    const t = setup()
    await t.handshake()
    t.toShell(envelope('logout', {}), MODULE_ORIGIN, t.attackerWindow)
    t.toShell(envelope('toast', { level: 'error', message: 'Phish' }), OTHER_ORIGIN, t.attackerWindow)
    t.toShell(envelope('token:request', { reason: 'expired' }), OTHER_ORIGIN, t.moduleWindow)
    await flush()
    expect(t.seen.logouts).toEqual([])
    expect(t.seen.toasts).toEqual([])
    expect(t.seen.tokenRequests).toEqual([])
  })

  it('a module that is not framed (its parent is itself) sends nothing and reads nothing', async () => {
    const frames = createFrames()
    const client = createModuleClient({ shellOrigin: SHELL_ORIGIN, window: frames.shellWindow, module: 'm', moduleVersion: '1' })
    expect(client.sendReady()).toBe(false)
    expect(client.sendToast({ level: 'info', message: 'x' })).toBe(false)
    frames.toModule(envelope('auth', authPayload()), SHELL_ORIGIN, frames.shellWindow)
    await flush()
    expect(client.getAccessToken()).toBeUndefined()
    expect(frames.posts).toEqual([])
    client.dispose()
  })
})

describe('hostile cases: a bad message from the right sender', () => {
  async function ready(t: ReturnType<typeof setup>) {
    await t.handshake()
  }

  it('drops an oversize message, however well-formed its start', async () => {
    const t = setup({ development: true })
    await ready(t)
    const huge = envelope('toast', { level: 'info', message: 'ok', padding: 'x'.repeat(MAX_MESSAGE_BYTES) })
    t.toShell(huge, MODULE_ORIGIN, t.moduleWindow)
    await flush()
    expect(t.seen.toasts).toEqual([])
    expect(t.lines.some((line) => line[0] === 'too_large')).toBe(true)
  })

  it('drops a message that hides its bulk in something JSON cannot see (a Map, a buffer)', async () => {
    const t = setup({ development: true })
    await ready(t)
    const padded = envelope('toast', { level: 'info', message: 'ok', padding: new Map([['k', 'x'.repeat(MAX_MESSAGE_BYTES)]]) })
    t.toShell(structuredClone(padded), MODULE_ORIGIN, t.moduleWindow)
    t.toModule(structuredClone(envelope('navigate', { path: '/', padding: new ArrayBuffer(MAX_MESSAGE_BYTES * 4) })), SHELL_ORIGIN, t.shellWindow)
    await flush()
    expect(t.seen.toasts).toEqual([])
    expect(t.navigations).toEqual([])
    expect(t.lines.filter((line) => line[0] === 'too_large')).toHaveLength(2)
  })

  it('drops an oversize auth in the module too', async () => {
    const t = setup()
    t.toModule(envelope('auth', authPayload({ padding: 'x'.repeat(MAX_MESSAGE_BYTES) })), SHELL_ORIGIN, t.shellWindow)
    await flush()
    expect(t.auths).toEqual([])
  })

  it('does not send an oversize message either', async () => {
    const t = setup()
    await ready(t)
    const before = t.posts.length
    expect(t.client.sendToast({ level: 'info', message: 'x'.repeat(280), durationMs: 1 })).toBe(true)
    expect(t.client.sendLogout('x'.repeat(200))).toBe(true)
    expect(t.posts.length).toBe(before + 2)
  })

  it.each([
    ['null', null],
    ['a string', 'ready'],
    ['an array', [1, 2]],
    ['an empty object', {}],
    ['a payload that is a string', envelope('toast', 'hello')],
    ['a missing id', envelope('logout', {}, { id: undefined })],
    ['a type that is a number', envelope('logout', {}, { type: 5 })],
  ])('drops a malformed message: %s', async (_name, data) => {
    const t = setup({ development: true })
    await ready(t)
    t.toShell(data, MODULE_ORIGIN, t.moduleWindow)
    await flush()
    expect(t.seen.logouts).toEqual([])
    expect(t.seen.toasts).toEqual([])
    expect(t.lines.length).toBeGreaterThan(0)
  })

  it('drops a message of another protocol, in both directions', async () => {
    const t = setup()
    await ready(t)
    t.toShell(envelope('logout', {}, { protocol: 'something-else' }), MODULE_ORIGIN, t.moduleWindow)
    t.toModule(envelope('auth', authPayload({ accessToken: 'x' }), { protocol: 'something-else' }), SHELL_ORIGIN, t.shellWindow)
    await flush()
    expect(t.seen.logouts).toEqual([])
    expect(t.client.getAccessToken()).toBe('token-1')
  })

  it('drops a message of another version once the version is agreed, in both directions', async () => {
    const t = setup({ development: true })
    await ready(t)
    t.toShell(envelope('logout', {}, { v: 2 }), MODULE_ORIGIN, t.moduleWindow)
    t.toModule(envelope('auth', authPayload({ accessToken: 'v2' }), { v: 2 }), SHELL_ORIGIN, t.shellWindow)
    await flush()
    expect(t.seen.logouts).toEqual([])
    expect(t.client.getAccessToken()).toBe('token-1')
    expect(t.lines.filter((line) => line[0] === 'wrong_version')).toHaveLength(2)
  })

  it('drops an unknown type, in both directions', async () => {
    const t = setup({ development: true })
    await ready(t)
    t.toShell(envelope('open-door', {}), MODULE_ORIGIN, t.moduleWindow)
    t.toModule(envelope('open-door', {}), SHELL_ORIGIN, t.shellWindow)
    await flush()
    expect(t.lines.filter((line) => line[0] === 'unknown_type')).toHaveLength(2)
  })

  it('drops a payload that fails validation, and unknown fields never reach the handler', async () => {
    const t = setup()
    await ready(t)
    t.toShell(envelope('toast', { level: 'info', message: 'ok', onclick: 'alert(1)' }), MODULE_ORIGIN, t.moduleWindow)
    t.toShell(envelope('toast', { level: 'loud', message: 'ok' }), MODULE_ORIGIN, t.moduleWindow)
    t.toShell(envelope('title', { path: 'no-slash', title: 'x' }), MODULE_ORIGIN, t.moduleWindow)
    await flush()
    expect(t.seen.toasts).toEqual([{ level: 'info', message: 'ok' }])
    expect(t.seen.titles).toEqual([])
  })

  it('reads nothing but ready until a ready has been accepted', async () => {
    const t = setup({ development: true })
    t.toShell(envelope('logout', {}), MODULE_ORIGIN, t.moduleWindow)
    t.toShell(envelope('toast', { level: 'info', message: 'early' }), MODULE_ORIGIN, t.moduleWindow)
    await flush()
    expect(t.seen.logouts).toEqual([])
    expect(t.seen.toasts).toEqual([])
    expect(t.lines.filter((line) => line[0] === 'before_ready')).toHaveLength(2)
  })

  it('keeps working after a message a handler could not handle', async () => {
    const frames = createFrames()
    const logged: string[] = []
    const toasts: ToastPayload[] = []
    createShellChannel({
      iframe: frames.moduleFrame,
      origin: MODULE_ORIGIN,
      window: frames.shellWindow,
      development: true,
      logger: (reason) => logged.push(reason),
      onReady: () => {},
      onToast: (toast) => {
        toasts.push(toast)
        if (toast.message === 'boom') throw new Error('handler bug')
      },
    })
    const client = createModuleClient({ shellOrigin: SHELL_ORIGIN, window: frames.moduleWindow, module: 'm', moduleVersion: '1' })
    client.sendReady()
    await flush()
    client.sendToast({ level: 'info', message: 'boom' })
    client.sendToast({ level: 'info', message: 'after' })
    await flush()
    expect(toasts.map((toast) => toast.message)).toEqual(['boom', 'after'])
    expect(logged).toContain('handler_error')
  })
})

describe('no message is ever posted to *', () => {
  it('across a whole session, every post names an exact origin', async () => {
    const t = setup({ development: true })
    await t.handshake()
    t.client.sendTitle('/a', 'A')
    t.client.sendToast({ level: 'info', message: 'x' })
    t.client.requestToken('expired')
    t.client.sendLogout()
    t.client.sendError('e', 'm', false)
    t.shell.sendNavigate('/a')
    t.shell.sendError('e', 'm')
    t.shell.sendAuth(authPayload({ accessToken: 't2' }) as unknown as AuthPayload)
    await flush()
    expect(t.posts.length).toBeGreaterThan(8)
    for (const post of t.posts) {
      expect(post.targetOrigin).not.toBe('*')
      expect(post.targetOrigin).toBe(post.from === 'shell' ? MODULE_ORIGIN : SHELL_ORIGIN)
    }
  })

  it('a module of the right shell origin posts only to that origin; one aimed elsewhere would not be delivered', async () => {
    const t = setup()
    t.client.sendReady()
    await flush()
    // The harness drops a message whose target origin is not the receiver's, like a browser does.
    expect(t.posts.every((post) => post.targetOrigin === SHELL_ORIGIN)).toBe(true)
    expect(t.seen.ready).toHaveLength(1)
  })

  it.each(['*', 'https://*.shazlo.test', undefined, '', 'https://one.shazlo.test/', 'http://one.shazlo.test'])(
    'a module cannot be set up with the shell origin %j',
    (shellOrigin) => {
      const frames = createFrames()
      expect(() => createModuleClient({ shellOrigin, window: frames.moduleWindow, module: 'm', moduleVersion: '1' })).toThrow(ProtocolConfigError)
    },
  )

  it.each(['*', 'https://*.shazlo.test', '', 'https://vendor-admin.shazlo.test/', 'http://vendor-admin.shazlo.test'])(
    'a shell cannot be set up with the module origin %j',
    (origin) => {
      const frames = createFrames()
      expect(() => createShellChannel({ iframe: frames.moduleFrame, origin, window: frames.shellWindow })).toThrow(ProtocolConfigError)
    },
  )

  it('allows an http localhost origin only in a development build', () => {
    const frames = createFrames()
    expect(() => createModuleClient({ shellOrigin: 'http://localhost:5173', window: frames.moduleWindow, module: 'm', moduleVersion: '1' })).toThrow(
      ProtocolConfigError,
    )
    const dev = createModuleClient({
      shellOrigin: 'http://localhost:5173',
      window: frames.moduleWindow,
      module: 'm',
      moduleVersion: '1',
      development: true,
    })
    dev.dispose()
  })
})

describe('listening before sending', () => {
  it('the shell hears a ready that arrives the moment the frame loads, because it listened first', async () => {
    const frames = createFrames()
    const readies: ReadyInfo[] = []
    createShellChannel({ iframe: frames.moduleFrame, origin: MODULE_ORIGIN, window: frames.shellWindow, onReady: (info) => readies.push(info) })
    // Only now does the module exist and speak.
    const client = createModuleClient({ shellOrigin: SHELL_ORIGIN, window: frames.moduleWindow, module: 'm', moduleVersion: '1' })
    client.sendReady()
    await flush()
    expect(readies).toHaveLength(1)
    client.dispose()
  })

  it('the module hears an auth that arrives straight after its ready, because it listened first', async () => {
    const t = setup()
    t.client.sendReady()
    // The shell answers in the same turn it hears the ready.
    await flush()
    t.shell.sendAuth(authPayload() as unknown as AuthPayload, { replyTo: t.seen.ready[0]!.id })
    await flush()
    expect(t.client.getAccessToken()).toBe('token-1')
  })
})

describe('disposing', () => {
  it('stops both ends from reading and sending', async () => {
    const t = setup()
    await t.handshake()
    t.shell.dispose()
    t.client.dispose()
    const before = t.posts.length
    t.toShell(envelope('toast', { level: 'info', message: 'late' }), MODULE_ORIGIN, t.moduleWindow)
    t.toModule(envelope('navigate', { path: '/late' }), SHELL_ORIGIN, t.shellWindow)
    await flush()
    expect(t.seen.toasts).toEqual([])
    expect(t.navigations).toEqual([])
    expect(t.shell.sendNavigate('/x')).toBe(false)
    expect(t.client.sendToast({ level: 'info', message: 'x' })).toBe(false)
    expect(t.posts.length).toBe(before)
  })
})

describe('development and production logging', () => {
  it('a development build logs each dropped message with the reason, the type and the origin, but not the content', async () => {
    const t = setup({ development: true })
    await t.handshake()
    t.toShell(envelope('toast', { level: 'loud', message: 'SECRET-CONTENT' }), MODULE_ORIGIN, t.moduleWindow)
    await flush()
    const line = t.lines.find((entry) => entry[0] === 'invalid_payload')!
    expect(line[1]).toEqual({ type: 'toast', origin: MODULE_ORIGIN })
    expect(JSON.stringify(t.lines)).not.toContain('SECRET-CONTENT')
  })

  it('a production build stays silent, whatever is dropped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = setup()
    await t.handshake()
    t.toShell(envelope('toast', { level: 'loud', message: 'x' }), MODULE_ORIGIN, t.moduleWindow)
    t.toShell({ junk: true }, MODULE_ORIGIN, t.moduleWindow)
    t.toShell(envelope('toast', { level: 'info', message: 'x' }), OTHER_ORIGIN, t.attackerWindow)
    t.toModule(envelope('open-door', {}), SHELL_ORIGIN, t.shellWindow)
    await flush()
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not log a message from an untrusted sender even in development (a framing page could flood the console)', async () => {
    const t = setup({ development: true })
    t.toShell(envelope('toast', { level: 'info', message: 'x' }), OTHER_ORIGIN, t.attackerWindow)
    await flush()
    expect(t.lines).toEqual([])
  })
})
