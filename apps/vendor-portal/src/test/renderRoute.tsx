import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { routes } from '../app/routes'
import { AuthProvider } from '../session/AuthProvider'
import type { SessionStore } from '../session/store'
import { apiError, makeStore } from '../session/testing'

/** Opens a route as a signed-out visitor, with the real routes, session guards and API client. */
export function renderRoute(path: string, options: { strict?: boolean; store?: SessionStore } = {}) {
  const store = options.store ?? makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') } }).store
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const tree = (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <AuthProvider store={store}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  )
  render(options.strict ? <StrictMode>{tree}</StrictMode> : tree)
  return router
}
