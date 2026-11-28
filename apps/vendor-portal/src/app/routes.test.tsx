import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderPortal, WIDTHS } from '../session/renderPortal'
import { portalRoutes, redirects, routes, screens, TITLE_SUFFIX } from './routes'

const access = Object.fromEntries(portalRoutes.map((route) => [route.path, route.access]))

describe('the route table', () => {
  it('uses main\'s addresses for everything vendor-api\'s emails link to', () => {
    expect(access).toMatchObject({
      '/login': 'public',
      '/signup': 'public',
      '/forgot-password': 'public',
      '/verify-email': 'open',
      '/set-password': 'open',
      '/reset-password': 'open',
      '/accept-invite': 'open',
      '/account': 'authenticated',
      '/team': 'owner',
    })
  })

  it('keeps Build 2\'s seller pages, signed in only', () => {
    for (const path of ['/', '/brand', '/products', '/products/import', '/products/new', '/products/:id', '/review', '/store', '/store/details', '/store/details/:section', '/account/password', '/help']) {
      expect(access[path], path).toBe('authenticated')
    }
  })

  it('makes Team the only owner-only page', () => {
    expect(portalRoutes.filter((route) => route.access === 'owner').map((route) => route.path)).toEqual(['/team'])
  })

  it('has a screen for every route and no screen without a route', () => {
    expect(Object.keys(screens).sort()).toEqual(portalRoutes.map((route) => route.path).sort())
  })

  it('has no duplicate paths and gives every page a title', () => {
    const paths = portalRoutes.map((route) => route.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(portalRoutes.every((route) => route.title.trim() !== '')).toBe(true)
  })

  it('sends the old addresses to the new ones', () => {
    expect(redirects).toEqual({
      '/sign-in': '/login',
      '/apply': '/signup',
      '/submissions': '/review',
      '/settings': '/store/details',
      '/import': '/products/import',
    })
    for (const [from, to] of Object.entries(redirects)) {
      expect(access[from], from).toBeUndefined()
      expect(access[to], to).toBeDefined()
    }
  })

  it('catches errors at the top, so no route can show a blank page', () => {
    expect(routes[0]?.errorElement).toBeTruthy()
  })
})

describe('opening a route', () => {
  it.each(Object.entries(redirects))('%s redirects to %s and keeps the query and fragment', async (from, to) => {
    const { router } = renderPortal({ route: `${from}?next=%2Freview#top`, session: 'signedOut' })
    await waitFor(() => expect(router.state.location.pathname).toBe(to === '/login' || to === '/signup' ? to : '/login'))
    if (to === '/login' || to === '/signup') {
      expect(router.state.location.search).toBe('?next=%2Freview')
      expect(router.state.location.hash).toBe('#top')
    } else {
      // A signed-out visitor is then sent to sign in, and comes back to the new address.
      expect(new URLSearchParams(router.state.location.search).get('next')).toBe(`${to}?next=%2Freview#top`)
    }
  })

  it.each([
    ['/', 'Home'],
    ['/products', 'Products'],
    ['/store/details', 'Store details'],
    ['/team', 'Team'],
    ['/help', 'Help & support'],
  ])('%s sets the page title "%s"', async (path, title) => {
    renderPortal({ route: path })
    await waitFor(() => expect(document.title).toBe(`${title} · ${TITLE_SUFFIX}`))
  })

  it('sets the sign-in title for a signed-out visitor', async () => {
    renderPortal({ route: '/login', session: 'signedOut' })
    await waitFor(() => expect(document.title).toBe(`Sign in · ${TITLE_SUFFIX}`))
  })

  it('shows the not-found page inside the frame, so the navigation is still there', async () => {
    renderPortal({ route: '/no/such/page' })
    expect(await screen.findByRole('heading', { level: 1, name: 'We could not find that page' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Seller sections' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/')
    await waitFor(() => expect(document.title).toBe(`Page not found · ${TITLE_SUFFIX}`))
  })

  it('asks a signed-out visitor to sign in before saying a page does not exist', async () => {
    const { router } = renderPortal({ route: '/no/such/page', session: 'signedOut' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    // The address is not a page, so sign-in does not offer to return to it.
    expect(router.state.location.search).toBe('')
  })

  it.each(['/verify-email', '/set-password', '/reset-password', '/accept-invite'])(
    'shows the emailed link %s to a signed-out visitor without the seller frame',
    async (path) => {
      renderPortal({ route: `${path}#token=abc`, session: 'signedOut' })
      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'Seller sections' })).toBeNull()
    },
  )

  it('opens a deep link on a phone in its full-screen task', async () => {
    renderPortal({ route: '/store/details/payout', width: WIDTHS.phone })
    const header = await screen.findByRole('banner')
    expect(await within(header).findByRole('link', { name: 'Back to Store details' })).toHaveAttribute('href', '/store/details')
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })
})
