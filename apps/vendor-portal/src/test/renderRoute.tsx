import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import type { RouteObject } from 'react-router'
import { routes as appRoutes } from '../app/routes'
import { AuthProvider } from '../session/AuthProvider'
import { ConfirmProvider } from '../ui/ConfirmDialog'
import { ToastProvider } from '../ui/Toast'
import type { SessionStore } from '../session/store'
import { apiError, makeStore } from '../session/testing'

/** Opens a route as a signed-out visitor, with the real routes, session guards and API client. */
export function renderRoute(
  path: string,
  options: { strict?: boolean; store?: SessionStore; queryClient?: QueryClient; routes?: RouteObject[] } = {},
) {
  const store = options.store ?? makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') } }).store
  const router = createMemoryRouter(options.routes ?? appRoutes, { initialEntries: [path] })
  const queryClient =
    options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const tree = (
    <QueryClientProvider client={queryClient}>
      <AuthProvider store={store}>
        <ToastProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
  render(options.strict ? <StrictMode>{tree}</StrictMode> : tree)
  return router
}
