import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { App } from '../App'
import { getApiClient } from '../api/instance'
import { routes } from '../app/routes'
import { DEMO_LOGIN } from '../mocks/db'
import { mockDb, resetMockDb } from './server'
import { setViewport as setWidth } from './viewport'

// Named widths, or a number of CSS pixels (the shell switches at 600 and 1024, src/shell/layout.ts).
export type Viewport = 'desktop' | 'tablet' | 'mobile' | number
const WIDTH: Record<Exclude<Viewport, number>, number> = { desktop: 1440, tablet: 768, mobile: 390 }

export function setViewport(viewport: Viewport): void {
  setWidth(typeof viewport === 'number' ? viewport : WIDTH[viewport])
}

export interface RenderAppOptions {
  route?: string
  /** Signs in first (the mock sets its emulated refresh cookie), so the app's session restores itself. */
  signedIn?: boolean
  credentials?: { email: string; password: string }
  viewport?: Viewport
  /** The mock database's clock, for a fresh seed. */
  now?: Date
}

/**
 * The whole app (environment check, providers, main's session, routes, guards, shell) against the
 * mock vendor-api. Call `setupMockApi()` in the test file first. The app's own session store
 * restores the session from the refresh cookie, exactly as after a page load.
 */
export async function renderApp({ route = '/', signedIn = true, credentials = DEMO_LOGIN, viewport = 'desktop', now }: RenderAppOptions = {}) {
  const db = now ? resetMockDb({ now: () => now }) : mockDb
  setViewport(viewport)
  if (signedIn) await getApiClient().POST('/v1/auth/login', { body: credentials })
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const user = userEvent.setup()
  const view = render(<App router={router} queryClient={queryClient} />)
  return { ...view, user, db, router, queryClient }
}
