import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/client'
import { renderApp } from '../../test/render'
import { server } from '../../test/server'

type Me = Schemas['Me']

// The first render loads the page chunk lazily; give it time on a busy machine.
const SLOW = { timeout: 5000 }

// Load the lazily imported screens once up front, so the first test does not time out while
// the chunk is transformed.
beforeAll(async () => {
  await Promise.all([import('./StoreHub'), import('./AccountHub'), import('../misc/Misc')])
})

// Answers GET /vendor/me with a seller in the given state.
function serveMe({ setup = {}, commission = {}, role = 'vendor_owner' }: { setup?: Partial<Me['setup']>; commission?: Partial<Schemas['Commission']>; role?: Me['role'] } = {}) {
  const me: Me = {
    vendor: {
      id: 'v_kalki',
      brand_name: 'Kalki Studio',
      status: 'approved',
      approved_at: '2026-10-14T10:00:00+05:30',
      commission_bps: commission.agreed_bps ?? null,
      commission: { state: 'not_set', agreed_bps: null, proposed_bps: null, note: null, updated_at: null, ...commission },
    },
    user: { id: 'u_kiran', name: 'Kiran Shah', email: 'kiran@kalkistudio.in' },
    role,
    setup: { password_set: true, brand_page: true, first_product: true, store_details: true, live_products: 18, live_target: 10, ...setup },
  }
  server.use(http.get('*/api/v1/vendor/me', () => HttpResponse.json(me)))
}

describe('Store page (the phone Store tab)', () => {
  it('lists Brand page, Store details and Commission', async () => {
    serveMe({ commission: { state: 'agreed', agreed_bps: 1200 } })
    await renderApp({ route: '/store', viewport: 'mobile' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Store' }, SLOW)).toBeInTheDocument()
    const list = screen.getByRole('navigation', { name: 'Store pages' })
    expect(within(list).getByRole('link', { name: /^Brand page/ })).toHaveAttribute('href', '/brand')
    expect(within(list).getByRole('link', { name: /^Store details/ })).toHaveAttribute('href', '/store/details')
    const commission = within(list).getByRole('link', { name: /^Commission/ })
    expect(commission).toHaveAttribute('href', '/store/details#commission')
    expect(await within(commission).findByText('12% of each sale')).toBeInTheDocument()
    expect(within(list).queryByText('To do')).toBeNull()
  })

  it('says "To do" on what is missing and how the commission stands', async () => {
    serveMe({ setup: { store_details: false, brand_page: false }, commission: { state: 'proposed', proposed_bps: 1050 } })
    await renderApp({ route: '/store', viewport: 'mobile' })
    const list = await screen.findByRole('navigation', { name: 'Store pages' }, SLOW)
    await waitFor(() => expect(within(list).getAllByText('To do')).toHaveLength(2))
    expect(within(list).getByRole('link', { name: /^Brand page.*To do/ })).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: /^Store details.*To do/ })).toBeInTheDocument()
    expect(within(list).getByText('You proposed 10.5%. Waiting for Shazlo.')).toBeInTheDocument()
  })

  it('never shows a default rate', async () => {
    serveMe()
    await renderApp({ route: '/store', viewport: 'mobile' })
    const list = await screen.findByRole('navigation', { name: 'Store pages' }, SLOW)
    expect(await within(list).findByText('Not agreed yet')).toBeInTheDocument()
    expect(within(list).queryByText(/%/)).toBeNull()
  })

  it('has no yellow button: it is a page of places', async () => {
    serveMe()
    await renderApp({ route: '/store', viewport: 'mobile' })
    await screen.findByRole('navigation', { name: 'Store pages' }, SLOW)
    expect(screen.getByRole('main').querySelectorAll('.MuiButton-contained')).toHaveLength(0)
  })
})

describe('Account page (the phone Account tab)', () => {
  it('lists Team and Help & support and names the person', async () => {
    serveMe()
    await renderApp({ route: '/account', viewport: 'mobile' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Account' }, SLOW)).toBeInTheDocument()
    expect(await screen.findByText('Kiran Shah · Owner')).toBeInTheDocument()
    const list = screen.getByRole('navigation', { name: 'Account pages' })
    expect(within(list).getByRole('link', { name: /^Team/ })).toHaveAttribute('href', '/team')
    expect(within(list).getByRole('link', { name: /^Help & support/ })).toHaveAttribute('href', '/help')
  })

  it('signs out', async () => {
    const { user, router } = await renderApp({ route: '/account', viewport: 'mobile' })
    const list = await screen.findByRole('navigation', { name: 'Account pages' }, SLOW)
    await user.click(within(list).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
  })

  it('leads back to Account from Team on phones', async () => {
    await renderApp({ route: '/team', viewport: 'mobile' })
    expect(await within(screen.getByRole('banner')).findByRole('link', { name: 'Back to Account' }, SLOW)).toHaveAttribute('href', '/account')
  })
})
