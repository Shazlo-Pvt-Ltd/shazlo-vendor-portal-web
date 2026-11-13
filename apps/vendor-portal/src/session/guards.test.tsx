import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../app/routes'
import { AuthProvider } from './AuthProvider'
import { apiError, makeStore, sessionBody } from './testing'
import type { SessionStore } from './store'
import { NetworkError } from '../api/errors'

afterEach(() => vi.restoreAllMocks())

async function open(path: string, store: SessionStore) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider store={store}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

const signedIn = (role = 'owner') => makeStore({ refresh: async () => sessionBody({ role }) }).store
const signedOut = () => makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') } }).store

describe('RequireAuth', () => {
  it('shows a spinner while the session is restored, then the page', async () => {
    const router = await open('/products', signedIn())
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 1, name: 'Products' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/products')
  })

  it('sends a signed-out user to login with a return-to, then nothing else', async () => {
    const router = await open('/products/42?tab=images', signedOut())
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(router.state.location.pathname).toBe('/login')
    expect(new URLSearchParams(router.state.location.search).get('return-to')).toBe('/products/42?tab=images')
  })

  it('sends the dashboard to a plain /login', async () => {
    const router = await open('/', signedOut())
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(router.state.location.search).toBe('')
  })

  it('says the server is unreachable instead of signing out', async () => {
    const store = makeStore({ refresh: async () => { throw new NetworkError('network') } }).store
    await open('/brand', store)
    expect(await screen.findByRole('heading', { level: 1, name: "Can't reach the server" })).toBeTruthy()
  })

  it('shows the explanation page for a suspended vendor, in place and without a redirect loop', async () => {
    const store = makeStore({ refresh: async () => { throw apiError(403, 'vendor_not_allowed') } }).store
    const router = await open('/brand', store)
    expect(await screen.findByRole('heading', { level: 1, name: "This account can't use the portal" })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/brand')
    expect(screen.getByRole('link', { name: 'Contact support' }).getAttribute('href')).toMatch(/^mailto:/)
  })
})

describe('PublicOnly', () => {
  it('lets a signed-out user see login', async () => {
    await open('/login', signedOut())
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
  })

  it('sends a signed-in user to the dashboard', async () => {
    const router = await open('/login', signedIn())
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    expect(router.state.location.pathname).toBe('/')
  })

  it('sends a signed-in user to a valid return-to, and ignores a hostile one', async () => {
    const router = await open('/login?return-to=%2Fproducts', signedIn())
    await screen.findByRole('heading', { level: 1, name: 'Products' })
    expect(router.state.location.pathname).toBe('/products')
    const other = await open('/login?return-to=https%3A%2F%2Fevil.example', signedIn())
    await vi.waitFor(() => expect(other.state.location.pathname).toBe('/'))
  })

  it('lets a blocked vendor reach login to use another account', async () => {
    const store = makeStore({ refresh: async () => { throw apiError(403, 'vendor_not_allowed') } }).store
    await open('/login', store)
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
  })
})

describe('RequireRole', () => {
  it('lets the owner open /team', async () => {
    await open('/team', signedIn('owner'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Team' })).toBeTruthy()
  })

  it('shows staff a not-allowed page at /team, not a redirect', async () => {
    const router = await open('/team', signedIn('staff'))
    expect(await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/team')
  })

  it('lets staff open the pages that are not owner-only', async () => {
    await open('/products', signedIn('staff'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Products' })).toBeTruthy()
  })
})
