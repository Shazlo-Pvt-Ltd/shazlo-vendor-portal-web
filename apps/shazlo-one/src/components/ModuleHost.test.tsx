import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkError } from '../api/errors'
import { setModuleFailureReporter } from '../modules/moduleFailure'
import { entry } from '../modules/testing'
import { apiError, makeStore, sessionBody } from '../session/testing'
import { SHELL_ORIGIN, attachModule, bridge, currentFrame, deliver, readyMessage } from '../test/frameBridge'
import { renderRoute } from '../test/renderRoute'
import { setViewport } from '../test/viewport'
import { IFRAME_SANDBOX, MAX_RETRIES, READY_TIMEOUT_MS } from './ModuleHost'

const MODULES = [
  entry({ id: 'vendor-admin', title: 'Vendor admin' }),
  // The same audience as the first: two modules that use one backend.
  entry({ id: 'catalog', title: 'Catalog', origin: 'https://catalog.shazlo.test', url: 'https://catalog.shazlo.test/' }),
]
const [VENDOR_ADMIN] = MODULES
const ORIGIN = VENDOR_ADMIN!.origin

afterEach(() => {
  vi.useRealTimers()
  setModuleFailureReporter(undefined)
})

/** Lets promises and (fake) timers run, inside `act`, so React has rendered what they caused. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let round = 0; round < 6; round += 1) await Promise.resolve()
  })
}

/** An exchange that gives each call its own token, and can be made to fail. */
function exchange(fail?: (call: number) => unknown) {
  let calls = 0
  return vi.fn(async (audience: string) => {
    calls += 1
    const error = fail?.(calls)
    if (error) throw error
    return { access_token: `mod-token-${calls}`, token_type: 'Bearer', expires_in: 300, audience }
  })
}

async function open(path = '/m/vendor-admin', exchangeFn = exchange()) {
  // Only the timers and the clock: the 10-second wait is deterministic, and a token can age.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  setViewport(1280)
  const body = sessionBody({ roles: ['vendor_reviewer'] })
  const store = makeStore({ refresh: async () => body, fetchMe: async () => body.admin, exchange: exchangeFn }).store
  const router = renderRoute(path, { store, modules: MODULES })
  await settle()
  await settle()
  return { router, store, exchange: exchangeFn }
}

/** The module, in the frame the shell made, says `ready`. */
async function moduleSaysReady(options: Parameters<typeof attachModule>[0] = { moduleOrigin: ORIGIN }) {
  const module = attachModule(options)
  expect(module.client.sendReady()).toBe(true)
  await settle()
  return module
}

const frames = () => document.querySelectorAll('iframe').length
const retry = () => fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

describe('the frame', () => {
  it('has a title, the sandbox of ADR 0001, no referrer and no powerful features', async () => {
    await open()
    const frame = currentFrame()
    expect(frame.getAttribute('title')).toBe('Vendor admin')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-downloads')
    expect(IFRAME_SANDBOX).toBe('allow-scripts allow-same-origin allow-forms allow-downloads')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.getAttribute('allow')).toBe('')
  })

  it('never lets the module navigate the shell, open windows or use dialogs', async () => {
    await open()
    const sandbox = currentFrame().getAttribute('sandbox')!.split(' ')
    for (const forbidden of ['allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-popups', 'allow-modals', 'allow-popups-to-escape-sandbox']) {
      expect(sandbox).not.toContain(forbidden)
    }
  })

  it('is loaded from exactly the registry url, which holds nothing else', async () => {
    await open()
    expect(currentFrame().getAttribute('src')).toBe(VENDOR_ADMIN!.url)
  })

  it('has its listener up before it is given an address', async () => {
    const events: string[] = []
    const page = document.defaultView!
    const addEventListener = page.addEventListener.bind(page)
    vi.spyOn(page, 'addEventListener').mockImplementation(((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
      if (type === 'message') events.push('listen')
      addEventListener(type, listener, options)
    }) as typeof page.addEventListener)
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')!
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      configurable: true,
      get() {
        return original.get!.call(this)
      },
      set(value: string) {
        events.push('src')
        original.set!.call(this, value)
      },
    })
    try {
      await open()
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', original)
    }
    expect(events).toEqual(['listen', 'src'])
  })
})

