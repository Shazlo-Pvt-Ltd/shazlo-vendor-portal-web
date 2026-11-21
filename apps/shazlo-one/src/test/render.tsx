import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { createAppContext } from '../api/context'
import { App } from '../app/App'
import { routes } from '../app/routes'
import { DEMO_ADMIN, INVITED_ADMIN } from '../mocks/identity'
import { resetMocks } from './server'

export const IDENTITY_URL = 'http://identity.test'
export const VENDOR_API_URL = 'http://vendor-api.test'

const ACCOUNTS = {
  naman: DEMO_ADMIN,
  priya: { email: 'priya@shazlo.store', password: DEMO_ADMIN.password },
  sneha: INVITED_ADMIN,
} as const

// Renders the whole shell on `route`. `as` signs in first (naman = super admin, priya = reviewer,
// sneha = invited with a temporary password); `as: null` starts signed out.
export async function renderShell({ route = '/', as = 'naman' }: { route?: string; as?: keyof typeof ACCOUNTS | null } = {}) {
  const { identityDb, vendorDb } = resetMocks()
  const context = createAppContext({ identityUrl: IDENTITY_URL, vendorApiUrl: VENDOR_API_URL })
  if (as) {
    const res = await context.identity.call((c) => c.POST('/v1/auth/login', { body: ACCOUNTS[as] }))
    context.session.adopt(res)
  } else {
    context.session.end()
  }
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  const user = userEvent.setup()
  const view = render(<App context={context} router={router} />)
  return { ...view, user, router, context, identityDb, vendorDb }
}
