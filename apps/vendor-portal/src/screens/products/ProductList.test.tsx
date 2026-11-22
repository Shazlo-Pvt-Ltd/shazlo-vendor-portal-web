import { configure, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import { DEMO_STAFF, type MockDb } from '../../mocks/db'
import { renderApp } from '../../test/render'
import { setupMockApi } from '../../test/server'

// V-06 Products against the mock vendor-api (src/mocks): main's client, main's session, the real
// routes and guards. Kalki Studio's 27 products: 18 live, 4 in review, 2 sent back, 3 drafts.

// The first test also loads the screen's chunk, and refetches re-render the full MUI table:
// give async queries more than the default second on slow machines.
configure({ asyncUtilTimeout: 8000, defaultHidden: true })

// jsdom's object URLs (src/test/setup.ts) have no origin, so SafeImage refuses them; a browser's
// look like blob:http://localhost/…. Set before the mock database makes its demo photos.
vi.hoisted(() => {
  let n = 0
  URL.createObjectURL = () => `blob:http://localhost/${(n += 1)}`
})

const { server, db: mockDb } = setupMockApi()

type User = Awaited<ReturnType<typeof renderApp>>['user']
type Router = Awaited<ReturnType<typeof renderApp>>['router']

const LIST = '*/v1/vendor/products'

const bySku = (db: MockDb, sku: string) => db.products.find((p) => p.sku === sku)!
const kalki = (db: MockDb) => db.vendors.find((v) => v.name === 'Kalki Studio')!.id
/** Kalki's store details are complete but for payouts; this adds one, so products can be sent. */
function completeStore(db: MockDb) {
  db.stores.get(kalki(db))!.payout = { method: 'upi', upi_id: 'kalki@okhdfcbank' }
}
/** The sent-back jacket, edited since (as vendor-api has it then): a complete draft that can be sent. */
function reworkJacket(db: MockDb) {
  const jacket = bySku(db, 'KS-KMJ-007')
  jacket.working!.state = 'editing'
  jacket.working!.version = 2
  jacket.status = 'draft'
}

async function productTable() {
  return screen.findByRole('table', { name: 'Products' })
}

// Data rows only (the first row holds the column headers).
function rows(table: HTMLElement) {
  return within(table).getAllByRole('row').slice(1)
}

function titles(table: HTMLElement) {
  return rows(table).map((r) => within(r).getAllByRole('link')[0]!.textContent)
}

async function waitForRows(count: number) {
  const table = await productTable()
  await waitFor(() => {
    expect(table).not.toHaveAttribute('aria-busy', 'true')
    expect(rows(table)).toHaveLength(count)
  })
  return table
}

function row(table: HTMLElement, title: string) {
  const link = within(table).getByRole('link', { name: title })
  return link.closest('tr')!
}

function params(router: Router) {
  return new URLSearchParams(router.state.location.search)
}

async function choose(user: User, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

async function menuOf(user: User, table: HTMLElement, title: string) {
  await user.click(within(table).getByRole('button', { name: `Actions for ${title}` }))
  const menu = await screen.findByRole('menu')
  return { menu, items: within(menu).getAllByRole('menuitem').map((m) => m.textContent) }
}

// Every request the screen makes, so tests can check what was asked for.
function trackRequests() {
  const seen: { method: string; url: URL }[] = []
  const listener = ({ request }: { request: Request }) => {
    seen.push({ method: request.method, url: new URL(request.url) })
  }
  server.events.on('request:start', listener)
  onTestFinished(() => {
    server.events.removeListener('request:start', listener)
  })
  return {
    /** List pages (not the `limit=1` counts). */
    lists: () => seen.filter((r) => r.method === 'GET' && r.url.pathname === '/v1/vendor/products' && r.url.searchParams.get('limit') !== '1').map((r) => r.url.searchParams),
    submits: () => seen.filter((r) => r.method === 'POST' && r.url.pathname.endsWith('/submit')),
    deletes: () => seen.filter((r) => r.method === 'DELETE'),
  }
}

// The table re-renders the full MUI tree on every refetch; slow machines need more than 15 s a test.
const SLOW = { timeout: 45_000 }

describe('V-06 Products', SLOW, () => {
  beforeAll(async () => {
    await import('./ProductList')
  }, 120_000)

  it('shows the catalogue with status counts and the first ten products', async () => {
    await renderApp({ route: '/products' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument()
    expect(await screen.findByText('27 products · 18 live in the app')).toBeInTheDocument()

    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: 'Bulk import' })).toHaveAttribute('href', '/products/import')
    // One main (contained) button: Add product.
    expect(within(main).getByRole('link', { name: 'Add product' })).toHaveAttribute('href', '/products/new')
    expect(within(main).getByRole('link', { name: 'Add product' })).toHaveClass('MuiButton-contained')
    expect(within(main).getByRole('link', { name: 'Bulk import' })).toHaveClass('MuiButton-outlined')
    expect(within(main).queryByText('Easier on a laptop')).toBeNull()

    const tabs = screen.getByRole('tablist', { name: 'Product status' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['All 27', 'Live 18', 'In review 4', 'Needs changes 2', 'Drafts 3', 'Archived 0'])
    expect(within(tabs).getByRole('tab', { name: 'All 27' })).toHaveAttribute('aria-selected', 'true')

    const table = await waitForRows(10)
    for (const name of ['Product', 'Product type', 'Price', 'Stock', 'Status', 'Updated']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument()
    }
    expect(within(table).getByRole('checkbox', { name: 'Select all on this page' })).toBeInTheDocument()
    expect(titles(table)[0]).toBe('Ajrakh Block-Print Kurta')

    const ajrakh = row(table, 'Ajrakh Block-Print Kurta')
    expect(within(ajrakh).getByText('KS-AJR-014')).toBeInTheDocument()
    // The main colour, with its swatch.
    expect(within(ajrakh).getByText('Indigo')).toBeInTheDocument()
    expect(ajrakh.querySelector('[data-swatch="named"]')).not.toBeNull()
    expect(within(ajrakh).getByText('Kurtas')).toBeInTheDocument()
    expect(within(ajrakh).getByText('₹2,499')).toBeInTheDocument()
    expect(within(ajrakh).getByText('MRP ₹2,999')).toBeInTheDocument()
    expect(within(ajrakh).getByText('28')).toBeInTheDocument()
    expect(within(ajrakh).getByText('Needs changes')).toBeInTheDocument()
    expect(within(ajrakh).getByRole('button', { name: 'Actions for Ajrakh Block-Print Kurta' })).toBeInTheDocument()

    // A live product with an edit waiting says both, in words; the list shows the version in review.
    const shirt = row(table, 'Handloom Cotton Shirt — Rust')
    expect(within(shirt).getByText('Live · Changes in review')).toBeInTheDocument()
    // Calm: status is plain text, and the word SKU never shows.
    expect(table.querySelector('.MuiChip-root, [data-status="live"] svg')).toBeNull()
    expect(main).not.toHaveTextContent(/SKU/)

    // The photo is the seller's: it goes through SafeImage (no referrer, lazy).
    expect(ajrakh.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer')

    expect(screen.getByText('Showing 1–10 of 27')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('shows a dash, not a zero, for a product without a price or sizes', async () => {
    const { user } = await renderApp({ route: '/products?status=draft' })
    const table = await waitForRows(3)
    const stole = row(table, 'Maheshwari Silk Stole')
    expect(within(stole).getAllByText('—')).toHaveLength(2)
    // A shade picked in the editor: its hex code, drawn as itself.
    expect(within(stole).getByText('#6A4C93')).toBeInTheDocument()
    expect(stole.querySelector('[data-swatch="hex"]')).toHaveStyle({ background: 'rgb(106, 76, 147)' })
    // No colour yet: no swatch.
    const overshirt = row(table, 'Kala Cotton Overshirt')
    expect(overshirt.querySelector('[data-swatch]')).toBeNull()
    expect(within(stole).getByText('Draft')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Needs changes 2' }))
    const sentBack = await waitForRows(2)
    // Price equal to MRP: no MRP line.
    expect(within(row(sentBack, 'Kutch Mirror-Work Jacket')).queryByText(/^MRP/)).toBeNull()
  })

  it('switches status tabs through the URL, so back and reload keep them', async () => {
    const { user, router } = await renderApp({ route: '/products' })
    await waitForRows(10)
    await user.click(screen.getByRole('tab', { name: 'Drafts 3' }))
    expect(params(router).get('status')).toBe('draft')
    const table = await waitForRows(3)
    expect(titles(table)).toEqual(['Indigo Dabu Co-ord', 'Maheshwari Silk Stole', 'Kala Cotton Overshirt'])
    expect(screen.getByRole('tab', { name: 'Drafts 3' })).toHaveAttribute('aria-selected', 'true')
    for (const r of rows(table)) expect(r).toHaveTextContent('Draft')

    await router.navigate(-1)
    await waitForRows(10)
    expect(screen.getByRole('tab', { name: 'All 27' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: 'Archived 0' }))
    expect(await screen.findByRole('heading', { name: 'Nothing archived' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all products' }))
    await waitForRows(10)
    expect(params(router).get('status')).toBeNull()
  })

  it('opens on the tab and page in the link', async () => {
    await renderApp({ route: '/products?status=rejected' })
    const table = await waitForRows(2)
    expect(titles(table)).toEqual(['Ajrakh Block-Print Kurta', 'Kutch Mirror-Work Jacket'])
    expect(screen.getByRole('tab', { name: 'Needs changes 2' })).toHaveAttribute('aria-selected', 'true')
  })

  it('reads a hand-edited link without breaking, and keeps nothing it does not know', async () => {
    const { router } = await renderApp({ route: `/products?status=bogus&category=spacesuits&gender=kids&page=abc&q=${'x'.repeat(300)}` })
    expect(await screen.findByRole('heading', { name: 'No products match these filters' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'All 27' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: 'Search name or code' })).toHaveValue('x'.repeat(100))
    expect(screen.getByRole('combobox', { name: 'Product type' })).toHaveTextContent('All')
    expect(router.state.location.pathname).toBe('/products')
  })

  it('goes to the last page there is when a link names one past the end', async () => {
    const { router } = await renderApp({ route: '/products?page=9' })
    expect(await screen.findByText('Showing 21–27 of 27')).toBeInTheDocument()
    await waitForRows(7)
    expect(params(router).get('page')).toBe('3')
  })

  it('searches name or code once typing pauses', async () => {
    const seen = trackRequests()
    const { user, router } = await renderApp({ route: '/products' })
    await waitForRows(10)
    const search = screen.getByRole('textbox', { name: 'Search name or code' })
    await user.type(search, 'ajrakh')
    expect(params(router).get('q')).toBeNull()
    await waitFor(() => expect(params(router).get('q')).toBe('ajrakh'))
    let table = await waitForRows(2)
    expect(titles(table)).toEqual(['Ajrakh Block-Print Kurta', 'Ajrakh Mul Dupatta'])
    // One request for the finished word, none for "a", "aj", "ajr"…
    expect(seen.lists().map((p) => p.get('q')).filter(Boolean)).toEqual(['ajrakh'])

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveValue('')
    await waitForRows(10)
    expect(params(router).get('q')).toBeNull()

    await user.type(search, 'KS-DAB')
    table = await waitForRows(3)
    expect(titles(table)).toEqual(['Dabu Print Wrap Skirt', 'Indigo Dabu Co-ord', 'Dabu Print Kurti'])
  })

  it('combines filters, and offers to clear them when nothing matches', async () => {
    const { user, router } = await renderApp({ route: '/products' })
    await waitForRows(10)
    await choose(user, 'Product type', 'Jackets')
    expect(params(router).get('category')).toBe('Jackets')
    let table = await waitForRows(3)
    expect(titles(table)).toEqual(['Kutch Mirror-Work Jacket', 'Kantha Stitch Jacket', 'Khadi Nehru Jacket'])

    await choose(user, 'Gender', 'Men')
    expect(await screen.findByRole('heading', { name: 'No products match these filters' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitForRows(10)
    expect(params(router).get('category')).toBeNull()
    expect(params(router).get('gender')).toBeNull()

    await choose(user, 'Stock', 'Low (1–5)')
    table = await waitForRows(2)
    expect(titles(table)).toEqual(['Kalamkari Cotton Saree', 'Jamdani Cotton Saree'])
    await choose(user, 'Stock', 'Out of stock')
    table = await waitForRows(1)
    expect(titles(table)).toEqual(['Chikankari Kurti — Ivory'])
    expect(params(router).get('stock')).toBe('out')
  })

  it('sorts by price', async () => {
    const { user, router } = await renderApp({ route: '/products' })
    await waitForRows(10)
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('Sort: Recently updated')
    await choose(user, 'Sort', 'Price: low to high')
    expect(params(router).get('sort')).toBe('price_asc')
    // A row shows the version being changed: the live shirt's new price in review (₹1,199) ties
    // with the tunic, and is the newer of the two.
    await waitFor(() => expect(titles(screen.getByRole('table', { name: 'Products' })).slice(0, 3)).toEqual(['Shibori Indigo Scarf', 'Leheriya Cotton Dupatta', 'Handloom Cotton Shirt — Rust']))
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('Sort: Price: low to high')
  })

  it('pages through the catalogue ten at a time', async () => {
    const { user, router } = await renderApp({ route: '/products' })
    await waitForRows(10)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(params(router).get('page')).toBe('2')
    expect(await screen.findByText('Showing 11–20 of 27')).toBeInTheDocument()
    await waitForRows(10)

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 21–27 of 27')).toBeInTheDocument()
    await waitForRows(7)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Showing 11–20 of 27')).toBeInTheDocument()

    // Changing a filter starts again from the first page.
    await user.click(screen.getByRole('tab', { name: 'Live 18' }))
    expect(params(router).get('page')).toBeNull()
    expect(await screen.findByText('Showing 1–10 of 18')).toBeInTheDocument()
  })

  it('opens a product from its row', async () => {
    const { user, router, db } = await renderApp({ route: '/products' })
    const table = await waitForRows(10)
    await user.click(within(row(table, 'Bandhani Silk Dupatta')).getByText('Dupattas'))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/products/${bySku(db, 'KS-BDN-022').id}`))
  })

  it('offers only what applies to each product in its row menu', async () => {
    const { user, router, db } = await renderApp({ route: '/products' })
    const table = await waitForRows(10)
    // Live: edit or archive. Sent back: fix it first (vendor-api refuses it unchanged), or archive.
    // Draft: send or delete.
    expect((await menuOf(user, table, 'Bandhani Silk Dupatta')).items).toEqual(['Edit', 'Archive'])
    await user.keyboard('{Escape}')
    expect((await menuOf(user, table, 'Ajrakh Block-Print Kurta')).items).toEqual(['Edit', 'Archive'])
    await user.keyboard('{Escape}')
    expect((await menuOf(user, table, 'Indigo Dabu Co-ord')).items).toEqual(['Edit', 'Send for review', 'Delete'])
    await user.keyboard('{Escape}')
    // In review, or live with changes in review: vendor-api refuses both, so neither is offered.
    expect((await menuOf(user, table, 'Pochampally Ikat Kurta')).items).toEqual(['Edit'])
    await user.keyboard('{Escape}')
    expect((await menuOf(user, table, 'Handloom Cotton Shirt — Rust')).items).toEqual(['Edit'])
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/products/${bySku(db, 'KS-HCS-003').id}`))
  })

  it('sends one product from its row menu, with the result in the page', async () => {
    const { user, db } = await renderApp({ route: '/products' })
    let table = await waitForRows(10)

    // A draft without its try-on photos comes back with what to fix.
    await menuOf(user, table, 'Indigo Dabu Co-ord')
    await user.click(screen.getByRole('menuitem', { name: 'Send for review' }))
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('Indigo Dabu Co-ord could not be sent for review')
    expect(banner).toHaveTextContent('Indigo Dabu Co-ord: Add 5 more try-on photos. We need 5 photos of real people wearing it.')
    expect(bySku(db, 'KS-DAB-042').status).toBe('draft')

    // With the store details finished, a complete product goes.
    completeStore(db)
    reworkJacket(db)
    await user.click(screen.getByRole('tab', { name: /^Drafts/ }))
    table = await waitForRows(4)
    await menuOf(user, table, 'Kutch Mirror-Work Jacket')
    await user.click(screen.getByRole('menuitem', { name: 'Send for review' }))
    expect(await screen.findByText('1 product sent for review')).toBeInTheDocument()
    expect(screen.getByText('1 product sent for review').closest('[role="status"]')).toBeInTheDocument()
    expect(bySku(db, 'KS-KMJ-007').status).toBe('pending_review')
    expect(await screen.findByRole('tab', { name: 'In review 5' })).toBeInTheDocument()
  })

  it('deletes a draft that was never sent for good, after saying so', async () => {
    const { user, db } = await renderApp({ route: '/products?status=draft' })
    const table = await waitForRows(3)
    await menuOf(user, table, 'Indigo Dabu Co-ord')
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete Indigo Dabu Co-ord?' })
    expect(dialog).toHaveTextContent('It has never been sent for review, so it will be deleted for good. This cannot be undone.')
    await user.click(within(dialog).getByRole('button', { name: 'Delete product' }))
    expect(await screen.findByText('Indigo Dabu Co-ord was deleted.')).toBeInTheDocument()
    expect(db.products.some((p) => p.sku === 'KS-DAB-042')).toBe(false)
    await waitForRows(2)
    expect(screen.getByRole('tab', { name: 'Drafts 2' })).toBeInTheDocument()
  })

  it('archives a live product, not deletes it, after saying it leaves the app', async () => {
    const { user, db } = await renderApp({ route: '/products' })
    const table = await waitForRows(10)
    await menuOf(user, table, 'Bandhani Silk Dupatta')
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive Bandhani Silk Dupatta?' })
    expect(dialog).toHaveTextContent('archived, not deleted: it leaves the app straight away and moves to Archived.')
    expect(dialog).not.toHaveTextContent(/restore/i)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bySku(db, 'KS-BDN-022').status).toBe('approved')

    await menuOf(user, await productTable(), 'Bandhani Silk Dupatta')
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive product' }))
    expect(await screen.findByText('Bandhani Silk Dupatta was archived. Find it under Archived.')).toBeInTheDocument()
    expect(bySku(db, 'KS-BDN-022').status).toBe('archived')
    expect(await screen.findByRole('tab', { name: 'Archived 1' })).toBeInTheDocument()
  })

  it('sends a selection for review and lists the products that could not go', async () => {
    const { user, db } = await renderApp({ route: '/products?status=draft' })
    const table = await waitForRows(3)
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull()
    await user.click(within(table).getByRole('checkbox', { name: 'Select all on this page' }))
    const bar = screen.getByRole('region', { name: 'Bulk actions' })
    expect(bar).toHaveTextContent('3 selected')
    for (const r of rows(table)) expect(within(r).getByRole('checkbox')).toBeChecked()

    await user.click(within(bar).getByRole('button', { name: 'Send for review' }))
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('3 products could not be sent for review')
    expect(within(banner).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Indigo Dabu Co-ord: Add 5 more try-on photos. We need 5 photos of real people wearing it.',
      'Maheshwari Silk Stole: Add a description.',
      'Kala Cotton Overshirt: Choose who it is for: women, men or unisex.',
    ])
    expect(screen.queryByText(/^\d+ products? sent for review$/)).toBeNull()
    expect(db.products.filter((p) => p.status === 'draft')).toHaveLength(3)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull())
  })

  it('says plainly when only some of a selection went', async () => {
    completeStore(mockDb())
    reworkJacket(mockDb())
    const { user, db } = await renderApp({ route: '/products?status=draft' })
    const table = await waitForRows(4)
    await user.click(within(table).getByRole('checkbox', { name: 'Select all on this page' }))
    await user.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'Send for review' }))
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('1 of 4 sent for review')
    expect(within(banner).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Indigo Dabu Co-ord: Add 5 more try-on photos. We need 5 photos of real people wearing it.',
      'Maheshwari Silk Stole: Add a description.',
      'Kala Cotton Overshirt: Choose who it is for: women, men or unisex.',
    ])
    expect(bySku(db, 'KS-KMJ-007').status).toBe('pending_review')
  })

  it('says why a sent-back product cannot go again unchanged', async () => {
    const { user } = await renderApp({ route: '/products?status=rejected' })
    const table = await waitForRows(2)
    await user.click(within(table).getByRole('checkbox', { name: 'Select Kutch Mirror-Work Jacket' }))
    await user.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'Send for review' }))
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('Kutch Mirror-Work Jacket could not be sent for review')
    expect(banner).toHaveTextContent('Kutch Mirror-Work Jacket: Nothing has changed since it was sent back. Fix what our team asked for, then send it again.')
  })

  it('asks before archiving a selection, says what happens to each kind, and skips what is in review', async () => {
    const { user, db } = await renderApp({ route: '/products' })
    const table = await waitForRows(10)
    await user.click(within(table).getByRole('checkbox', { name: 'Select Ajrakh Block-Print Kurta' }))
    await user.click(within(table).getByRole('checkbox', { name: 'Select Pochampally Ikat Kurta' }))
    await user.click(within(table).getByRole('checkbox', { name: 'Select Bandhani Silk Dupatta' }))
    const bar = screen.getByRole('region', { name: 'Bulk actions' })
    expect(bar).toHaveTextContent('3 selected')
    expect(within(table).getByRole('checkbox', { name: 'Select all on this page' })).toHaveAttribute('data-indeterminate', 'true')

    await user.click(within(bar).getByRole('button', { name: 'Archive' }))
    let dialog = await screen.findByRole('dialog', { name: 'Archive 3 products?' })
    expect(dialog).toHaveTextContent('Products sent for review before are archived, not deleted, and move to Archived. Live ones leave the app straight away.')
    expect(dialog).toHaveTextContent('1 product is in review and will be skipped until our team decides.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(db.products.filter((p) => p.status === 'archived')).toHaveLength(0)

    await user.click(within(bar).getByRole('button', { name: 'Archive' }))
    dialog = await screen.findByRole('dialog', { name: 'Archive 3 products?' })
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('2 of 3 archived')
    expect(within(banner).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Pochampally Ikat Kurta: It is in review. Wait for our decision.'])
    expect(db.products.filter((p) => p.status === 'archived').map((p) => p.sku).sort()).toEqual(['KS-AJR-014', 'KS-BDN-022'])
    expect(await screen.findByRole('tab', { name: 'Archived 2' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'All 25' })).toBeInTheDocument()
  })

  it('sends each product once, however fast the button is pressed', async () => {
    const seen = trackRequests()
    const { user } = await renderApp({ route: '/products?status=draft' })
    const table = await waitForRows(3)
    await user.click(within(table).getByRole('checkbox', { name: 'Select all on this page' }))
    await user.dblClick(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'Send for review' }))
    await screen.findByRole('alert')
    expect(seen.submits()).toHaveLength(3)
  })

  it('clears the selection on request', async () => {
    const { user } = await renderApp({ route: '/products' })
    const table = await waitForRows(10)
    await user.click(within(table).getByRole('checkbox', { name: 'Select all on this page' }))
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('10 selected')
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull()
    expect(within(table).getByRole('checkbox', { name: 'Select all on this page' })).not.toBeChecked()
  })

  it('keeps the current rows on screen while the next ones load', async () => {
    const { user } = await renderApp({ route: '/products' })
    await waitForRows(10)
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // Holds the request, then falls through to the mock API.
    server.use(http.get(LIST, async () => {
      await gate
    }))
    await user.click(screen.getByRole('tab', { name: 'Live 18' }))
    expect(await screen.findByRole('progressbar', { name: 'Updating products' })).toBeInTheDocument()
    expect(rows(screen.getByRole('table', { name: 'Products' }))).toHaveLength(10)
    release()
    await waitFor(() => expect(screen.queryByRole('progressbar', { name: 'Updating products' })).toBeNull())
    expect(screen.getByText('Showing 1–10 of 18')).toBeInTheDocument()
  })

  it('shows skeleton rows while the first page loads', async () => {
    server.use(http.get(LIST, async () => {
      await new Promise(() => {})
    }))
    await renderApp({ route: '/products' })
    const table = await productTable()
    expect(table).toHaveAttribute('aria-busy', 'true')
    expect(rows(table).length).toBeGreaterThan(0)
    expect(within(table).queryAllByRole('link')).toHaveLength(0)
  })

  it('says when the list did not load and tries again', async () => {
    mockDb().faults.push({ path: '/v1/vendor/products', method: 'GET', status: 429, code: 'rate_limited', message: 'Too many attempts. Wait a minute and try again.' })
    const { user } = await renderApp({ route: '/products' })
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('We could not load your products')
    expect(banner).toHaveTextContent('Too many attempts. Wait a minute and try again.')
    await user.click(within(banner).getByRole('button', { name: 'Try again' }))
    await waitForRows(10)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says so when the connection drops', async () => {
    mockDb().faults.push({ path: '/v1/vendor/products', method: 'GET', network: true })
    await renderApp({ route: '/products' })
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('We could not load your products')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('welcomes a seller with an empty catalogue', async () => {
    mockDb().products.splice(0)
    await renderApp({ route: '/products' })
    expect(await screen.findByRole('heading', { name: 'No products yet' })).toBeInTheDocument()
    expect(screen.getByText('Start with your best seller')).toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: 'Add product' })).toHaveAttribute('href', '/products/new')
    expect(within(main).getByRole('link', { name: 'Bulk import' })).toHaveAttribute('href', '/products/import')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Search name or code' })).toBeNull()
  })

  it('works the same for staff', async () => {
    const { user } = await renderApp({ route: '/products?status=draft', credentials: DEMO_STAFF })
    const table = await waitForRows(3)
    expect((await menuOf(user, table, 'Indigo Dabu Co-ord')).items).toEqual(['Edit', 'Send for review', 'Delete'])
  })
})

