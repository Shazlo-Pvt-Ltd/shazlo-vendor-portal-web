import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { entry } from '../modules/testing'
import { makeStore, sessionBody } from '../session/testing'
import { attachModule, deliver } from '../test/frameBridge'
import { renderRoute } from '../test/renderRoute'
import { setViewport } from '../test/viewport'
import { MAX_TITLES_PER_WINDOW, MAX_TOASTS_PER_WINDOW, TOAST_WINDOW_MS } from './ModuleHost'
import { MAX_VISIBLE_TOASTS } from './ToastProvider'

const MODULES = [entry({ id: 'vendor-admin', title: 'Vendor admin' })]
const ORIGIN = MODULES[0]!.origin

afterEach(() => {
  vi.useRealTimers()
})

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let round = 0; round < 6; round += 1) await Promise.resolve()
  })
}

/** The host, with a fake clock, a counting logout and a history to go back through. */
async function open(path = '/m/vendor-admin', options: { from?: string } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  setViewport(1280)
  const body = sessionBody({ roles: ['vendor_reviewer'] })
  const logout = vi.fn(async () => {})
  let exchanges = 0
  const exchange = vi.fn(async (audience: string) => {
    exchanges += 1
    return { access_token: `mod-${exchanges}`, token_type: 'Bearer', expires_in: 300, audience }
  })
  const store = makeStore({ refresh: async () => body, fetchMe: async () => body.admin, exchange, logout }).store
  const router = renderRoute(options.from ?? path, { store, modules: MODULES })
  await settle()
  await settle()
  if (options.from !== undefined) {
    await act(async () => {
      await router.navigate(path)
    })
    await settle()
  }
  return { store, router, logout, exchange }
}

async function moduleReady() {
  const module = attachModule({ moduleOrigin: ORIGIN })
  module.client.sendReady()
  await settle()
  return module
}

const frames = () => document.querySelectorAll('iframe').length
const toasts = () => screen.getByRole('region', { name: 'Notifications' })
const shown = () => [...toasts().querySelectorAll('[data-level]')].map((node) => node.textContent ?? '')
const where = (router: Awaited<ReturnType<typeof open>>['router']) => `${router.state.location.pathname}${router.state.location.search}${router.state.location.hash}`

