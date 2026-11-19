import { configure, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { renderApp } from '../../test/render'
import { server } from '../../test/server'

// The first test also loads the screen's chunk, and refetches re-render the full MUI table:
// give async queries more than the default second on slow machines.
configure({ asyncUtilTimeout: 8000, defaultHidden: true })

type User = Awaited<ReturnType<typeof renderApp>>['user']
type Router = Awaited<ReturnType<typeof renderApp>>['router']

const LIST = '*/api/v1/vendor/products'

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

// Every products request the screen makes, so tests can check what was asked for.
function trackListRequests() {
  const seen: URLSearchParams[] = []
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url)
    if (url.pathname === '/api/v1/vendor/products') seen.push(url.searchParams)
  }
  server.events.on('request:start', listener)
  onTestFinished(() => {
    server.events.removeListener('request:start', listener)
  })
  return seen
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
    expect(within(ajrakh).getByText('Kurtas')).toBeInTheDocument()
    expect(within(ajrakh).getByText('₹2,499')).toBeInTheDocument()
    expect(within(ajrakh).getByText('MRP ₹2,999')).toBeInTheDocument()
    expect(within(ajrakh).getByText('28')).toBeInTheDocument()
    expect(within(ajrakh).getByText('Needs changes')).toBeInTheDocument()
    expect(within(ajrakh).getByRole('button', { name: 'Actions for Ajrakh Block-Print Kurta' })).toBeInTheDocument()

    // A live product with an edit waiting says both, in words.
    const shirt = row(table, 'Handloom Cotton Shirt — Rust')
    expect(within(shirt).getByText('Live · Changes in review')).toBeInTheDocument()
    // Calm: status is plain text, and the word SKU never shows.
    expect(table.querySelector('.MuiChip-root, [data-status="live"] svg')).toBeNull()
    expect(main).not.toHaveTextContent(/SKU/)

    // Price equal to MRP: no MRP line. No price or sizes yet: a dash, not a zero.
    expect(within(row(table, 'Kutch Mirror-Work Jacket')).queryByText(/^MRP/)).toBeNull()
    const stole = row(table, 'Maheshwari Silk Stole')
    expect(within(stole).getAllByText('—')).toHaveLength(2)
    expect(within(stole).getByText('Draft')).toBeInTheDocument()

    expect(screen.getByText('Showing 1–10 of 27')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
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

  it('searches name or code once typing pauses', async () => {
    const seen = trackListRequests()
    const { user, router } = await renderApp({ route: '/products' })
    await waitForRows(10)
    const search = screen.getByRole('textbox', { name: 'Search name or code' })
    await user.type(search, 'ajrakh')
    expect(params(router).get('q')).toBeNull()
    await waitFor(() => expect(params(router).get('q')).toBe('ajrakh'))
    let table = await waitForRows(2)
    expect(titles(table)).toEqual(['Ajrakh Block-Print Kurta', 'Ajrakh Mul Dupatta'])
    // One request for the finished word, none for "a", "aj", "ajr"…
    expect(seen.map((p) => p.get('q')).filter(Boolean)).toEqual(['ajrakh'])

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
    await waitFor(() => expect(titles(screen.getByRole('table', { name: 'Products' })).slice(0, 3)).toEqual(['Shibori Indigo Scarf', 'Leheriya Cotton Dupatta', 'Batik Cotton Tunic']))
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('Sort: Price: low to high')
  })

  it('pages through the catalogue ten at a time', async () => {
    const { user, router } = await renderApp({ route: '/products' })
    await waitForRows(10)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(params(router).get('page')).toBe('2')
    expect(await screen.findByText('Showing 11–20 of 27')).toBeInTheDocument()
    let table = await waitForRows(10)
    expect(titles(table)[0]).toBe('Linen Co-ord Set — Indigo')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 21–27 of 27')).toBeInTheDocument()
    table = await waitForRows(7)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Showing 11–20 of 27')).toBeInTheDocument()

    // Changing a filter starts again from the first page.
    await user.click(screen.getByRole('tab', { name: 'Live 18' }))
    expect(params(router).get('page')).toBeNull()
    expect(await screen.findByText('Showing 1–10 of 18')).toBeInTheDocument()
  })

  it('opens a product from its row', async () => {
    const { user, router } = await renderApp({ route: '/products' })
    const table = await waitForRows(10)
    await user.click(within(row(table, 'Bandhani Silk Dupatta')).getByText('Dupattas'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products/p_003'))
  })

  it('edits, sends or archives one product from its row menu, with the result in the page', async () => {
    const { user, router, db } = await renderApp({ route: '/products' })
    let table = await waitForRows(10)

    // A live product can only be edited or archived from here.
    await user.click(within(table).getByRole('button', { name: 'Actions for Bandhani Silk Dupatta' }))
    let menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Edit', 'Archive'])
    await user.keyboard('{Escape}')

    // A draft without its try-on photos comes back with what to fix.
    await user.click(within(table).getByRole('button', { name: 'Actions for Indigo Dabu Co-ord' }))
    menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Edit', 'Send for review', 'Archive'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Send for review' }))
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('1 product could not be sent for review')
    expect(banner).toHaveTextContent('Indigo Dabu Co-ord: Add 5 more try-on photos. We need 5 photos of real people wearing it.')
    expect(db.products.find((p) => p.id === 'p_027')!.status).toBe('draft')

    // With the store details finished, a complete product goes.
    db.store.payout = { method: 'upi', upi_id: 'kalki@okhdfcbank' }
    table = await productTable()
    await user.click(within(table).getByRole('button', { name: 'Actions for Kutch Mirror-Work Jacket' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Send for review' }))
    expect(await screen.findByText('1 product sent for review')).toBeInTheDocument()
    expect(screen.getByText('1 product sent for review').closest('[role="status"]')).toBeInTheDocument()
    expect(db.products.find((p) => p.id === 'p_002')!.status).toBe('pending_review')

    table = await productTable()
    await user.click(within(table).getByRole('button', { name: 'Actions for Bagru Print Palazzo' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive Bagru Print Palazzo?' })
    expect(dialog).toHaveTextContent('It leaves the app and moves to Archived. You can restore it later.')
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(await screen.findByText('1 product archived')).toBeInTheDocument()
    expect(db.products.find((p) => p.id === 'p_011')!.status).toBe('archived')

    await user.click(within(await productTable()).getByRole('button', { name: 'Actions for Ajrakh Block-Print Kurta' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products/p_001'))
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

  it('asks before archiving a selection', async () => {
    const { user, db } = await renderApp({ route: '/products' })
    const table = await waitForRows(10)
    await user.click(within(table).getByRole('checkbox', { name: 'Select Ajrakh Block-Print Kurta' }))
    await user.click(within(table).getByRole('checkbox', { name: 'Select Pochampally Ikat Kurta' }))
    const bar = screen.getByRole('region', { name: 'Bulk actions' })
    expect(bar).toHaveTextContent('2 selected')
    expect(within(table).getByRole('checkbox', { name: 'Select all on this page' })).toHaveAttribute('data-indeterminate', 'true')

    await user.click(within(bar).getByRole('button', { name: 'Archive' }))
    let dialog = await screen.findByRole('dialog', { name: 'Archive 2 products?' })
    expect(dialog).toHaveTextContent('They leave the app and move to Archived. You can restore them later.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(db.products.filter((p) => p.status === 'archived')).toHaveLength(0)

    await user.click(within(bar).getByRole('button', { name: 'Archive' }))
    dialog = await screen.findByRole('dialog', { name: 'Archive 2 products?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(await screen.findByText('2 products archived')).toBeInTheDocument()
    expect(db.products.filter((p) => p.status === 'archived').map((p) => p.title)).toEqual(['Ajrakh Block-Print Kurta', 'Pochampally Ikat Kurta'])
    expect(await screen.findByRole('tab', { name: 'Archived 2' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'All 25' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 11–20 of 25')).toBeInTheDocument()
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
    const { user, db } = await renderApp({ route: '/products' })
    db.failNext = { path: '/vendor/products', status: 429, code: 'rate_limited', message: 'Too many attempts. Wait a minute and try again.' }
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('We could not load your products.')
    expect(banner).toHaveTextContent('Too many attempts. Wait a minute and try again.')
    await user.click(within(banner).getByRole('button', { name: 'Try again' }))
    await waitForRows(10)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('welcomes a seller with an empty catalogue', async () => {
    const { db } = await renderApp({ route: '/products' })
    db.products.splice(0)
    expect(await screen.findByRole('heading', { name: 'No products yet' })).toBeInTheDocument()
    expect(screen.getByText('Start with your best seller')).toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: 'Add product' })).toHaveAttribute('href', '/products/new')
    expect(within(main).getByRole('link', { name: 'Bulk import' })).toHaveAttribute('href', '/products/import')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Search name or code' })).toBeNull()
  })
})

describe('V-06 Products on phones', SLOW, () => {
  it('shows a card per product and no table or checkboxes', async () => {
    const { user, router } = await renderApp({ route: '/products', viewport: 'mobile' })
    const list = await screen.findByRole('list', { name: 'Products' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(10))
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByRole('tablist', { name: 'Product status' })).toBeInTheDocument()

    const card = within(list).getAllByRole('listitem')[0]!
    expect(card).toHaveTextContent('Ajrakh Block-Print Kurta')
    expect(card).toHaveTextContent('KS-AJR-014')
    expect(card).toHaveTextContent('₹2,499')
    expect(card).toHaveTextContent('Stock 28')
    expect(card).toHaveTextContent('Needs changes')

    // One main button; Bulk import is secondary, with the laptop note.
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: 'Add product' })).toHaveClass('MuiButton-contained')
    expect(within(main).getByRole('link', { name: 'Bulk import' })).toHaveClass('MuiButton-outlined')
    expect(within(main).getByText('Easier on a laptop')).toBeInTheDocument()
    await user.click(within(card).getByRole('link'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products/p_001'))
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
})
