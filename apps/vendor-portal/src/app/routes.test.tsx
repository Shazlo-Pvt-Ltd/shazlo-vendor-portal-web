import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../session/AuthProvider'
import { apiError, makeStore, sessionBody } from '../session/testing'
import { portalRoutes, routes } from './routes'

/** Opens a path as a signed-in owner, or as a signed-out visitor for the public screens. */
function open(path: string, signedIn = true) {
  const store = makeStore({
    refresh: async () => {
      if (!signedIn) throw apiError(401, 'unauthorized')
      return sessionBody()
    },
  }).store
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider store={store}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('routes', () => {
  // Screens that are built have their own tests (src/features/**).
  const built = new Set(['/signup', '/verify-email', '/login', '/forgot-password', '/set-password'])

  it.each(portalRoutes.filter((route) => !built.has(route.path)))('$path shows "$title" and sets the page title', async ({ path, title, access }) => {
    open(path.replace(':productId', '123'), access !== 'public' && access !== 'open')
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy()
    expect(document.title).toBe(`${title} · Shazlo Vendor Portal`)
  })

  it('shows the not-found page for an unknown address', async () => {
    open('/no/such/page')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to the dashboard' }).getAttribute('href')).toBe('/')
  })

  it('knows who may open each route', () => {
    const access = Object.fromEntries(portalRoutes.map((route) => [route.path, route.access]))
    expect(access['/login']).toBe('public')
    expect(access['/signup']).toBe('public')
    expect(access['/']).toBe('authenticated')
    expect(access['/team']).toBe('owner')
    expect(access['/set-password']).toBe('open')
    expect(access['/verify-email']).toBe('open')
    expect(portalRoutes.every((route) => ['public', 'open', 'authenticated', 'owner'].includes(route.access))).toBe(true)
  })

  it('has no duplicate paths', () => {
    const paths = portalRoutes.map((route) => route.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
