import { createMessage } from '@shazlo/shell-protocol'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderShell } from '../test/render'

const MODULE_ORIGIN = 'http://localhost:5193'

function frame() {
  return screen.getByTitle('Vendors') as HTMLIFrameElement
}

// Sends a message as if it came from the module iframe.
function fromModule(data: unknown, { origin = MODULE_ORIGIN, source }: { origin?: string; source?: MessageEventSource | null } = {}) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: source === undefined ? frame().contentWindow : source }))
  })
}

function ready() {
  const msg = createMessage('ready', { module: 'vendor-admin', supportedVersions: [1], moduleVersion: '0.1.0' })
  fromModule(msg)
  return msg
}

afterEach(() => vi.useRealTimers())

describe('A-01 sign in', () => {
  it('signs in and opens Home', async () => {
    const { user, router } = await renderShell({ route: '/sign-in', as: null })
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to Shazlo One' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'One place to run Shazlo.' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Work email'), 'naman@shazlo.store')
    await user.type(screen.getByLabelText('Password'), 'shazlo-one-2026')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('gives one message for a wrong email or password, then rate-limits', async () => {
    const { user } = await renderShell({ route: '/sign-in', as: null })
    await user.type(await screen.findByLabelText('Work email'), 'naman@shazlo.store')
    for (let i = 0; i < 5; i++) {
      await user.clear(screen.getByLabelText('Password'))
      await user.type(screen.getByLabelText('Password'), 'wrong-password')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      await screen.findByRole('alert')
    }
    expect(screen.getByRole('alert')).toHaveTextContent('That email and password do not match.')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts.'))
  })

  it('sends an admin with a temporary password to change it first', async () => {
    const { router } = await renderShell({ route: '/', as: 'sneha' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/change-password'))
  })

  it('remembers where a signed-out admin was going', async () => {
    const { router } = await renderShell({ route: '/vendors/publishing', as: null })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/vendors/publishing')
  })
})

describe('navy sidebar', () => {
  it('lists Home, the modules the role allows with their links, and Admins & roles for super admins', async () => {
    await renderShell({ route: '/' })
    const nav = await screen.findByRole('navigation', { name: 'Shazlo One sections' })
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(within(nav).getByRole('link', { name: /^Vendors\s*, 14 waiting$/ })).toBeInTheDocument())
    for (const name of ['Review queue', 'All vendors', 'Publishing', 'Admins & roles']) expect(within(nav).getByRole('link', { name })).toBeInTheDocument()
  })

  it('hides administration from reviewers and blocks the page', async () => {
    const { router } = await renderShell({ route: '/admins', as: 'priya' })
    const nav = await screen.findByRole('navigation', { name: 'Shazlo One sections' })
    expect(within(nav).queryByRole('link', { name: 'Admins & roles' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Only super admins can manage admins' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admins')
  })

  it('signs out', async () => {
    const { user, router, identityDb } = await renderShell({ route: '/' })
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(identityDb.cookie).toBeNull()
  })
})

describe('module host (ADR 0001)', () => {
  it('frames the module with the documented sandbox and loads the deep link', async () => {
    await renderShell({ route: '/vendors/vendors?status=applied' })
    const iframe = await screen.findByTitle('Vendors')
    expect(iframe.getAttribute('src')).toBe('http://localhost:5193/vendors?status=applied')
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-downloads')
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(screen.getByRole('status', { name: 'Loading Vendors' })).toBeInTheDocument()
  })

  it('answers ready with auth: a vendor-api token and the admin, sent only to the module origin', async () => {
    await renderShell({ route: '/vendors/queue' })
    await screen.findByTitle('Vendors')
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    const msg = ready()
    await waitFor(() => expect(post).toHaveBeenCalled())
    const [auth, origin] = post.mock.calls[0]!
    expect(origin).toBe(MODULE_ORIGIN)
    expect(auth).toMatchObject({ protocol: 'shazlo-one', type: 'auth', replyTo: msg.id, payload: { user: { email: 'naman@shazlo.store', roles: ['super_admin'] } } })
    expect((auth as { payload: { accessToken: string } }).payload.accessToken).toMatch(/^mock\.vendor-api\.a_naman\./)
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading Vendors' })).toBeNull())
  })

  it('ignores messages from another origin or another window', async () => {
    await renderShell({ route: '/vendors/queue' })
    await screen.findByTitle('Vendors')
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    const msg = createMessage('ready', { module: 'vendor-admin', supportedVersions: [1], moduleVersion: '0.1.0' })
    fromModule(msg, { origin: 'https://evil.example' })
    fromModule(msg, { source: window })
    await new Promise((r) => setTimeout(r, 50))
    expect(post).not.toHaveBeenCalled()
    expect(screen.getByRole('status', { name: 'Loading Vendors' })).toBeInTheDocument()
  })

  it('syncs the module title into the breadcrumb, tab title and URL', async () => {
    const { router } = await renderShell({ route: '/vendors/queue' })
    await screen.findByTitle('Vendors')
    ready()
    fromModule(createMessage('title', { path: '/review/product/p_ajrakh', title: 'Ajrakh Block-Print Kurta' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/vendors/review/product/p_ajrakh'))
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Ajrakh Block-Print Kurta')
    expect(document.title).toBe('Ajrakh Block-Print Kurta · Vendors · Shazlo One')
  })

  it('moves the module with navigate when a sidebar link is picked', async () => {
    const { user } = await renderShell({ route: '/vendors/queue' })
    await screen.findByTitle('Vendors')
    ready()
    fromModule(createMessage('title', { path: '/queue', title: 'Review queue' }))
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    await user.click(screen.getByRole('link', { name: 'Publishing' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'navigate', payload: { path: '/publishing' } }), MODULE_ORIGIN))
    expect(frame().getAttribute('src')).toBe('http://localhost:5193/queue')
  })

  it('shows module toasts in the shell', async () => {
    await renderShell({ route: '/vendors/queue' })
    await screen.findByTitle('Vendors')
    ready()
    fromModule(createMessage('toast', { level: 'success', message: 'Approved. Publishing to the app.' }))
    expect(await screen.findByText('Approved. Publishing to the app.')).toBeInTheDocument()
  })

  it('answers token:request with a fresh token, at most once every 30 seconds', async () => {
    await renderShell({ route: '/vendors/queue' })
    await screen.findByTitle('Vendors')
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    ready()
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    fromModule(createMessage('token:request', { reason: 'unauthorized' }))
    fromModule(createMessage('token:request', { reason: 'unauthorized' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 50))
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1]![0]).toMatchObject({ type: 'auth' })
  })

  it('signs out when the module asks to', async () => {
    const { router } = await renderShell({ route: '/vendors/queue' })
    await screen.findByTitle('Vendors')
    ready()
    fromModule(createMessage('logout', {}))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
  })

  it('refuses a module version it does not support', async () => {
    await renderShell({ route: '/vendors/queue' })
    await screen.findByTitle('Vendors')
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    fromModule(createMessage('ready', { module: 'vendor-admin', supportedVersions: [9], moduleVersion: '9.0.0' }))
    expect(await screen.findByRole('heading', { name: 'Vendors 9.0.0 needs a newer Shazlo One' })).toBeInTheDocument()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', payload: expect.objectContaining({ code: 'version_unsupported' }) }), MODULE_ORIGIN)
  })

  it('shows Try again after 10 silent seconds, and gives up after three attempts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = await renderShell({ route: '/vendors/queue' })
    await screen.findByTitle('Vendors')
    for (const attempt of [1, 2]) {
      act(() => vi.advanceTimersByTime(10_000))
      expect(await screen.findByRole('heading', { name: 'Vendors did not load' })).toBeInTheDocument()
      expect(screen.getByText(`Attempt ${attempt} of 3`)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
    }
    act(() => vi.advanceTimersByTime(10_000))
    expect(await screen.findByRole('heading', { name: 'Vendors is unavailable right now' })).toBeInTheDocument()
    expect(screen.queryByTitle('Vendors')).toBeNull()
  })
})
