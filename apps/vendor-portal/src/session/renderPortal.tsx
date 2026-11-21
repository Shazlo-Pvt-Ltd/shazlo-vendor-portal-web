import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RequestHandler } from 'msw'
import { createMemoryRouter, type RouteObject } from 'react-router'
import { App } from '../App'
import { routes as appRoutes } from '../app/routes'
import type { SessionStore } from './store'
import { setTestViewport, signedInStore, stubApi, WIDTHS } from './testApi'
import { apiError, makeStore } from './testing'

/*
 * Renders the whole app for the frame's tests: the environment check, the providers, the real
 * routes, guards and shell, with a session chosen by the test and an API that answers only what
 * the test says (./testApi.ts). Screens that need the mock database use src/test/**.
 */

export { apiErrorBody, setTestViewport, signedInStore, stubApi, TEST_API, WIDTHS } from './testApi'

export type TestSession = 'owner' | 'staff' | 'signedOut' | 'blocked' | 'real' | SessionStore

function storeFor(session: TestSession): SessionStore | undefined {
  switch (session) {
    case 'owner':
    case 'staff':
      return signedInStore({ role: session })
    case 'signedOut':
      return makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') } }).store
    case 'blocked':
      return makeStore({ refresh: async () => { throw apiError(403, 'vendor_not_allowed') } }).store
    case 'real':
      // The app's own store, which talks to the API: answer /v1/auth/* in `handlers`.
      return undefined
    default:
      return session
  }
}

export interface RenderPortalOptions {
  /** Where to start, for example `/products?status=live`. */
  route?: string
  session?: TestSession
  /** Window width in CSS pixels (see WIDTHS). */
  width?: number
  handlers?: RequestHandler[]
  routes?: RouteObject[]
}

/** Renders the whole app at `route`. */
export function renderPortal({ route = '/', session = 'owner', width = WIDTHS.desktop, handlers = [], routes = appRoutes }: RenderPortalOptions = {}) {
  setTestViewport(width)
  const requests = stubApi(handlers)
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(<App router={router} session={storeFor(session)} queryClient={queryClient} />)
  return { ...view, router, queryClient, requests, user: userEvent.setup() }
}