describe('the handshake', () => {
  it('shows a loading state while the module starts, and keeps the shell’s own chrome usable', async () => {
    await open()
    expect(screen.getByRole('status').textContent).toMatch(/Loading Vendor admin/)
    expect(screen.getByRole('heading', { level: 1, name: 'Vendor admin' })).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: 'Modules' })
    expect(within(nav).getByRole('link', { name: 'Home' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Asha Admin' })).toBeTruthy()
    // The frame is loading but not shown.
    expect(currentFrame().style.visibility).toBe('hidden')
  })

  it('answers ready with a token for the module’s own audience, replying to it, and shows the frame', async () => {
    const { exchange: spy } = await open()
    const module = await moduleSaysReady()
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]![0]).toBe('vendor-api')
    expect(module.auths).toHaveLength(1)
    const auth = module.auths[0]!
    expect(auth.accessToken).toBe('mod-token-1')
    expect(auth.user).toEqual({ id: 'a1', email: 'admin@shazlo.test', roles: ['vendor_reviewer'] })
    expect(Number.isInteger(auth.expiresAt)).toBe(true)
    // Epoch seconds, about five minutes from now.
    const secondsLeft = auth.expiresAt - Date.now() / 1000
    expect(secondsLeft).toBeGreaterThan(280)
    expect(secondsLeft).toBeLessThanOrEqual(300)
    // The reply carries the id of the ready it answers.
    const ready = module.posts.find((post) => post.from === 'module')!.data as { id: string }
    const sent = module.posts.find((post) => post.from === 'shell')!.data as { type: string; replyTo?: string }
    expect(sent.type).toBe('auth')
    expect(sent.replyTo).toBe(ready.id)
    expect(screen.queryByRole('status')).toBeNull()
    expect(currentFrame().style.visibility).toBe('visible')
  })

  it('answers a second ready (the module reloaded) with the current auth, without another exchange', async () => {
    const { exchange: spy } = await open()
    const module = await moduleSaysReady()
    expect(module.client.sendReady()).toBe(true)
    await settle()
    expect(module.auths).toHaveLength(2)
    expect(module.auths[1]!.accessToken).toBe(module.auths[0]!.accessToken)
    expect(spy).toHaveBeenCalledOnce()
    const replies = module.posts.filter((post) => post.from === 'shell').map((post) => (post.data as { replyTo: string }).replyTo)
    const readies = module.posts.filter((post) => post.from === 'module').map((post) => (post.data as { id: string }).id)
    expect(replies).toEqual(readies)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sends a module that is already past its timeout nothing: ready in time stops the clock', async () => {
    await open()
    await settle(READY_TIMEOUT_MS - 1_000)
    await moduleSaysReady()
    await settle(60_000)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(frames()).toBe(1)
  })
})

