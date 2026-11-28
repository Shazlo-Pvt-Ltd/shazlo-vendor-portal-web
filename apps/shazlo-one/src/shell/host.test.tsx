import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveModule } from '../app/registry'
import { catalogue } from '../test/modules'
import { moduleMessage, postFromFrame } from '../test/frames'
import { renderShell } from '../test/render'
import { server } from '../test/server'
import { frameSrc, IFRAME_SANDBOX } from './ModuleHost'
import { MODULE_TEXT, moduleText } from './moduleText'

// The module host's hardening (ADR 0001 §3 to §7), against the Catalogue stand-in module.
const ORIGIN = 'https://catalogue.test'
const frame = () => screen.getByTitle('Catalogue') as HTMLIFrameElement
const frames = () => document.querySelectorAll('iframe').length
const fromModule = (data: unknown, from: { origin?: string; source?: unknown } = {}) => postFromFrame(frame(), data, { origin: from.origin ?? ORIGIN, source: from.source })
const ready = () => fromModule(moduleMessage('ready', { module: 'catalogue', supportedVersions: [1], moduleVersion: '0.1.0' }))
const authsTo = (post: { mock: { calls: unknown[][] } }) => post.mock.calls.map(([data]) => data as { type: string; payload: { accessToken: string } }).filter((m) => m.type === 'auth')

/** The tokens the host asks the session for, for the Catalogue frame (Home's summaries ask for their own). */
function frameTokens(context: { session: { getModuleToken: (...args: never[]) => unknown } }) {
  const spy = vi.spyOn(context.session as { getModuleToken: (audience: string, scope?: string, options?: { fresh?: boolean }) => Promise<unknown> }, 'getModuleToken')
  return { get n() { return spy.mock.calls.filter(([, scope]) => scope === 'catalogue').length } }
}

/** Counts identity-api calls to one path. */
function count(path: string) {
  const seen = { n: 0 }
  server.events.on('request:start', ({ request }) => {
    if (new URL(request.url).pathname === path) seen.n += 1
  })
  return seen
}

afterEach(() => {
  vi.useRealTimers()
  server.events.removeAllListeners()
})

