import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { portalRoutes } from '../portalRoutes'
import { makeStore, sessionBody } from '../../session/testing'
import { RequireAuth } from '../../session/guards'
import { BASE, useApiServer } from '../../test/msw'
import { renderRoute } from '../../test/renderRoute'
import { setViewport } from '../../test/viewport'
import { PageHeader } from '../../ui/PageHeader'
import { AppShell } from './AppShell'
import { PENDING_MESSAGE } from './StatusBanner'

const server = useApiServer()

const SECTIONS = ['Overview', 'Brand page', 'Products', 'Bulk import', 'Submissions', 'Team', 'Account']

interface Options {
  path?: string
  width?: number
  role?: string
  status?: string
}

const LAZY_PAGE_MS = 15_000

async function openSignedIn({ path = '/products', width = 1280, role = 'owner', status = 'approved' }: Options = {}) {
  setViewport(width)
  const store = makeStore({
    refresh: async () => sessionBody({ role, status }),
    logout: async () => { await fetch(`${BASE}/v1/auth/logout`, { method: 'POST' }) },
  }).store
  server.use(
    http.post(`${BASE}/v1/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    http.get(`${BASE}/v1/vendor/brand-profile`, () => HttpResponse.json({ state: 'draft', published_at: null })),
    http.get(`${BASE}/v1/vendor/products`, () => HttpResponse.json({ items: [], total: 0, limit: 1, offset: 0 })),
  )
  const router = renderRoute(path, { store })
  // Each page is a lazy chunk: the first one a test file opens can take seconds to load on a cold, busy machine.
  await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_PAGE_MS })
  return { router, store, user: userEvent.setup() }
}

const links = () => within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('link').map((link) => link.textContent)

describe('the navigation on a desktop (1280 px)', () => {
  it('is always visible, lists every section for the owner, and has no menu button', async () => {
    await openSignedIn({ width: 1280 })
    expect(links()).toEqual(SECTIONS)
    expect(screen.queryByRole('button', { name: 'Open the menu' })).toBeNull()
  })

  it('shows staff every section except Team', async () => {
    await openSignedIn({ role: 'staff' })
    expect(links()).toEqual(SECTIONS.filter((name) => name !== 'Team'))
  })

  it('marks the current section for assistive technology', async () => {
    await openSignedIn({ path: '/products' })
    const current = within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual(['Products'])
  })

  it('goes to a section when its link is used', async () => {
    const { router, user } = await openSignedIn({ path: '/products' })
    await user.click(screen.getByRole('link', { name: 'Brand page' }))
    await screen.findByRole('heading', { level: 1, name: 'Brand page' }, { timeout: LAZY_PAGE_MS })
    expect(router.state.location.pathname).toBe('/brand')
  })
})

describe.each([
  ['a phone (320 px)', 320],
  ['a tablet (768 px, below the desktop breakpoint)', 768],
])('the navigation on %s', (_name, width) => {
  it('is hidden behind a menu button, which opens it', async () => {
    const { user } = await openSignedIn({ width })
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open the menu' }))
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(links()).toEqual(SECTIONS)
  })

  it('closes when a section is chosen, and shows that section', async () => {
    const { router, user } = await openSignedIn({ width })
    await user.click(screen.getByRole('button', { name: 'Open the menu' }))
    await user.click(await screen.findByRole('link', { name: 'Bulk import' }))
    await screen.findByRole('heading', { level: 1, name: 'Bulk import' }, { timeout: LAZY_PAGE_MS })
    expect(router.state.location.pathname).toBe('/import')
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull())
  })

  it('closes with Escape, and keyboard focus stays inside while it is open', async () => {
    const { user } = await openSignedIn({ width })
    await user.click(screen.getByRole('button', { name: 'Open the menu' }))
    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    await user.tab()
    expect(nav.contains(document.activeElement) || document.activeElement?.closest('[role="presentation"]') !== null).toBe(true)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull())
  })

  it('hides Team from staff here too', async () => {
    const { user } = await openSignedIn({ width, role: 'staff' })
    await user.click(screen.getByRole('button', { name: 'Open the menu' }))
    await screen.findByRole('navigation', { name: 'Sections' })
    expect(links()).not.toContain('Team')
  })
})

describe('the vendor status banner', () => {
  it('tells a pending vendor their application is under review', async () => {
    await openSignedIn({ status: 'pending' })
    expect(screen.getByText(PENDING_MESSAGE)).toBeTruthy()
  })

  it('shows an approved vendor nothing', async () => {
    await openSignedIn({ status: 'approved' })
    expect(screen.queryByText(/under review/)).toBeNull()
  })

  it('shows the vendor name in the app bar', async () => {
    await openSignedIn()
    expect(within(screen.getByRole('banner')).getByText('Brand')).toBeTruthy()
  })
})

describe('accessibility', () => {
  it('starts with a skip link to the main content, and the main region can take focus', async () => {
    const { user } = await openSignedIn()
    await user.tab()
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(document.activeElement).toBe(skip)
    expect(skip.getAttribute('href')).toBe('#main-content')
    const main = screen.getByRole('main')
    expect(main.id).toBe('main-content')
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('does not steal focus on the first page', async () => {
    await openSignedIn()
    expect(document.activeElement).toBe(document.body)
  })

  it('moves focus to the new page heading after navigating', async () => {
    const { user } = await openSignedIn({ path: '/products' })
    await user.click(screen.getByRole('link', { name: 'Submissions' }))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Submissions' }, { timeout: LAZY_PAGE_MS })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it.each(portalRoutes.filter((route) => route.access === 'authenticated' || route.access === 'owner'))(
    '$path has exactly one h1 and sets the page title',
    async ({ path, title }) => {
      await openSignedIn({ path: path.replace(':productId', '123') })
      await screen.findByRole('heading', { level: 1, name: title }, { timeout: LAZY_PAGE_MS })
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
      expect(document.title).toBe(`${title} · Shazlo Vendor Portal`)
    },
  )
})

describe('inside the shell', () => {
  it('keeps the navigation on a page that does not exist', async () => {
    await openSignedIn({ path: '/no/such/page' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(links()).toEqual(SECTIONS)
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('keeps the navigation when one page breaks, and recovers when another section is opened', async () => {
    setViewport(1280)
    const Boom = () => {
      throw new Error('this page is broken')
    }
    const store = makeStore({ refresh: async () => sessionBody() }).store
    const router = renderRoute('/boom', {
      store,
      routes: [
        {
          element: <RequireAuth />,
          children: [
            {
              element: <AppShell />,
              children: [
                { path: '/boom', element: <Boom /> },
                { path: '/', element: <PageHeader title="Overview" /> },
              ],
            },
          ],
        },
      ],
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'This page ran into a problem' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(screen.queryByText(/this page is broken/)).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: 'Overview' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('signing out', () => {
  it('shows who is signed in in the account menu', async () => {
    const { user } = await openSignedIn()
    await user.click(screen.getByRole('button', { name: 'Account' }))
    expect(await screen.findByText('owner@brand.test')).toBeTruthy()
    expect(screen.getByText(/Brand · Owner/)).toBeTruthy()
  })

  it('signs out from the account menu, ends the session and goes to a plain login', async () => {
    const { router, store, user } = await openSignedIn()
    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(store.getSnapshot().status).toBe('signedOut')
    expect(store.getAccessToken()).toBeNull()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('')
  })

  it('does not send the next login "back" to the page the user signed out from', async () => {
    const { router, user } = await openSignedIn({ path: '/products' })
    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(new URLSearchParams(router.state.location.search).get('return-to')).toBeNull()
  })
})
