import { screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { renderApp } from '../../test/render'
import { setupMockApi } from '../../test/server'
import { addNewSeller, completeStoreDetails, kalkiOf, NEW_SELLER, unpublishBrandPage } from './testing'

// Setup comes from vendor-api as it is: store details complete or not, a brand page approved or
// not, products or none. The demo seller has everything but a payout, so store details are the to-do.
const { db } = setupMockApi()

// The first render loads the Home chunk lazily; give it time on a busy machine.
const SLOW = { timeout: 5000 }
const region = (name: string) => screen.findByRole('region', { name }, SLOW)
const bySku = (sku: string) => db().products.find((p) => p.sku === sku)!
// Load the lazily imported screens once up front, so the first test does not time out while
// the chunk is transformed.
beforeAll(async () => {
  await import('./Overview')
})

const yellowButtons = () => screen.getByRole('main').querySelectorAll('.MuiButton-contained')

function removeProducts() {
  const kalki = kalkiOf(db()).id
  db().products = db().products.filter((p) => p.vendor_id !== kalki)
  db().submissions = db().submissions.filter((s) => s.vendor_id !== kalki || s.subject !== 'product')
}

describe('Home on phones: what to do next', () => {
  it('starts with store details while they are missing, with one yellow button', async () => {
    unpublishBrandPage(db())
    await renderApp({ viewport: 'mobile' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' }, SLOW)).toBeInTheDocument()
    const card = await region('What to do next')
    expect(await within(card).findByText('Finish your store details', {}, SLOW)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Finish store details' })).toHaveAttribute('href', '/store/details')
    expect(yellowButtons()).toHaveLength(1)
  })

  it('moves on to the brand page, then the first product', async () => {
    completeStoreDetails(db())
    unpublishBrandPage(db())
    removeProducts()
    await renderApp({ viewport: 'mobile' })
    const card = await region('What to do next')
    expect(await within(card).findByRole('link', { name: 'Set up brand page' }, SLOW)).toHaveAttribute('href', '/brand')
  })

  it('asks for the first product once the brand page is live', async () => {
    completeStoreDetails(db())
    removeProducts()
    await renderApp({ viewport: 'mobile' })
    const card = await region('What to do next')
    expect(await within(card).findByText('Add your first product', {}, SLOW)).toBeInTheDocument()
  })

  it('offers Add product once setup is done, and drops the task list', async () => {
    completeStoreDetails(db())
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
    await renderApp({ viewport: 'mobile' })
    const tasks = await region('Set up your shop')
    expect(await within(tasks).findByText('2 of 3 done')).toBeInTheDocument()
    expect(within(tasks).getByRole('link', { name: 'Store details To do' })).toHaveAttribute('href', '/store/details')
    expect(within(tasks).getByRole('link', { name: 'Brand page Done' })).toHaveAttribute('href', '/brand')
    expect(within(tasks).getByRole('link', { name: 'First product Done' })).toHaveAttribute('href', '/products/new')
  })

  it('shows no setup banner on phones: the task list does that job', async () => {
    await renderApp({ viewport: 'mobile' })
    await region('Set up your shop')
    expect(screen.queryByText(/of 3 set up/)).toBeNull()
  })
})

describe('Home on phones: needs your changes', () => {
  it('lists sent-back items with the reason and a way to fix each', async () => {
    await renderApp({ viewport: 'mobile' })
    const changes = await region('Needs your changes')
    const items = await within(changes).findAllByRole('listitem', {}, SLOW)
    expect(items).toHaveLength(2)
    const [ajrakh, jacket] = items as [HTMLElement, HTMLElement]
    expect(ajrakh).toHaveTextContent('Ajrakh Block-Print Kurta')
    expect(ajrakh).toHaveTextContent(/Back photo is missing/)
    expect(within(ajrakh).getByRole('link', { name: 'Fix this: Ajrakh Block-Print Kurta' })).toHaveAttribute('href', `/products/${bySku('KS-AJR-014').id}`)
    expect(within(jacket).getByRole('link', { name: 'Fix this: Kutch Mirror-Work Jacket' })).toHaveAttribute('href', `/products/${bySku('KS-KMJ-007').id}`)
  })

  it('leaves out a sent-back item that was already sent again', async () => {
    const ajrakh = bySku('KS-AJR-014')
    const old = db().submissions.find((s) => s.product_id === ajrakh.id)!
    db().submissions.push({ ...old, id: `${old.id}-again`, version: 2, status: 'pending', reason: null, decided_at: null, submitted_at: new Date().toISOString() })
    await renderApp({ viewport: 'mobile' })
    const changes = await region('Needs your changes')
    const items = await within(changes).findAllByRole('listitem', {}, SLOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Kutch Mirror-Work Jacket')
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

describe('Home on phones: a brand-new seller', () => {
  it('shows zeros and the first steps, never an error', async () => {
    addNewSeller(db())
    await renderApp({ viewport: 'mobile', credentials: NEW_SELLER })
    const card = await region('What to do next')
    expect(await within(card).findByText('Finish your store details', {}, SLOW)).toBeInTheDocument()
    const tasks = await region('Set up your shop')
    expect(await within(tasks).findByText('0 of 3 done')).toBeInTheDocument()
    const counts = await region('Your products')
    expect(await within(counts).findByRole('link', { name: 'Live 0' })).toBeInTheDocument()
    expect(within(counts).getByRole('link', { name: 'Drafts 0' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading what needs your changes' })).toBeNull())
    expect(screen.queryByRole('region', { name: 'Needs your changes' })).toBeNull()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(screen.queryByText(/did not load/)).toBeNull()
    expect(yellowButtons()).toHaveLength(1)
  })
})
