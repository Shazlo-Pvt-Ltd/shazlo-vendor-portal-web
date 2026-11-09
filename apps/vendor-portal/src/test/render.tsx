import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { createAppContext } from '../api/context'
import { App } from '../app/App'
import { routes } from '../app/routes'
import { DEMO_LOGIN } from '../mocks/db'
import { resetMockDb } from './server'

export type Viewport = 'desktop' | 'mobile'
const WIDTH: Record<Viewport, number> = { desktop: 1440, mobile: 390 }

// MUI's useMediaQuery reads matchMedia; answer min/max-width queries for the chosen width.
export function setViewport(viewport: Viewport) {
  const width = WIDTH[viewport]
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query)
    const max = /max-width:\s*([\d.]+)px/.exec(query)
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
    return { matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }
  }
}

export async function renderApp({ route = '/', signedIn = true, viewport = 'desktop', now }: { route?: string; signedIn?: boolean; viewport?: Viewport; now?: Date } = {}) {
  const db = resetMockDb(now ? { now: () => now } : undefined)
  setViewport(viewport)
  const context = createAppContext({ baseUrl: 'http://localhost' })
  if (signedIn) {
    const pair = await context.api.call((c) => c.POST('/api/v1/vendor/auth/login', { body: DEMO_LOGIN }))
    context.session.set(pair)
  }
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  const user = userEvent.setup()
  const view = render(<App context={context} router={router} />)
  return { ...view, user, db, router, context }
}