describe('title: where the module says it is', () => {
  it('updates the breadcrumb, the tab title and the shell address', async () => {
    const { router } = await open()
    const module = await moduleReady()
    expect(module.client.sendTitle('/orders/42?tab=2', 'Order 42')).toBe(true)
    await settle()
    expect(where(router)).toBe('/m/vendor-admin/orders/42?tab=2')
    expect(document.title).toBe('Order 42 · Vendor admin · Shazlo-One')
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/')
    expect(within(crumbs).getByRole('link', { name: 'Vendor admin' }).getAttribute('href')).toBe('/m/vendor-admin')
    expect(within(crumbs).getByText('Order 42').getAttribute('aria-current')).toBe('page')
    // The page heading stays the module's name; there is still one h1.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Vendor admin' })).toBeTruthy()
  })

  it('replaces the history entry instead of adding one for each step', async () => {
    const { router } = await open('/m/vendor-admin', { from: '/' })
    const module = await moduleReady()
    module.client.sendTitle('/orders', 'Orders')
    await settle()
    module.client.sendTitle('/orders/42', 'Order 42')
    await settle()
    module.client.sendTitle('/orders/42/notes', 'Notes')
    await settle()
    expect(where(router)).toBe('/m/vendor-admin/orders/42/notes')
    expect(router.state.historyAction).toBe('REPLACE')
    // One step back leaves the module entirely: none of the three was a history entry of its own.
    await act(async () => {
      await router.navigate(-1)
    })
    await settle()
    expect(where(router)).toBe('/')
  })

  it('shows the module’s own name, not a page, when it is back at its root', async () => {
    const { router } = await open()
    const module = await moduleReady()
    module.client.sendTitle('/orders', 'Orders')
    await settle()
    module.client.sendTitle('/', 'Vendor admin')
    await settle()
    expect(where(router)).toBe('/m/vendor-admin')
    expect(document.title).toBe('Vendor admin · Shazlo-One')
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByText('Vendor admin').getAttribute('aria-current')).toBe('page')
  })

  it('does nothing to the address when the module reports the page it is already on', async () => {
    const { router } = await open('/m/vendor-admin/orders')
    const navigate = vi.spyOn(router, 'navigate')
    const module = await moduleReady()
    module.client.sendTitle('/orders', 'Orders')
    await settle()
    expect(navigate).not.toHaveBeenCalled()
    expect(document.title).toBe('Orders · Vendor admin · Shazlo-One')
  })

  it.each([
    ['another site', 'https://evil.example/phish'],
    ['a protocol-relative address', '//evil.example/phish'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a relative path', 'orders'],
    ['a backslash', '/\\evil.example'],
  ])('ignores a title whose path is %s (the protocol drops it)', async (_name, path) => {
    const { router } = await open()
    const module = await moduleReady()
    deliver(module.shellWindow, { protocol: 'shazlo-one', v: 1, type: 'title', id: '00000000-0000-4000-8000-0000000000aa', sentAt: 1, payload: { path, title: 'Hijack' } }, ORIGIN, module.frameWindow)
    await settle()
    expect(where(router)).toBe('/m/vendor-admin')
    expect(document.title).toBe('Vendor admin · Shazlo-One')
    expect(screen.queryByText('Hijack')).toBeNull()
  })

  it.each([
    ['a dot-dot to the admin screens', '/../admins'],
    ['an encoded dot-dot', '/%2e%2e/admins'],
    ['two dot-dots to the home page', '/../..'],
    ['a dot-dot to another module', '/../other-module/x'],
  ])('ignores a title whose path walks out of the module (%s): it passes the protocol but not the shell', async (_name, path) => {
    const { router } = await open()
    const module = await moduleReady()
    expect(module.client.sendTitle(path, 'Hijack')).toBe(true)
    await settle()
    expect(where(router)).toBe('/m/vendor-admin')
    expect(document.title).toBe('Vendor admin · Shazlo-One')
    expect(screen.queryByText('Hijack')).toBeNull()
    expect(frames()).toBe(1)
  })

  it('never lets a title put markup in the page: it is text in the breadcrumb and the tab title', async () => {
    await open()
    const module = await moduleReady()
    // Markup is refused by the protocol; anything else is shown as characters.
    expect(module.client.sendTitle('/a', '<img src=x onerror=alert(1)>')).toBe(false)
    expect(module.client.sendTitle('/a', 'Tom & Jerry "<3"')).toBe(true)
    await settle()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).querySelector('img, script')).toBeNull()
    expect(document.title).toBe('Tom & Jerry "<3" · Vendor admin · Shazlo-One')
  })

  it('takes at most 20 titles in 10 seconds, then again once the window has passed', async () => {
    const { router } = await open()
    const navigate = vi.spyOn(router, 'navigate')
    const module = await moduleReady()
    for (let n = 1; n <= 30; n += 1) {
      // The module’s own limiter allows one token request, but titles have none: the shell must hold the line.
      module.client.sendTitle(`/p${n}`, `Page ${n}`)
    }
    await settle()
    const replaces = navigate.mock.calls.filter((call) => (call[1] as { replace?: boolean } | undefined)?.replace === true)
    expect(replaces.length).toBeLessThanOrEqual(MAX_TITLES_PER_WINDOW)
    expect(where(router)).toBe(`/m/vendor-admin/p${MAX_TITLES_PER_WINDOW}`)
    await settle(TOAST_WINDOW_MS)
    module.client.sendTitle('/after', 'After')
    await settle()
    expect(where(router)).toBe('/m/vendor-admin/after')
  })

  it('goes back to the module’s name when the module is reloaded with Retry', async () => {
    await open()
    const module = await moduleReady()
    module.client.sendError('boom', 'It broke.', true)
    module.client.sendTitle('/x', 'X')
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await settle()
    expect(document.title).toBe('Vendor admin · Shazlo-One')
  })
})

