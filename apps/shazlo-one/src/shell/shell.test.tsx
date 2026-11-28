import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { ADMIN_ID } from '../mocks/identity'
import { catalogue } from '../test/modules'
import { moduleMessage, postFromFrame } from '../test/frames'
import { renderShell } from '../test/render'
import { server } from '../test/server'

const MODULE_ORIGIN = 'https://catalogue.test'

function frame() {
  return screen.getByTitle('Catalogue') as HTMLIFrameElement
}

const sidebar = () => screen.getByRole('navigation', { name: 'Shazlo One sections' })
const topNav = () => screen.queryByRole('navigation', { name: 'Catalogue pages' })
// The module's pages come from its manifest, which arrives after the module is framed.
const manifestIn = () => waitFor(() => expect(topNav()).not.toBeNull())
const PAGES = ['Review queue', 'All sellers', 'Publishing']

// The --shell-top the layout sets on its root, which the module iframe's height is computed from.
function shellTop() {
  let el: HTMLElement | null = screen.getByRole('main')
  while (el && !getComputedStyle(el).getPropertyValue('--shell-top')) el = el.parentElement
  return el ? getComputedStyle(el).getPropertyValue('--shell-top').trim() : null
}

// Sends a message as if it came from the module iframe.
function fromModule(data: unknown, { origin = MODULE_ORIGIN, source }: { origin?: string; source?: unknown } = {}) {
  postFromFrame(frame(), data, { origin, source })
}

function ready() {
  const msg = moduleMessage('ready', { module: 'catalogue', supportedVersions: [1], moduleVersion: '0.1.0' })
  fromModule(msg)
  return msg
}

afterEach(() => vi.useRealTimers())

describe('A-01 sign in', () => {
  it('signs in and opens Home', async () => {
    const { user, router } = await renderShell({ route: '/sign-in', as: null })
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to Shazlo One' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'One place to run Shazlo' })).toBeInTheDocument()
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
    const { router } = await renderShell({ route: '/catalogue/publishing', as: null })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/catalogue/publishing')
  })
})