describe('the frame', () => {
  it('has the minimal sandbox, no referrer and no powerful features', async () => {
    await renderShell({ route: '/catalogue/queue' })
    const iframe = await screen.findByTitle('Catalogue')
    expect(iframe.getAttribute('sandbox')).toBe(IFRAME_SANDBOX)
    const tokens = IFRAME_SANDBOX.split(' ')
    expect(tokens).toEqual(['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-downloads'])
    for (const forbidden of ['allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-modals']) expect(tokens).not.toContain(forbidden)
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(iframe.getAttribute('allow')).toBe('')
  })

  it('has its listener up before it is given an address', async () => {
    const events: string[] = []
    const page = document.defaultView!
    const add = page.addEventListener.bind(page)
    vi.spyOn(page, 'addEventListener').mockImplementation(((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
      if (type === 'message') events.push('listen')
      add(type, listener, options)
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
      await renderShell({ route: '/catalogue/queue' })
      await screen.findByTitle('Catalogue')
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', original)
    }
    expect(events.slice(0, 2)).toEqual(['listen', 'src'])
  })

  it('is never made for a module on the shell’s own origin, and no token is asked for', async () => {
    const { context } = await renderShell({ route: '/' })
    const tokens = frameTokens(context)
    const { render } = await import('@testing-library/react')
    const { ModuleHost } = await import('./ModuleHost')
    const { App } = await import('../app/App')
    const { createMemoryRouter } = await import('react-router')
    const { CrumbProvider } = await import('../app/crumbs')
    const own = resolveModule({ ...catalogue.entry, url: `${window.location.origin}/inside/`, origin: window.location.origin })
    const router = createMemoryRouter([{ path: '*', element: <CrumbProvider><ModuleHost module={own} /></CrumbProvider> }])
    const view = render(<App context={context} router={router} />)
    expect(await within(view.container).findByRole('heading', { name: 'Catalogue cannot be opened' })).toBeInTheDocument()
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(tokens.n).toBe(0)
  })
})

describe('deep links stay inside the module', () => {
  const module = resolveModule(catalogue.entry, catalogue.manifest)

  it.each([
    ['/queue', 'https://catalogue.test/queue'],
    ['/sellers?status=applied', 'https://catalogue.test/sellers?status=applied'],
    ['/', 'https://catalogue.test/'],
  ])('loads %s on the module’s origin', (target, src) => {
    expect(frameSrc(module, target)).toBe(src)
  })

  it.each(['//evil.example/x', '/\\evil.example', '/../admins', '/%2e%2e/admins', '/a b', 'https://evil.example/', ''])('loads the module’s home page for %j', (target) => {
    expect(frameSrc(module, target)).toBe('https://catalogue.test/dashboard')
  })

  it('frames a typed address that tries to leave the module on the module’s own origin', async () => {
    await renderShell({ route: '/catalogue///evil.example/x' })
    const src = new URL((await screen.findByTitle('Catalogue')).getAttribute('src')!)
    expect(src.origin).toBe(ORIGIN)
  })
})

describe('trust', () => {
  it.each<[string, { origin?: string; source?: unknown }]>([
    ['another origin', { origin: 'https://evil.example' }],
    ['a look-alike origin', { origin: 'https://catalogue.test.evil.example' }],
    ['http instead of https', { origin: 'http://catalogue.test' }],
    ['the right origin from another window', { source: 'window' }],
    ['the right origin from no window', { source: null }],
  ])('ignores a ready from %s: no token is sent', async (_name, from) => {
    const { context } = await renderShell({ route: '/catalogue/queue' })
    const tokens = frameTokens(context)
    await screen.findByTitle('Catalogue')
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    const source = 'source' in from ? (from.source === 'window' ? window : from.source) : undefined
    fromModule(moduleMessage('ready', { module: 'catalogue', supportedVersions: [1], moduleVersion: '0.1.0' }), { origin: from.origin, source })
    await new Promise((r) => setTimeout(r, 30))
    expect(post).not.toHaveBeenCalled()
    expect(tokens.n).toBe(0)
  })
})

describe('module tokens', () => {
  it('are kept for this module, and dropped when its page is left', async () => {
    const { router, context } = await renderShell({ route: '/catalogue/queue' })
    const exchanges = count('/v1/auth/token')
    await screen.findByTitle('Catalogue')
    const drop = vi.spyOn(context.session, 'dropModuleTokens')
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    ready()
    await waitFor(() => expect(authsTo(post)).toHaveLength(1))
    await act(() => router.navigate('/admins'))
    await screen.findByRole('heading', { level: 1, name: 'Admins & roles' })
    expect(drop).toHaveBeenCalledWith('catalogue')
    const before = exchanges.n
    await act(() => router.navigate('/catalogue/queue'))
    await screen.findByTitle('Catalogue')
    const again = vi.spyOn(frame().contentWindow!, 'postMessage')
    ready()
    // The token was dropped with the page: coming back exchanges again.
    await waitFor(() => expect(authsTo(again)).toHaveLength(1))
    expect(exchanges.n).toBeGreaterThan(before)
  })

  it('are dropped on Try again, and the new frame gets a new one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user, context } = await renderShell({ route: '/catalogue/queue' })
    const tokens = frameTokens(context)
    await screen.findByTitle('Catalogue')
    const drop = vi.spyOn(context.session, 'dropModuleTokens')
    act(() => vi.advanceTimersByTime(10_000))
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(drop).toHaveBeenCalledWith('catalogue')
    ready()
    await waitFor(() => expect(tokens.n).toBe(1))
  })

  it('show the 403 page, with no frame, when identity-api says the roles do not allow the module', async () => {
    server.use(http.post('*/v1/auth/token', () => HttpResponse.json({ error: { code: 'audience_not_allowed', message: 'No', request_id: 'r' } }, { status: 403 })))
    await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    ready()
    expect(await screen.findByRole('heading', { name: 'You do not have access to Catalogue' })).toBeInTheDocument()
    expect(frames()).toBe(0)
  })

  it('say why when identity-api does not know the module', async () => {
    server.use(http.post('*/v1/auth/token', () => HttpResponse.json({ error: { code: 'unknown_audience', message: 'No', request_id: 'r' } }, { status: 400 })))
    await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    ready()
    expect(await screen.findByRole('heading', { name: 'Catalogue could not be opened' })).toBeInTheDocument()
    expect(screen.getByText(/not set up on the server yet/)).toBeInTheDocument()
    expect(frames()).toBe(0)
  })

  it('answer a flood of token:request with one new token', async () => {
    const { context } = await renderShell({ route: '/catalogue/queue' })
    const tokens = frameTokens(context)
    await screen.findByTitle('Catalogue')
    ready()
    await waitFor(() => expect(tokens.n).toBe(1))
    for (let i = 0; i < 100; i++) fromModule(moduleMessage('token:request', { reason: 'unauthorized' }))
    await waitFor(() => expect(tokens.n).toBe(2))
    await new Promise((r) => setTimeout(r, 50))
    expect(tokens.n).toBe(2)
  })

  it('answer no token:request before the module holds a token', async () => {
    const { context } = await renderShell({ route: '/catalogue/queue' })
    const tokens = frameTokens(context)
    await screen.findByTitle('Catalogue')
    fromModule(moduleMessage('token:request', { reason: 'unauthorized' }))
    await new Promise((r) => setTimeout(r, 30))
    expect(tokens.n).toBe(0)
  })

  it('a replayed ready gets the token it holds: no exchange, and the backoff after a failed refresh carries on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { context } = await renderShell({ route: '/catalogue/queue' })
    const tokens = frameTokens(context)
    await screen.findByTitle('Catalogue')
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    ready()
    await waitFor(() => expect(authsTo(post)).toHaveLength(1))
    // identity-api starts failing; a refresh fails and is to be tried again in 5 seconds.
    server.use(http.post('*/v1/auth/token', () => HttpResponse.json({ error: { code: 'internal_error', message: 'Down', request_id: 'r' } }, { status: 500 })))
    fromModule(moduleMessage('token:request', { reason: 'unauthorized' }))
    await waitFor(() => expect(tokens.n).toBe(2))
    // Ready again, many times: each gets the held token, and none asks identity-api.
    for (let i = 0; i < 5; i++) ready()
    await waitFor(() => expect(authsTo(post)).toHaveLength(6))
    expect(new Set(authsTo(post).map((m) => m.payload.accessToken)).size).toBe(1)
    expect(tokens.n).toBe(2)
    // The backoff runs on its own clock: the next try is at 5 seconds, not sooner.
    await act(() => vi.advanceTimersByTimeAsync(4_000))
    expect(tokens.n).toBe(2)
    await act(() => vi.advanceTimersByTimeAsync(1_500))
    await waitFor(() => expect(tokens.n).toBe(3))
  })
})