describe('deep links', () => {
  it('opening /m/<module>/<path> sends navigate with that path once the module is ready', async () => {
    await open('/m/vendor-admin/orders/42?tab=2#notes')
    expect(document.querySelector('iframe')).not.toBeNull()
    const module = await moduleReady()
    expect(module.navigations).toEqual(['/orders/42?tab=2#notes'])
    // Not before the module had its token: the auth came first.
    const order = module.posts.filter((post) => post.from === 'shell').map((post) => (post.data as { type: string }).type)
    expect(order).toEqual(['auth', 'navigate'])
  })

  it('sends nothing for the module’s root', async () => {
    await open('/m/vendor-admin')
    const module = await moduleReady()
    expect(module.navigations).toEqual([])
  })

  it('sends nothing before the module is ready, and nothing at all if it never gets a token', async () => {
    await open('/m/vendor-admin/orders')
    const module = attachModule({ moduleOrigin: ORIGIN })
    await settle(5_000)
    expect(module.navigations).toEqual([])
    expect(module.posts).toEqual([])
  })

  it('sends the current path again when the module reloads and says ready again', async () => {
    const { router } = await open('/m/vendor-admin')
    const module = await moduleReady()
    module.client.sendTitle('/orders/42', 'Order 42')
    await settle()
    expect(where(router)).toBe('/m/vendor-admin/orders/42')
    module.client.sendReady()
    await settle()
    expect(module.navigations).toEqual(['/orders/42'])
  })

  it('does not send the module back a path it reported itself', async () => {
    await open()
    const module = await moduleReady()
    module.client.sendTitle('/orders', 'Orders')
    await settle()
    module.client.sendTitle('/orders/42?tab=2', 'Order 42')
    await settle()
    expect(module.navigations).toEqual([])
  })

  it('moves the module with the browser’s back and forward', async () => {
    const { router } = await open('/m/vendor-admin')
    const module = await moduleReady()
    await act(async () => {
      await router.navigate('/m/vendor-admin/a')
    })
    await settle()
    await act(async () => {
      await router.navigate('/m/vendor-admin/b')
    })
    await settle()
    expect(module.navigations).toEqual(['/a', '/b'])
    await act(async () => {
      await router.navigate(-1)
    })
    await settle()
    expect(module.navigations).toEqual(['/a', '/b', '/a'])
    await act(async () => {
      await router.navigate(1)
    })
    await settle()
    expect(module.navigations).toEqual(['/a', '/b', '/a', '/b'])
    await act(async () => {
      await router.navigate(-2)
    })
    await settle()
    expect(module.navigations.at(-1)).toBe('/')
  })

  it('reopens the same module page from a copied shell address', async () => {
    const { router } = await open('/m/vendor-admin')
    const module = await moduleReady()
    module.client.sendTitle('/orders/42?tab=2', 'Order 42')
    await settle()
    const copied = where(router)
    expect(copied).toBe('/m/vendor-admin/orders/42?tab=2')
    // A new tab opens it.
    document.querySelectorAll('iframe').forEach((frame) => frame.remove())
    const second = await open(copied)
    const reopened = await moduleReady()
    expect(reopened.navigations).toEqual(['/orders/42?tab=2'])
    expect(where(second.router)).toBe(copied)
  })
})

