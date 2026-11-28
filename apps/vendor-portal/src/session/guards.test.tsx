import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { NetworkError } from '../api/errors'
import { apiErrorBody, renderPortal, TEST_API } from './renderPortal'
import { apiError, makeStore, sessionBody } from './testing'

const SIGN_IN = 'Sign in to your seller account'
const REFRESH = TEST_API + '/v1/auth/refresh'
const VENDOR_ROUTES = TEST_API + '/v1/vendor/*'

describe('RequireAuth', () => {
  it('shows a spinner while the session is restored, then the page', async () => {
    let restore: () => void = () => {}
    const store = makeStore({ refresh: () => new Promise((resolve) => { restore = () => resolve(sessionBody()) }) }).store
    const { router } = renderPortal({ route: '/products', session: store })
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    restore()
    expect(await screen.findByRole('navigation', { name: 'Seller sections' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/products')
  })

  it('sends a signed-out user to login with where they were going, and nothing else', async () => {
    const { router } = renderPortal({ route: '/products/42?tab=images#photos', session: 'signedOut' })
    await screen.findByRole('heading', { level: 1, name: SIGN_IN })
    expect(router.state.location.pathname).toBe('/login')
    expect([...new URLSearchParams(router.state.location.search).keys()]).toEqual(['next'])
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/products/42?tab=images#photos')
  })

  it('sends the dashboard to a plain /login', async () => {
    const { router } = renderPortal({ route: '/', session: 'signedOut' })
    await screen.findByRole('heading', { level: 1, name: SIGN_IN })
    expect(router.state.location.search).toBe('')
  })

  it('says the server is unreachable instead of signing out, and tries again', async () => {
    let down = true
    const store = makeStore({
      refresh: async () => {
        if (down) throw new NetworkError('network')
        return sessionBody()
      },
    }).store
    const { user, router } = renderPortal({ route: '/brand', session: store })
    expect(await screen.findByRole('heading', { level: 1, name: "Can't reach the server" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/brand')
    down = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('navigation', { name: 'Seller sections' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/brand')
  })

  it('shows the explanation page for a suspended vendor, in place and without a redirect loop', async () => {
    const { router } = renderPortal({ route: '/brand', session: 'blocked' })
    expect(await screen.findByRole('heading', { level: 1, name: "This account can't use Shazlo Seller" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/brand')
    expect(screen.getByRole('link', { name: 'Email support' }).getAttribute('href')).toMatch(/^mailto:/)
    expect(screen.queryByRole('navigation', { name: 'Seller sections' })).toBeNull()
  })

  it('lets a blocked vendor sign in with another account', async () => {
    const { user, router } = renderPortal({ route: '/brand', session: 'blocked' })
    await user.click(await screen.findByRole('button', { name: 'Sign in with another account' }))
    await screen.findByRole('heading', { level: 1, name: SIGN_IN })
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('')
  })
})

describe('PublicOnly', () => {
  it('lets a signed-out user see login', async () => {
    renderPortal({ route: '/login', session: 'signedOut' })
    expect(await screen.findByRole('heading', { level: 1, name: SIGN_IN })).toBeInTheDocument()
  })

  it('sends a signed-in user to the dashboard', async () => {
    const { router } = renderPortal({ route: '/login' })
    await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(router.state.location.pathname).toBe('/')
  })

  it('sends a signed-in user to a valid next page', async () => {
    const { router } = renderPortal({ route: '/login?next=%2Fproducts' })
    await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(router.state.location.pathname).toBe('/products')
  })

  it.each(['https://evil.example', '//evil.com', 'javascript:alert(1)', '/\\evil.com'])('ignores the hostile next %j', async (next) => {
    const { router } = renderPortal({ route: `/login?next=${encodeURIComponent(next)}` })
    await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toBe('')
  })

  it('lets a blocked vendor reach login to use another account', async () => {
    renderPortal({ route: '/login', session: 'blocked' })
    expect(await screen.findByRole('heading', { level: 1, name: SIGN_IN })).toBeInTheDocument()
  })

  it('also guards sign-up and forgot password', async () => {
    for (const path of ['/signup', '/forgot-password']) {
      const { router, unmount } = renderPortal({ route: path })
      await waitFor(() => expect(router.state.location.pathname).toBe('/'))
      unmount()
    }
  })
})

describe('RequireRole', () => {
  it('lets the owner open /team', async () => {
    renderPortal({ route: '/team', session: 'owner' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Team' })).toBeInTheDocument()
  })

  it('shows staff a not-allowed page at /team, inside the frame, not a redirect', async () => {
    const { router } = renderPortal({ route: '/team', session: 'staff' })
    expect(await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/team')
    expect(screen.getByRole('navigation', { name: 'Seller sections' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Team' })).toBeNull()
  })

  it('lets staff open the pages that are not owner-only', async () => {
    const { router } = renderPortal({ route: '/products', session: 'staff' })
    await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(router.state.location.pathname).toBe('/products')
    expect(screen.queryByRole('heading', { level: 1, name: "You don't have access to this page" })).toBeNull()
  })
})

describe('emailed links while someone is signed in', () => {
  it.each(['/reset-password', '/accept-invite', '/set-password', '/verify-email'])(
    '%s asks before using the link, and signs out first when asked',
    async (path) => {
      const store = makeStore({ refresh: async () => sessionBody({ role: 'owner' }) }).store
      const { user, router } = renderPortal({ route: `${path}#token=abc`, session: store })
      const page = await screen.findByRole('main')
      expect(within(page).getByRole('heading', { level: 1, name: 'You are signed in' })).toBeInTheDocument()
      expect(page).toHaveTextContent('owner@brand.test')
      // The link's token is still in the address: the page reads it once the visitor decides.
      expect(router.state.location.hash).toBe('#token=abc')
      await user.click(within(page).getByRole('button', { name: 'Sign out and continue' }))
      await waitFor(() => expect(store.getSnapshot().status).toBe('signedOut'))
      expect(screen.queryByRole('heading', { level: 1, name: 'You are signed in' })).toBeNull()
      expect(router.state.location.pathname).toBe(path)
    },
  )

  it('lets the signed-in user keep their session and go home instead', async () => {
    const store = makeStore({ refresh: async () => sessionBody() }).store
    const { user, router } = renderPortal({ route: '/reset-password#token=abc', session: store })
    await user.click(await screen.findByRole('link', { name: 'Stay signed in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(store.getSnapshot().status).toBe('signedIn')
  })

  it('shows the page at once to a signed-out visitor', async () => {
    renderPortal({ route: '/reset-password#token=abc', session: 'signedOut' })
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('heading', { level: 1, name: 'You are signed in' })).toBeNull()
  })
})

describe('a session that ends while working', () => {
  it('sends the user to login with the page they were on and says why', async () => {
    let answer: 'ok' | 'gone' = 'ok'
    const store = makeStore({
      refresh: async () => {
        if (answer === 'gone') throw apiError(401, 'unauthorized')
        return sessionBody()
      },
    }).store
    const { router } = renderPortal({ route: '/review?filter=sent_back', session: store })
    await screen.findByRole('navigation', { name: 'Seller sections' })
    answer = 'gone'
    await store.renew()
    await screen.findByRole('heading', { level: 1, name: SIGN_IN })
    expect(router.state.location.pathname).toBe('/login')
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/review?filter=sent_back')
    expect(screen.getByText(/Your session ended/)).toBeInTheDocument()
  })
})

describe('breaking it: the real session against a failing API', () => {
  it('a 401 on a page, then a refresh that is refused, ends in login with the page kept', async () => {
    let refreshes = 0
    const { router } = renderPortal({
      route: '/products?status=live',
      session: 'real',
      handlers: [
        http.post(REFRESH, () => {
          refreshes += 1
          return refreshes === 1 ? HttpResponse.json(sessionBody()) : apiErrorBody(401, 'unauthorized')
        }),
        http.all(VENDOR_ROUTES, () => apiErrorBody(401, 'unauthorized', 'expired')),
      ],
    })
    await screen.findByRole('heading', { level: 1, name: SIGN_IN })
    expect(router.state.location.pathname).toBe('/login')
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/products?status=live')
    expect(await screen.findByText(/Your session ended/)).toBeInTheDocument()
    // One refresh at load and one shared renewal for every failed call, not one per call.
    expect(refreshes).toBe(2)
  })

  it('a refresh that cannot reach the server keeps the seller signed in', async () => {
    let refreshes = 0
    const { router } = renderPortal({
      route: '/review',
      session: 'real',
      handlers: [
        http.post(REFRESH, () => {
          refreshes += 1
          return refreshes === 1 ? HttpResponse.json(sessionBody()) : HttpResponse.error()
        }),
        http.all(VENDOR_ROUTES, () => apiErrorBody(401, 'unauthorized', 'expired')),
      ],
    })
    await screen.findByRole('navigation', { name: 'Seller sections' })
    await waitFor(() => expect(refreshes).toBeGreaterThanOrEqual(2))
    expect(router.state.location.pathname).toBe('/review')
    expect(screen.getByRole('navigation', { name: 'Seller sections' })).toBeInTheDocument()
  })

  it('a vendor suspended while working sees the explanation in place, not an error on every call', async () => {
    const { router } = renderPortal({
      route: '/brand',
      session: 'real',
      handlers: [
        http.post(REFRESH, () => HttpResponse.json(sessionBody())),
        http.all(VENDOR_ROUTES, () => apiErrorBody(403, 'vendor_not_allowed', 'Suspended')),
      ],
    })
    expect(await screen.findByRole('heading', { level: 1, name: "This account can't use Shazlo Seller" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/brand')
    expect(screen.queryByRole('navigation', { name: 'Seller sections' })).toBeNull()
  })

  it('a sign-out in another tab while on a page signs this tab out too', async () => {
    const store = makeStore({ refresh: async () => sessionBody() }).store
    const { router } = renderPortal({ route: '/store/details', session: store })
    await screen.findByRole('navigation', { name: 'Seller sections' })
    await act(() => store.logout())
    await screen.findByRole('heading', { level: 1, name: SIGN_IN })
    expect(router.state.location.search).toBe('')
  })
})
