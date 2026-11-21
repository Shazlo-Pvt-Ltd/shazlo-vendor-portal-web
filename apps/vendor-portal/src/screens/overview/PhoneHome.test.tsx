import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/client'
import { renderApp } from '../../test/render'
import { server } from '../../test/server'

type Me = Schemas['Me']

// Answers GET /vendor/me with a seller whose setup is in the given state.
function serveSetup(setup: Partial<Me['setup']>) {
  const me: Me = {
    vendor: {
      id: 'v_kalki',
      brand_name: 'Kalki Studio',
      status: 'approved',
      approved_at: '2026-10-14T10:00:00+05:30',
      commission_bps: 1200,
      commission: { state: 'agreed', agreed_bps: 1200, proposed_bps: null, note: null, updated_at: null },
    },
    user: { id: 'u_kiran', name: 'Kiran Shah', email: 'kiran@kalkistudio.in' },
    role: 'vendor_owner',
    setup: { password_set: true, brand_page: true, first_product: true, store_details: true, live_products: 18, live_target: 10, ...setup },
  }
  server.use(http.get('*/api/v1/vendor/me', () => HttpResponse.json(me)))
}

// The first render loads the Home chunk lazily; give it time on a busy machine.
const SLOW = { timeout: 5000 }
const region = (name: string) => screen.findByRole('region', { name }, SLOW)
// Load the lazily imported screens once up front, so the first test does not time out while
// the chunk is transformed.
beforeAll(async () => {
  await import('./Overview')
})

const yellowButtons = () => screen.getByRole('main').querySelectorAll('.MuiButton-contained')

describe('Home on phones: what to do next', () => {
  it('starts with store details while they are missing, with one yellow button', async () => {
    serveSetup({ store_details: false, brand_page: false })
    await renderApp({ viewport: 'mobile' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' }, SLOW)).toBeInTheDocument()
    const card = await region('What to do next')
    expect(await within(card).findByText('Finish your store details', {}, SLOW)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Finish store details' })).toHaveAttribute('href', '/store/details')
    expect(yellowButtons()).toHaveLength(1)
  })

  it('moves on to the brand page, then the first product', async () => {
    serveSetup({ brand_page: false, first_product: false })
    await renderApp({ viewport: 'mobile' })
    const card = await region('What to do next')
    expect(await within(card).findByRole('link', { name: 'Set up brand page' }, SLOW)).toHaveAttribute('href', '/brand')
  })

  it('offers Add product once setup is done, and drops the task list', async () => {
    serveSetup({})
    await renderApp({ viewport: 'mobile' })
    const card = await region('What to do next')
    expect(await within(card).findByText('Add a product', {}, SLOW)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Add product' })).toHaveAttribute('href', '/products/new')
    expect(screen.queryByRole('region', { name: 'Set up your shop' })).toBeNull()
    expect(yellowButtons()).toHaveLength(1)
  })
})

describe('Home on phones: setup tasks', () => {
  it('lists each task with a plain status word', async () => {
    serveSetup({ store_details: false })
    await renderApp({ viewport: 'mobile' })
    const tasks = await region('Set up your shop')
    expect(within(tasks).getByText('2 of 3 done')).toBeInTheDocument()
    expect(within(tasks).getByRole('link', { name: 'Store details To do' })).toHaveAttribute('href', '/store/details')
    expect(within(tasks).getByRole('link', { name: 'Brand page Done' })).toHaveAttribute('href', '/brand')
    expect(within(tasks).getByRole('link', { name: 'First product Done' })).toHaveAttribute('href', '/products/new')
  })

  it('shows no setup banner on phones: the task list does that job', async () => {
    serveSetup({ store_details: false })
    await renderApp({ viewport: 'mobile' })
    await region('Set up your shop')
    expect(screen.queryByRole('status', { name: /set up/ })).toBeNull()
  })
})

describe('Home on phones: needs changes', () => {
  it('lists sent-back items with the reason and a way to fix each', async () => {
    await renderApp({ viewport: 'mobile' })
    const changes = await region('Needs changes')
    const items = await within(changes).findAllByRole('listitem', {}, SLOW)
    expect(items).toHaveLength(2)
    const [ajrakh, jacket] = items as [HTMLElement, HTMLElement]
    expect(ajrakh).toHaveTextContent('Ajrakh Block-Print Kurta')
    expect(ajrakh).toHaveTextContent(/Back photo is missing/)
    expect(within(ajrakh).getByRole('link', { name: 'Fix this: Ajrakh Block-Print Kurta' })).toHaveAttribute('href', '/products/p_001')
    expect(within(jacket).getByRole('link', { name: 'Fix this: Kutch Mirror-Work Jacket' })).toHaveAttribute('href', '/products/p_002')
  })
})

describe('Home on phones: counts', () => {
  it('shows counts as quiet rows linking to Products by status', async () => {
    await renderApp({ viewport: 'mobile' })
    const counts = await region('Your products')
    expect(await within(counts).findByRole('link', { name: 'Live 18' }, SLOW)).toHaveAttribute('href', '/products?status=approved')
    expect(within(counts).getByRole('link', { name: 'In review 4' })).toHaveAttribute('href', '/products?status=pending_review')
    expect(within(counts).getByRole('link', { name: 'Drafts 3' })).toHaveAttribute('href', '/products?status=draft')
    // Rows, not the desktop figure tiles.
    expect(screen.queryByRole('group', { name: 'Live on Shazlo' })).toBeNull()
  })

  it('links to all review decisions', async () => {
    await renderApp({ viewport: 'mobile' })
    expect(await screen.findByRole('link', { name: 'See all review decisions' }, SLOW)).toHaveAttribute('href', '/review')
  })
})