describe('navy sidebar', () => {
  it('lists Home, the modules the role allows with their links, and Admins & roles for super admins', async () => {
    await renderShell({ route: '/' })
    const nav = await screen.findByRole('navigation', { name: 'Shazlo One sections' })
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(within(nav).getByRole('link', { name: /^Catalogue\s*, 14 waiting$/ })).toBeInTheDocument())
    // Module pages come from each module's manifest, which arrives after the sidebar is drawn.
    for (const name of ['Review queue', 'All sellers', 'Publishing', 'Drafts', 'Admins & roles']) expect(await within(nav).findByRole('link', { name })).toBeInTheDocument()
    // Each module's badge comes from its own summary, with its own words.
    expect(within(nav).getByRole('link', { name: /^Campaigns\s*, 3 to approve$/ })).toBeInTheDocument()
  })

  it('gives every link an icon and nests each module page under its module, on a guide line', async () => {
    await renderShell({ route: '/catalogue/publishing' })
    const nav = await screen.findByRole('navigation', { name: 'Shazlo One sections' })
    // The pages come from the module's manifest, which arrives after the sidebar is drawn.
    await within(nav).findByRole('link', { name: 'Review queue' })
    for (const name of ['Home', /^Catalogue/, 'Review queue', 'All sellers', 'Publishing', 'Admins & roles']) {
      const icon = within(nav).getByRole('link', { name }).querySelector('svg')
      expect(icon, String(name)).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('stroke-width', '1.75')
    }
    const parent = within(nav).getByRole('link', { name: /^Catalogue/ })
    const pages = within(nav).getByRole('link', { name: 'Review queue' }).closest('ul')!
    expect(pages).not.toContainElement(parent)
    expect(pages.closest('li')).toContainElement(parent)
    expect(within(pages).getAllByRole('link').map((a) => a.textContent)).toEqual(['Review queue', 'All sellers', 'Publishing'])
    expect(getComputedStyle(pages).borderLeftWidth).toBe('1px')
    // The page you are on is the one marked current; the module itself is the parent, not the page.
    expect(within(nav).getByRole('link', { name: 'Publishing' })).toHaveAttribute('aria-current', 'page')
    for (const name of ['Home', /^Catalogue/, 'Review queue', 'All sellers', 'Admins & roles']) expect(within(nav).getByRole('link', { name })).not.toHaveAttribute('aria-current')
  })

  it('draws the logo in amber on the navy sidebar, with no colour filter', async () => {
    await renderShell({ route: '/' })
    await screen.findByRole('navigation', { name: 'Shazlo One sections' })
    const logo = within(screen.getByRole('complementary')).getByRole('img', { name: 'Shazlo' })
    expect(logo).toHaveAttribute('data-tone', 'amber')
    expect(getComputedStyle(logo).filter).toMatch(/^(none)?$/)
  })

  it('reaches every sidebar link from the keyboard, in order', async () => {
    const { user } = await renderShell({ route: '/' })
    const nav = await screen.findByRole('navigation', { name: 'Shazlo One sections' })
    await waitFor(() => expect(within(nav).getByRole('link', { name: /^Catalogue\s*, 14 waiting$/ })).toBeInTheDocument())
    await within(nav).findByRole('link', { name: 'Review queue' })
    await within(nav).findByRole('link', { name: 'Drafts' })
    await within(nav).findByRole('link', { name: /^Campaigns\s*, 3 to approve$/ })
    const order = within(nav).getAllByRole('link')
    order[0]!.focus()
    for (const link of order.slice(1)) {
      await user.tab()
      expect(link).toHaveFocus()
    }
    expect(order.map((a) => a.textContent?.replace(/\d+$/, '').replace(/, \d+ .*$/, ''))).toEqual(['Home', 'Catalogue', 'Review queue', 'All sellers', 'Publishing', 'Campaigns', 'Drafts', 'Admins & roles'])
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
    await renderShell({ route: '/catalogue/sellers?status=applied' })
    const iframe = await screen.findByTitle('Catalogue')
    expect(iframe.getAttribute('src')).toBe('https://catalogue.test/sellers?status=applied')
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-downloads')
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(screen.getByRole('status', { name: 'Loading Catalogue' })).toBeInTheDocument()
  })

  it('answers ready with auth: a token for the module audience and the admin, sent only to the module origin', async () => {
    await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    const msg = ready()
    await waitFor(() => expect(post).toHaveBeenCalled())
    const [auth, origin] = post.mock.calls[0]!
    expect(origin).toBe(MODULE_ORIGIN)
    expect(auth).toMatchObject({ protocol: 'shazlo-one', type: 'auth', replyTo: msg.id, payload: { user: { email: 'naman@shazlo.store', roles: ['super_admin'] } } })
    expect((auth as { payload: { accessToken: string } }).payload.accessToken).toMatch(new RegExp(`^mock\\.vendor-api\\.${ADMIN_ID.naman}\\.`))
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading Catalogue' })).toBeNull())
  })

  it('ignores messages from another origin or another window', async () => {
    await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    const msg = moduleMessage('ready', { module: 'catalogue', supportedVersions: [1], moduleVersion: '0.1.0' })
    fromModule(msg, { origin: 'https://evil.example' })
    fromModule(msg, { source: window })
    await new Promise((r) => setTimeout(r, 50))
    expect(post).not.toHaveBeenCalled()
    expect(screen.getByRole('status', { name: 'Loading Catalogue' })).toBeInTheDocument()
  })

  it('syncs the module title into the breadcrumb, tab title and URL', async () => {
    const { router } = await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    ready()
    fromModule(moduleMessage('title', { path: '/review/product/p_ajrakh', title: 'Ajrakh Block-Print Kurta' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalogue/review/product/p_ajrakh'))
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Ajrakh Block-Print Kurta')
    expect(document.title).toBe('Ajrakh Block-Print Kurta · Catalogue · Shazlo One')
  })

  it('moves the module with navigate when a sidebar link is picked', async () => {
    const { user } = await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    ready()
    fromModule(moduleMessage('title', { path: '/queue', title: 'Review queue' }))
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    await user.click(await within(sidebar()).findByRole('link', { name: 'Publishing' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'navigate', payload: { path: '/publishing' } }), MODULE_ORIGIN))
    expect(frame().getAttribute('src')).toBe('https://catalogue.test/queue')
  })

  it('moves the module back to its home page when its sidebar row is picked', async () => {
    const { user, router } = await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    await manifestIn()
    ready()
    fromModule(moduleMessage('title', { path: '/queue', title: 'Review queue' }))
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    await user.click(within(sidebar()).getByRole('link', { name: /^Catalogue/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalogue/dashboard'))
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'navigate', payload: { path: '/dashboard' } }), MODULE_ORIGIN))
    expect(frame().getAttribute('src')).toBe('https://catalogue.test/queue')
  })

  it('shows module toasts in the shell', async () => {
    await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    ready()
    fromModule(moduleMessage('toast', { level: 'success', message: 'Approved. Publishing to the app.' }))
    expect(await screen.findByText('Approved. Publishing to the app.')).toBeInTheDocument()
  })

  it('answers token:request with a fresh token, at most once every 30 seconds', async () => {
    await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    ready()
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    fromModule(moduleMessage('token:request', { reason: 'unauthorized' }))
    fromModule(moduleMessage('token:request', { reason: 'unauthorized' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 50))
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1]![0]).toMatchObject({ type: 'auth' })
  })

  it('signs out when the module asks to', async () => {
    const { router } = await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    ready()
    fromModule(moduleMessage('logout', {}))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
  })

  it('refuses a module version it does not support', async () => {
    await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    fromModule(moduleMessage('ready', { module: 'catalogue', supportedVersions: [9], moduleVersion: '9.0.0' }))
    expect(await screen.findByRole('heading', { name: 'Catalogue 9.0.0 needs a newer Shazlo One' })).toBeInTheDocument()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', payload: expect.objectContaining({ code: 'version_unsupported' }) }), MODULE_ORIGIN)
  })

  it('shows Try again after 10 silent seconds, and gives up after three attempts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    for (const attempt of [1, 2]) {
      act(() => vi.advanceTimersByTime(10_000))
      expect(await screen.findByRole('heading', { name: 'Catalogue did not load' })).toBeInTheDocument()
      expect(screen.getByText(`Attempt ${attempt} of 3`)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
    }
    act(() => vi.advanceTimersByTime(10_000))
    expect(await screen.findByRole('heading', { name: 'Catalogue is unavailable right now' })).toBeInTheDocument()
    expect(screen.queryByTitle('Catalogue')).toBeNull()
  })
})