describe('toast', () => {
  it.each(['info', 'success', 'warning', 'error'] as const)('shows a %s toast in the shell’s own region, labelled with the module', async (level) => {
    await open()
    const module = await moduleReady()
    module.client.sendToast({ level, message: `A ${level} message.` })
    await settle()
    const toast = toasts().querySelector(`[data-level="${level}"]`)!
    expect(toast.textContent).toContain(`A ${level} message.`)
    expect(toast.textContent).toContain('Vendor admin')
  })

  it('announces politely: the region is a polite live region and no toast is an alert', async () => {
    await open()
    const module = await moduleReady()
    module.client.sendToast({ level: 'error', message: 'It failed.' })
    await settle()
    expect(toasts().getAttribute('aria-live')).toBe('polite')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('takes plain text of up to 280 characters', async () => {
    await open()
    const module = await moduleReady()
    expect(module.client.sendToast({ level: 'info', message: 'm'.repeat(280) })).toBe(true)
    expect(module.client.sendToast({ level: 'info', message: 'm'.repeat(281) })).toBe(false)
    await settle()
    expect(shown()).toHaveLength(1)
  })

  it('shows a "<" that is not a tag as the character it is', async () => {
    await open()
    const module = await moduleReady()
    module.client.sendToast({ level: 'info', message: 'Saved 3 < 5 items & more' })
    await settle()
    expect(toasts().textContent).toContain('Saved 3 < 5 items & more')
  })

  it.each([
    ['an image with a handler', '<img src=x onerror=alert(1)>'],
    ['a script', '<script>alert(1)</script>'],
    ['a link', 'Click <a href="https://evil.example">here</a>'],
    ['bold text', '<b>urgent</b>'],
  ])('refuses %s: nothing is shown and nothing is injected', async (_name, message) => {
    await open()
    const module = await moduleReady()
    expect(module.client.sendToast({ level: 'warning', message })).toBe(false)
    // And if a hostile module skips its own checks and sends it raw, the shell drops it too.
    deliver(module.shellWindow, { protocol: 'shazlo-one', v: 1, type: 'toast', id: '00000000-0000-4000-8000-0000000000bb', sentAt: 1, payload: { level: 'warning', message } }, ORIGIN, module.frameWindow)
    await settle()
    expect(shown()).toEqual([])
    expect(document.querySelector('img[src="x"], script')).toBeNull()
    expect(document.body.innerHTML).not.toContain('evil.example')
  })

  it('cannot pass as the shell: every toast says which module it is from', async () => {
    await open()
    const module = await moduleReady()
    module.client.sendToast({ level: 'error', message: 'Your session has expired. Enter your password below.' })
    await settle()
    expect(shown()[0]).toMatch(/^Vendor admin/)
  })

  it(`takes at most ${MAX_TOASTS_PER_WINDOW} in ${TOAST_WINDOW_MS / 1000} seconds, so a flood does not fill the screen`, async () => {
    await open()
    const module = await moduleReady()
    for (let n = 1; n <= 40; n += 1) module.client.sendToast({ level: 'info', message: `flood ${n}` })
    await settle()
    // Five were accepted; three can show at once, the newest of them.
    const messages = shown()
    expect(messages).toHaveLength(MAX_VISIBLE_TOASTS)
    expect(messages.join(' ')).toContain(`flood ${MAX_TOASTS_PER_WINDOW}`)
    expect(messages.join(' ')).not.toContain(`flood ${MAX_TOASTS_PER_WINDOW + 1}`)
    // The window passes (the first ones have gone too): a toast gets through again.
    await settle(TOAST_WINDOW_MS)
    module.client.sendToast({ level: 'info', message: 'after the flood' })
    await settle()
    expect(shown().join(' ')).toContain('after the flood')
  })

  it('does not take a toast from another origin or window', async () => {
    await open()
    const module = await moduleReady()
    const attacker = document.createElement('iframe')
    document.body.append(attacker)
    const message = { protocol: 'shazlo-one', v: 1, type: 'toast', id: '00000000-0000-4000-8000-0000000000cc', sentAt: 1, payload: { level: 'error', message: 'Phish' } }
    deliver(module.shellWindow, message, 'https://evil.example', module.frameWindow)
    deliver(module.shellWindow, message, ORIGIN, attacker.contentWindow)
    await settle()
    expect(shown()).toEqual([])
    attacker.remove()
  })
})

describe('logout', () => {
  it('ends the session, revokes the refresh token, removes the frame and goes to sign in', async () => {
    const { store, router, logout } = await open()
    const module = await moduleReady()
    module.client.sendLogout('user_choice')
    await settle()
    expect(logout).toHaveBeenCalledOnce()
    expect(frames()).toBe(0)
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
    expect(store.getAccessToken()).toBeNull()
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', signedOutByUser: true, expired: false })
    expect(router.state.location.search).toBe('')
  })

  it('is ignored from another origin or window', async () => {
    const { logout } = await open()
    const module = await moduleReady()
    const attacker = document.createElement('iframe')
    document.body.append(attacker)
    const message = { protocol: 'shazlo-one', v: 1, type: 'logout', id: '00000000-0000-4000-8000-0000000000dd', sentAt: 1, payload: {} }
    deliver(module.shellWindow, message, 'https://evil.example', module.frameWindow)
    deliver(module.shellWindow, message, ORIGIN, attacker.contentWindow)
    await settle()
    expect(logout).not.toHaveBeenCalled()
    expect(frames()).toBe(2)
    attacker.remove()
  })

  it('is ignored before the module has said ready', async () => {
    const { logout } = await open()
    const module = attachModule({ moduleOrigin: ORIGIN })
    expect(module.client.sendLogout()).toBe(true)
    await settle()
    expect(logout).not.toHaveBeenCalled()
    expect(frames()).toBe(1)
  })
})

describe('error', () => {
  it('a non-fatal one is logged in development and shows a notice, and the module stays', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await open()
    const module = await moduleReady()
    module.client.sendError('save_failed', 'The order could not be saved.', false)
    await settle()
    const lines = log.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[shell]'))
    expect(lines).toEqual(['[shell] vendor-admin reported a non-fatal error (save_failed): The order could not be saved.'])
    expect(shown()[0]).toContain('Something went wrong: The order could not be saved.')
    expect(shown()[0]).toContain('Vendor admin')
    expect(frames()).toBe(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a non-fatal one counts against the toast limit like any other notice', async () => {
    await open()
    const module = await moduleReady()
    for (let n = 1; n <= 20; n += 1) module.client.sendError('e', `problem ${n}`, false)
    await settle()
    expect(shown().join(' ')).toContain(`problem ${MAX_TOASTS_PER_WINDOW}`)
    expect(shown().join(' ')).not.toContain(`problem ${MAX_TOASTS_PER_WINDOW + 1}`)
  })

  it('a fatal one replaces the module with the shell’s error panel, whose Retry reloads it', async () => {
    const { exchange } = await open()
    const module = await moduleReady()
    module.client.sendError('render_failed', 'The list did not load.', true)
    await settle()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/Vendor admin stopped working/)
    expect(alert.textContent).toMatch(/render_failed/)
    expect(alert.textContent).toMatch(/The list did not load\./)
    expect(frames()).toBe(0)
    const first = document.querySelector('iframe')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(frames()).toBe(1)
    expect(document.querySelector('iframe')).not.toBe(first)
    const reloaded = await moduleReady()
    expect(reloaded.auths).toHaveLength(1)
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('a fatal one shows what the module said as text, never as markup', async () => {
    await open()
    const module = await moduleReady()
    module.client.sendError('<b>x</b>', '<img src=x onerror=alert(1)>', true)
    await settle()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(alert.querySelector('img, b, script')).toBeNull()
  })

  it('a fatal one stops everything for that module: no refresh, no timers, no tokens', async () => {
    const { exchange } = await open()
    const module = await moduleReady()
    module.client.sendError('render_failed', 'Gone.', true)
    await settle()
    const calls = exchange.mock.calls.length
    await settle(20 * 60_000)
    expect(exchange.mock.calls.length).toBe(calls)
    expect(module.auths).toHaveLength(1)
  })

  it('keeps the shell’s chrome usable on the panel', async () => {
    await open()
    const module = await moduleReady()
    module.client.sendError('render_failed', 'Gone.', true)
    await settle()
    expect(screen.getByRole('navigation', { name: 'Modules' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Asha Admin' })).toBeTruthy()
  })
})
