import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import type { RouteObject } from 'react-router'
import { routes as appRoutes } from '../app/routes'
import { AuthProvider } from '../session/AuthProvider'
import type { SessionStore } from '../session/store'
import { apiError, makeStore } from '../session/testing'

/** Opens a route as a signed-out visitor, with the real routes, session guards and API client. */
export function renderRoute(
  path: string,
  options: { store?: SessionStore; queryClient?: QueryClient; routes?: RouteObject[] } = {},
) {
  const store = options.store ?? makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') } }).store
  const router = createMemoryRouter(options.routes ?? appRoutes, { initialEntries: [path] })
  const queryClient =
    options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider store={store}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}