describe('V-06 Products on vendor-api as it is today (no list fields yet)', SLOW, () => {
  it('reads each row in full and still shows, filters and sorts the same', async () => {
    mockDb().proposals.productSummaries = false
    const { user } = await renderApp({ route: '/products' })
    let table = await waitForRows(10)
    const ajrakh = row(table, 'Ajrakh Block-Print Kurta')
    expect(within(ajrakh).getByText('₹2,499')).toBeInTheDocument()
    expect(within(ajrakh).getByText('28')).toBeInTheDocument()
    expect(within(row(table, 'Handloom Cotton Shirt — Rust')).getByText('Live · Changes in review')).toBeInTheDocument()

    await choose(user, 'Stock', 'Out of stock')
    table = await waitForRows(1)
    expect(titles(table)).toEqual(['Chikankari Kurti — Ivory'])
    await choose(user, 'Stock', 'Any')
    await choose(user, 'Sort', 'Price: low to high')
    await waitFor(() => expect(titles(screen.getByRole('table', { name: 'Products' })).slice(0, 3)).toEqual(['Shibori Indigo Scarf', 'Leheriya Cotton Dupatta', 'Handloom Cotton Shirt — Rust']))
  })
})

describe('V-06 Products on phones', SLOW, () => {
  it('shows a card per product and no table or checkboxes', async () => {
    const { user, router, db } = await renderApp({ route: '/products', viewport: 'mobile' })
    const list = await screen.findByRole('list', { name: 'Products' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(10))
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByRole('tablist', { name: 'Product status' })).toBeInTheDocument()

    const card = within(list).getAllByRole('listitem')[0]!
    expect(card).toHaveTextContent('Ajrakh Block-Print Kurta')
    expect(card).toHaveTextContent('KS-AJR-014')
    expect(card).toHaveTextContent('Indigo')
    expect(card.querySelector('[data-swatch="named"]')).not.toBeNull()
    expect(card).toHaveTextContent('₹2,499')
    expect(card).toHaveTextContent('Stock 28')
    expect(card).toHaveTextContent('Needs changes')

    // One main button; Bulk import is secondary, with the laptop note.
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: 'Add product' })).toHaveClass('MuiButton-contained')
    expect(within(main).getByRole('link', { name: 'Bulk import' })).toHaveClass('MuiButton-outlined')
    expect(within(main).getByText('Easier on a laptop')).toBeInTheDocument()
    await user.click(within(card).getByRole('link'))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/products/${bySku(db, 'KS-AJR-014').id}`))
  })

  it('keeps search in view and moves the other filters into a drawer', async () => {
    const { user, router } = await renderApp({ route: '/products', viewport: 'mobile' })
    const list = await screen.findByRole('list', { name: 'Products' })
    expect(screen.getByRole('textbox', { name: 'Search name or code' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Product type' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Filters' }))
    const drawer = await screen.findByRole('dialog', { name: 'Filters' })
    await choose(user, 'Product type', 'Sarees')
    expect(params(router).get('category')).toBe('Sarees')
    await user.click(within(drawer).getByRole('button', { name: 'Show results' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull())
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2))
    const [first, second] = within(list).getAllByRole('listitem')
    expect(first).toHaveTextContent('Kalamkari Cotton Saree')
    expect(second).toHaveTextContent('Jamdani Cotton Saree')
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument()
  })

  it('fits a tablet with cards and the rail', async () => {
    await renderApp({ route: '/products', viewport: 'tablet' })
    const list = await screen.findByRole('list', { name: 'Products' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(10))
    expect(screen.queryByRole('table')).toBeNull()
  })
})