describe('where the token goes', () => {
  it('is never in the frame’s address, the page, a URL or web storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { router } = await open()
    await moduleSaysReady()
    const token = 'mod-token-1'
    expect(currentFrame().getAttribute('src')).toBe(VENDOR_ADMIN!.url)
    expect(currentFrame().src).not.toContain(token)
    expect(document.documentElement.outerHTML).not.toContain(token)
    expect(`${router.state.location.pathname}${router.state.location.search}${router.state.location.hash}`).not.toContain(token)
    expect(document.location.href).not.toContain(token)
    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(token)
  })

  it('is not logged, even in development, by anything the host does', async () => {
    const lines: unknown[][] = []
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args))
    }
    await open()
    const module = await moduleSaysReady()
    module.client.sendToast({ level: 'info', message: 'x' })
    deliver(module.shellWindow, { junk: true }, ORIGIN, module.frameWindow)
    await settle()
    expect(JSON.stringify(lines)).not.toContain('mod-token')
  })

  it('goes only to the module’s own frame, at its exact origin, never to *', async () => {
    await open()
    const module = await moduleSaysReady()
    for (const post of module.posts.filter((entry) => entry.from === 'shell')) expect(post.targetOrigin).toBe(ORIGIN)
    expect(module.posts.every((post) => post.targetOrigin !== '*')).toBe(true)
  })

  it('is dropped when the module’s page is left: coming back needs a new exchange', async () => {
    const { router, exchange: spy } = await open()
    await moduleSaysReady()
    expect(spy).toHaveBeenCalledTimes(1)
    await act(async () => {
      await router.navigate('/')
    })
    await settle()
    expect(frames()).toBe(0)
    await act(async () => {
      await router.navigate('/m/vendor-admin')
    })
    await settle()
    const second = await moduleSaysReady()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(second.auths[0]!.accessToken).toBe('mod-token-2')
  })

  it('stops listening when the page is left: a later ready is not answered', async () => {
    const { router, exchange: spy } = await open()
    const first = await moduleSaysReady()
    await act(async () => {
      await router.navigate('/')
    })
    await settle()
    deliver(first.shellWindow, readyMessage(), ORIGIN, first.frameWindow)
    await settle()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('is never shared between modules, even two that use the same audience', async () => {
    const { router, exchange: spy } = await open()
    const first = await moduleSaysReady()
    await act(async () => {
      await router.navigate('/m/catalog')
    })
    await settle()
    const second = await moduleSaysReady({ moduleOrigin: 'https://catalog.shazlo.test', module: 'catalog' })
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls.map((call) => call[0])).toEqual(['vendor-api', 'vendor-api'])
    expect(first.auths[0]!.accessToken).toBe('mod-token-1')
    expect(second.auths[0]!.accessToken).toBe('mod-token-2')
    expect(second.auths[0]!.accessToken).not.toBe(first.auths[0]!.accessToken)
  })
})