describe('what a module says is shown as plain text, cut to size', () => {
  it('caps a long title in the crumb and the tab title, on one line', async () => {
    await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    ready()
    fromModule(moduleMessage('title', { path: '/queue', title: 'W'.repeat(200) }))
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    await waitFor(() => expect(crumbs).toHaveTextContent('W'.repeat(119) + '…'))
    expect(crumbs).not.toHaveTextContent('W'.repeat(121))
    expect(document.title.startsWith(`${'W'.repeat(119)}… · Catalogue`)).toBe(true)
  })

  it('shows a toast of many lines as three, and refuses one that looks like markup', async () => {
    await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    ready()
    fromModule(moduleMessage('toast', { level: 'info', message: '<img src=x onerror=alert(1)>' }))
    fromModule(moduleMessage('toast', { level: 'info', message: 'one\ntwo\nthree\nfour\nfive' }))
    const toast = await screen.findByText((_, el) => el?.classList.contains('MuiSnackbarContent-message') === true)
    expect(toast.textContent).toBe('one\ntwo\nthree…')
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(getComputedStyle(toast).overflowWrap).toBe('anywhere')
  })

  it('shows a fatal error’s message as capped text, with Try again', async () => {
    await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    ready()
    fromModule(moduleMessage('error', { code: 'boom', message: `${'x'.repeat(400)}`, fatal: true }))
    const heading = await screen.findByRole('heading', { name: 'Catalogue did not load' })
    const alert = heading.closest<HTMLElement>('[role="alert"]')!
    expect(alert).toHaveTextContent(`${'x'.repeat(299)}…`)
    expect(alert).not.toHaveTextContent('x'.repeat(301))
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // The token exchange that `ready` started finishes after the error: the module stays stopped.
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.getByRole('heading', { name: 'Catalogue did not load' })).toBeInTheDocument()
  })

  it('moduleText keeps the first lines and characters, and marks the cut', () => {
    expect(moduleText('Saved.', MODULE_TEXT.toast)).toBe('Saved.')
    expect(moduleText('  a\n\n  b  \nc\nd', { maxLength: 100, maxLines: 2 })).toBe('a\nb…')
    expect(moduleText('abcdef', { maxLength: 4, maxLines: 1 })).toBe('abc…')
    expect(moduleText('tab\there', MODULE_TEXT.title)).toBe('tab here')
  })
})

describe('a module’s logout', () => {
  it('removes the frame at once and signs out once, however often it is sent', async () => {
    const logouts = count('/v1/auth/logout')
    const { router } = await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    ready()
    const logout = moduleMessage('logout', {})
    const iframe = frame()
    postFromFrame(iframe, logout, { origin: ORIGIN })
    expect(frames()).toBe(0)
    postFromFrame(iframe, moduleMessage('logout', {}), { origin: ORIGIN })
    postFromFrame(iframe, logout, { origin: ORIGIN })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(logouts.n).toBe(1)
  })
})

describe('focus', () => {
  it('moves to the page heading when the admin moves to another page, not on the first one', async () => {
    const { router } = await renderShell({ route: '/' })
    const home = await screen.findByRole('heading', { level: 1 })
    expect(home).not.toHaveFocus()
    await act(() => router.navigate('/admins'))
    const admins = await screen.findByRole('heading', { level: 1, name: 'Admins & roles' })
    await waitFor(() => expect(admins).toHaveFocus())
  })

  it('stays put while the module moves between its own pages', async () => {
    const { router } = await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    ready()
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    fromModule(moduleMessage('title', { path: '/review/product/p1', title: 'Product' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalogue/review/product/p1'))
    expect(outside).toHaveFocus()
    outside.remove()
  })
})