// ADR 0011: a module that is down (its web app and its backend) takes down only itself.
describe('a module that is down', () => {
  function catalogueDown() {
    server.use(
      http.get(catalogue.manifestUrl, () => HttpResponse.error()),
      http.get(catalogue.entry.summaryUrl!, () => HttpResponse.error()),
    )
  }

  it('keeps sign-in, Home, Admins and change-password working, and marks only that module', async () => {
    catalogueDown()
    const { user, router } = await renderShell({ route: '/sign-in', as: null })
    await user.type(await screen.findByLabelText('Work email'), 'naman@shazlo.store')
    await user.type(screen.getByLabelText('Password'), 'shazlo-one-2026')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))

    // Home: the module's own card says it did not load; the other module's card is untouched.
    const failed = (await screen.findByText('Catalogue figures did not load')).closest<HTMLElement>('[role="alert"]')!
    expect(failed).toHaveTextContent('The module did not answer.')
    const campaigns = await screen.findByRole('region', { name: 'Campaigns' })
    expect(within(await within(campaigns).findByRole('group', { name: 'Drafts to approve' })).getByText('3')).toBeInTheDocument()

    // Sidebar: the module keeps its registry title, with no pages and no badge (never a 0).
    const nav = screen.getByRole('navigation', { name: 'Shazlo One sections' })
    await waitFor(() => expect(within(nav).getByRole('link', { name: /^Campaigns\s*, 3 to approve$/ })).toBeInTheDocument())
    expect(within(nav).getByRole('link', { name: 'Catalogue' })).toHaveAttribute('href', '/catalogue/')
    expect(within(nav).queryByRole('link', { name: 'Review queue' })).toBeNull()

    await user.click(within(nav).getByRole('link', { name: 'Admins & roles' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Admins & roles' })).toBeInTheDocument()
    await act(() => router.navigate('/change-password'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose your own password' })).toBeInTheDocument()
  })

  it('still frames the module under its registry title, and gives up on it after three silent attempts', async () => {
    catalogueDown()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user, router } = await renderShell({ route: '/catalogue/queue' })
    expect((await screen.findByTitle('Catalogue')).getAttribute('src')).toBe('https://catalogue.test/queue')
    for (let attempt = 1; attempt < 3; attempt++) {
      act(() => vi.advanceTimersByTime(10_000))
      await user.click(await screen.findByRole('button', { name: 'Try again' }))
    }
    act(() => vi.advanceTimersByTime(10_000))
    expect(await screen.findByRole('heading', { name: 'Catalogue is unavailable right now' })).toBeInTheDocument()
    expect(screen.getByText(/The rest of Shazlo One still works/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to Home' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('region', { name: 'Campaigns' })).toBeInTheDocument()
  })

  it('shows no badge while a summary is slow, and no badge once it fails', async () => {
    let answer: 'wait' | 'fail' = 'wait'
    server.use(
      http.get(catalogue.entry.summaryUrl!, async () => {
        if (answer === 'fail') return HttpResponse.json({ error: { code: 'internal_error', message: 'Down', request_id: 'r' } }, { status: 500 })
        await new Promise(() => {})
      }),
    )
    const { context } = await renderShell({ route: '/admins' })
    const nav = await screen.findByRole('navigation', { name: 'Shazlo One sections' })
    await waitFor(() => expect(within(nav).getByRole('link', { name: /^Campaigns\s*, 3 to approve$/ })).toBeInTheDocument())
    expect(within(nav).getByRole('link', { name: /^Catalogue/ })).toHaveAccessibleName('Catalogue')
    answer = 'fail'
    await act(() => context.queryClient.refetchQueries({ queryKey: ['module-summary', 'catalogue'] }))
    expect(within(nav).getByRole('link', { name: /^Catalogue/ })).toHaveAccessibleName('Catalogue')
  })
})

describe('a module: its home page first, its pages in the top bar too', () => {
  it.each(['/catalogue/dashboard', '/catalogue'])('makes the module row open its home page, current on %s', async (route) => {
    await renderShell({ route })
    await screen.findByTitle('Catalogue')
    await manifestIn()
    const row = within(sidebar()).getByRole('link', { name: /^Catalogue/ })
    expect(row).toHaveAttribute('href', '/catalogue/dashboard')
    expect(row).toHaveAttribute('aria-current', 'page')
    for (const name of PAGES) expect(within(sidebar()).getByRole('link', { name })).not.toHaveAttribute('aria-current')
  })

  it('links the module row to its home page, and the crumb to the bare base path, from a module page', async () => {
    await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    await manifestIn()
    const row = within(sidebar()).getByRole('link', { name: /^Catalogue/ })
    expect(row).toHaveAttribute('href', '/catalogue/dashboard')
    expect(row).not.toHaveAttribute('aria-current')
    // The module names its page; "Catalogue" then becomes a crumb link. The bare base path opens the home page.
    ready()
    fromModule(moduleMessage('title', { path: '/queue', title: 'Review queue' }))
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    await waitFor(() => expect(within(crumbs).getByRole('link', { name: 'Catalogue' })).toHaveAttribute('href', '/catalogue'))
  })

  it.each(['/catalogue', '/catalogue/'])('loads the module on its home page from the bare %s once the manifest is in', async (route) => {
    const { router } = await renderShell({ route: '/' })
    await within(sidebar()).findByRole('link', { name: 'Review queue' })
    await act(() => router.navigate(route))
    expect((await screen.findByTitle('Catalogue')).getAttribute('src')).toBe('https://catalogue.test/dashboard')
    expect(within(sidebar()).getByRole('link', { name: /^Catalogue/ })).toHaveAttribute('aria-current', 'page')
  })

  it('loads the module root from the bare base path before the manifest is in, and follows the page the module opens on', async () => {
    const { router } = await renderShell({ route: '/catalogue' })
    expect((await screen.findByTitle('Catalogue')).getAttribute('src')).toBe('https://catalogue.test/')
    ready()
    fromModule(moduleMessage('title', { path: '/dashboard', title: 'Dashboard' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalogue/dashboard'))
    // The row knows the home page once the manifest names it.
    await waitFor(() => expect(within(sidebar()).getByRole('link', { name: /^Catalogue/ })).toHaveAttribute('aria-current', 'page'))
  })

  it('keeps a page picked in the top bar while the module is still loading', async () => {
    document.title = ''
    const { user, router } = await renderShell({ route: '/catalogue/dashboard' })
    await screen.findByTitle('Catalogue')
    await manifestIn()
    expect(screen.getByRole('status', { name: 'Loading Catalogue' })).toBeInTheDocument()
    await user.click(within(topNav()!).getByRole('link', { name: 'Review queue' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalogue/queue'))
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    ready()
    // The module reports the page it was loaded on, after the admin had moved on.
    fromModule(moduleMessage('title', { path: '/dashboard', title: 'Dashboard' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'navigate', payload: { path: '/queue' } }), MODULE_ORIGIN))
    expect(router.state.location.pathname).toBe('/catalogue/queue')
    expect(document.title).toBe('')
    expect(within(topNav()!).getByRole('link', { name: 'Review queue' })).toHaveAttribute('aria-current', 'page')
    // The module arrives and names its page; the shell URL already matches, so nothing else moves.
    fromModule(moduleMessage('title', { path: '/queue', title: 'Review queue' }))
    await waitFor(() => expect(document.title).toBe('Review queue · Catalogue · Shazlo One'))
    expect(router.state.location.pathname).toBe('/catalogue/queue')
    expect(post.mock.calls.filter(([m]) => (m as { type: string }).type === 'navigate')).toHaveLength(1)
  })

  it.each([
    ['/catalogue/queue', 'Review queue'],
    ['/catalogue/sellers/s_kalki', 'All sellers'],
    ['/catalogue/review/listing/l1', 'Review queue'],
    ['/catalogue/publishing', 'Publishing'],
    ['/catalogue/dashboard', null],
  ])('lists the module pages in the top bar on %s, with %s current', async (route, current) => {
    await renderShell({ route })
    await screen.findByTitle('Catalogue')
    await manifestIn()
    const nav = topNav()!
    expect(screen.getByRole('banner')).toContainElement(nav)
    const links = within(nav).getAllByRole('link')
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Review queue', '/catalogue/queue'],
      ['All sellers', '/catalogue/sellers'],
      ['Publishing', '/catalogue/publishing'],
    ])
    for (const a of links) {
      const icon = a.querySelector('svg')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('stroke-width', '1.75')
      const isCurrent = a.textContent === current
      expect(a.getAttribute('aria-current'), a.textContent!).toBe(isCurrent ? 'page' : null)
      // The current page has a visible bar under it; the others do not.
      expect(a.querySelector('[data-indicator]') !== null, a.textContent!).toBe(isCurrent)
    }
    // The sidebar marks the same page.
    for (const name of PAGES) expect(within(sidebar()).getByRole('link', { name }).getAttribute('aria-current'), name).toBe(name === current ? 'page' : null)
  })

  it('moves the module with navigate when a top bar page is picked, without reloading it', async () => {
    const { user, router } = await renderShell({ route: '/catalogue/dashboard' })
    await screen.findByTitle('Catalogue')
    await manifestIn()
    ready()
    fromModule(moduleMessage('title', { path: '/dashboard', title: 'Dashboard' }))
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    await user.click(within(topNav()!).getByRole('link', { name: 'All sellers' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalogue/sellers'))
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'navigate', payload: { path: '/sellers' } }), MODULE_ORIGIN))
    expect(frame().getAttribute('src')).toBe('https://catalogue.test/dashboard')
    expect(within(topNav()!).getByRole('link', { name: 'All sellers' })).toHaveAttribute('aria-current', 'page')
    expect(within(sidebar()).getByRole('link', { name: 'All sellers' })).toHaveAttribute('aria-current', 'page')
  })

  it.each(['/', '/admins'])('shows no module pages row on %s', async (route) => {
    await renderShell({ route })
    await screen.findByRole('heading', { level: 1 })
    expect(topNav()).toBeNull()
  })

  it('shows no module pages row, and keeps the header short, in a module the admin may not open', async () => {
    const { context } = await renderShell({ route: '/catalogue/queue', as: 'priya' })
    await screen.findByTitle('Catalogue')
    await manifestIn()
    expect(topNav()).not.toBeNull()
    const admin = context.session.get().admin!
    act(() => context.session.signIn({ access_token: context.session.accessToken()!, expires_in: 900, must_change_password: false, admin: { ...admin, roles: [] } }))
    expect(await screen.findByRole('heading', { name: 'You do not have access to Catalogue' })).toBeInTheDocument()
    expect(topNav()).toBeNull()
    expect(shellTop()).toBe('56px')
  })

  it('makes the header taller inside a module, so the iframe still fills the screen exactly', async () => {
    const { router } = await renderShell({ route: '/catalogue/queue' })
    await screen.findByTitle('Catalogue')
    await manifestIn()
    expect(shellTop()).toBe('104px')
    await act(() => router.navigate('/'))
    await screen.findByRole('heading', { level: 1 })
    expect(topNav()).toBeNull()
    expect(shellTop()).toBe('56px')
  })
})