describe('a version mismatch', () => {
  it('sends error version_unsupported, shows a panel naming the module and its version, and sends no token', async () => {
    const { exchange: spy } = await open()
    const module = attachModule({ moduleOrigin: ORIGIN, supportedVersions: [9], moduleVersion: '4.2.0' })
    module.client.sendReady()
    await settle()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/Vendor admin cannot talk to this shell/)
    expect(alert.textContent).toMatch(/Vendor admin \(version 4\.2\.0\) speaks protocol version 9; this shell speaks 1/)
    expect(module.errors).toEqual([{ code: 'version_unsupported', message: expect.any(String) }])
    expect(module.auths).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    expect(frames()).toBe(0)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('does not start the 10-second clock again once the module has answered', async () => {
    await open()
    const module = attachModule({ moduleOrigin: ORIGIN, supportedVersions: [9] })
    module.client.sendReady()
    await settle()
    await settle(30_000)
    expect(screen.getByRole('alert').textContent).toMatch(/cannot talk to this shell/)
  })
})

describe('a module that does not answer', () => {
  it('shows a clear error with Retry after 10 seconds, not before, and removes the frame', async () => {
    const { exchange: spy } = await open()
    await settle(READY_TIMEOUT_MS - 1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/Loading Vendor admin/)
    await settle(1)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/Vendor admin did not respond/)
    expect(alert.textContent).toMatch(/Nothing from your session was sent to it/)
    expect(frames()).toBe(0)
    expect(spy).not.toHaveBeenCalled()
  })

  it('reloads with Retry: a new frame, a new wait, and a working module then gets its token', async () => {
    const { exchange: spy } = await open()
    await settle(READY_TIMEOUT_MS)
    const firstFrame = document.querySelector('iframe')
    retry()
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/Loading/)
    expect(frames()).toBe(1)
    expect(currentFrame()).not.toBe(firstFrame)
    const module = await moduleSaysReady()
    expect(module.auths).toHaveLength(1)
    expect(spy).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says "unavailable" after 3 failed retries, offers no more Retry, and reports it once', async () => {
    const reported: unknown[] = []
    setModuleFailureReporter((failure) => reported.push(failure))
    const { exchange: spy } = await open()
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      await settle(READY_TIMEOUT_MS)
      expect(screen.getByRole('alert').textContent).toMatch(/did not respond/)
      expect(reported).toEqual([])
      retry()
      await settle()
    }
    await settle(READY_TIMEOUT_MS)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/Vendor admin is unavailable/)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe('/')
    expect(frames()).toBe(0)
    expect(reported).toEqual([{ moduleId: 'vendor-admin', reason: 'no_ready', attempts: MAX_RETRIES + 1 }])
    await settle(120_000)
    expect(reported).toHaveLength(1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('counts a module that answers as a success: the budget starts over', async () => {
    await open()
    await settle(READY_TIMEOUT_MS)
    retry()
    await settle()
    await settle(READY_TIMEOUT_MS)
    retry()
    await settle()
    await moduleSaysReady()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('looks the same when the frame is blocked (CSP or framing): the parent just never hears ready', async () => {
    const { exchange: spy } = await open()
    // The frame exists but nothing in it ever speaks.
    expect(frames()).toBe(1)
    await settle(READY_TIMEOUT_MS)
    expect(screen.getByRole('alert').textContent).toMatch(/blocked from loading here/)
    expect(spy).not.toHaveBeenCalled()
  })

  it('keeps the shell’s chrome usable on the error panel', async () => {
    await open()
    await settle(READY_TIMEOUT_MS)
    const nav = screen.getByRole('navigation', { name: 'Modules' })
    expect(within(nav).getAllByRole('link').length).toBeGreaterThan(1)
    expect(screen.getByRole('button', { name: 'Asha Admin' })).toBeTruthy()
  })
})

describe('a ready from the wrong sender', () => {
  async function expectNoToken(spy: ReturnType<typeof exchange>, module: ReturnType<typeof attachModule>) {
    await settle()
    expect(spy).not.toHaveBeenCalled()
    expect(module.auths).toEqual([])
    expect(module.posts.filter((post) => post.from === 'shell')).toEqual([])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/Loading/)
  }

  it('from another origin, even from the module’s own window, is ignored', async () => {
    const { exchange: spy } = await open()
    const module = attachModule({ moduleOrigin: ORIGIN })
    deliver(module.shellWindow, readyMessage(), 'https://evil.example', module.frameWindow)
    await expectNoToken(spy, module)
  })

  it('from the right origin but another window, is ignored', async () => {
    const { exchange: spy } = await open()
    const module = attachModule({ moduleOrigin: ORIGIN })
    const attacker = document.createElement('iframe')
    document.body.append(attacker)
    deliver(module.shellWindow, readyMessage(), ORIGIN, attacker.contentWindow)
    deliver(module.shellWindow, readyMessage(), ORIGIN, null)
    deliver(module.shellWindow, readyMessage(), ORIGIN, module.shellWindow)
    await expectNoToken(spy, module)
    attacker.remove()
  })

  it('from a frame of another module (a sibling origin), is ignored', async () => {
    const { exchange: spy } = await open()
    const module = attachModule({ moduleOrigin: ORIGIN })
    deliver(module.shellWindow, readyMessage(), 'https://catalog.shazlo.test', module.frameWindow)
    await expectNoToken(spy, module)
  })

  it('is followed by the error panel with Retry, and still no token', async () => {
    const { exchange: spy } = await open()
    const module = attachModule({ moduleOrigin: ORIGIN })
    deliver(module.shellWindow, readyMessage(), 'https://evil.example', module.frameWindow)
    await settle(READY_TIMEOUT_MS)
    expect(screen.getByRole('alert').textContent).toMatch(/did not respond/)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
    expect(module.auths).toEqual([])
  })

  it('a malformed or oversize ready from the right sender gets no token either', async () => {
    const { exchange: spy } = await open()
    const module = attachModule({ moduleOrigin: ORIGIN })
    deliver(module.shellWindow, readyMessage({ payload: { module: '', supportedVersions: [], moduleVersion: '' } }), ORIGIN, module.frameWindow)
    deliver(module.shellWindow, readyMessage({ protocol: 'other' }), ORIGIN, module.frameWindow)
    deliver(module.shellWindow, { ...readyMessage(), padding: 'x'.repeat(70_000) }, ORIGIN, module.frameWindow)
    await expectNoToken(spy, module)
  })
})

describe('when the token cannot be got', () => {
  it('shows the 403 page, with no frame, when the admin lost the role (403 audience_not_allowed)', async () => {
    const { exchange: spy } = await open('/m/vendor-admin', exchange(() => apiError(403, 'audience_not_allowed')))
    const module = await moduleSaysReady()
    expect(spy).toHaveBeenCalledOnce()
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access to this module" })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(frames()).toBe(0)
    expect(module.auths).toEqual([])
    expect(document.title).toBe("You don't have access · Shazlo-One")
  })

  it.each([
    ['a network error', () => new NetworkError('network'), /Could not reach the server/],
    ['a timeout', () => new NetworkError('timeout'), /took too long/],
    ['a 503', () => apiError(503, 'unavailable'), /Something went wrong on our side/],
    ['a 500', () => apiError(500, 'internal'), /Something went wrong on our side/],
  ])('shows the error panel with Retry for %s, and no token', async (_name, failure, message) => {
    const { exchange: spy } = await open('/m/vendor-admin', exchange(() => failure()))
    const module = await moduleSaysReady()
    expect(spy).toHaveBeenCalled()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/Vendor admin could not be opened/)
    expect(alert.textContent).toMatch(message)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(module.auths).toEqual([])
    expect(frames()).toBe(0)
  })

  it('says the module is not set up on the server for 400 unknown_audience', async () => {
    await open('/m/vendor-admin', exchange(() => apiError(400, 'unknown_audience')))
    await moduleSaysReady()
    expect(screen.getByRole('alert').textContent).toMatch(/not set up on the server yet/)
  })

  it('recovers with Retry once the server is back: a new frame, a new ready, a token', async () => {
    const { exchange: spy } = await open('/m/vendor-admin', exchange((call) => (call === 1 ? new NetworkError('network') : undefined)))
    await moduleSaysReady()
    expect(screen.getByRole('alert')).toBeTruthy()
    retry()
    await settle()
    const module = await moduleSaysReady()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(module.auths).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an exchange failure on a reload replaces the frame with the panel rather than leave a half-working module', async () => {
    await open('/m/vendor-admin', exchange((call) => (call === 2 ? new NetworkError('network') : undefined)))
    const module = await moduleSaysReady()
    expect(screen.queryByRole('alert')).toBeNull()
    // The module's token (5 minutes) is about to end, so the reload needs a new exchange, which fails.
    await settle(295_000)
    expect(module.client.sendReady()).toBe(true)
    await settle()
    expect(screen.getByRole('alert').textContent).toMatch(/Vendor admin could not be opened/)
    expect(frames()).toBe(0)
    expect(module.auths).toHaveLength(1)
  })
})

describe('the page around the frame', () => {
  it('has one h1 and one main, and the module’s title in the page title', async () => {
    await open()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(document.title).toBe('Vendor admin · Shazlo-One')
  })

  it('does not render a frame for a module the admin may not open, or one that does not exist', async () => {
    await open('/m/nope')
    expect(frames()).toBe(0)
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
  })

  it('uses the bridge only after the frame exists (sanity check of the harness itself)', async () => {
    await open()
    const frame = currentFrame()
    const { frameWindow, shellWindow, posts } = bridge(frame, ORIGIN)
    expect(frameWindow.parent).toBe(shellWindow)
    expect(posts).toEqual([])
    expect(SHELL_ORIGIN).toBe('http://localhost:5173')
  })
})
