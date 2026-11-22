import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { makeStore, sessionBody } from '../../session/testing'
import { BASE, apiErrorResponse, useApiServer } from '../../test/msw'
import { renderRoute } from '../../test/renderRoute'
import { typeFast } from '../../test/typeFast'
import { setViewport } from '../../test/viewport'
import { PAGE_SIZE } from './filters'
import { detail, detailHandler, listHandler, product, revision } from './testing'

const server = useApiServer()

const many = (count: number) => Array.from({ length: count }, (_, i) => product(i + 1))

async function open(path = '/products', options: { width?: number } = {}) {
  setViewport(options.width ?? 1280)
  const store = makeStore({ refresh: async () => sessionBody() }).store
  const router = renderRoute(path, { store })
  // The page is a lazy chunk: the first test in a file pays for loading it, which can take seconds on a cold start.
  await screen.findByRole('heading', { level: 1, name: 'Products' }, { timeout: 15_000 })
  return { router, user: userEvent.setup() }
}

const search = (router: { state: { location: { search: string } } }) => new URLSearchParams(router.state.location.search)

describe('the products list', () => {
  it('shows each product with title, SKU, category, status in words, a pending-changes badge and the date', async () => {
    server.use(
      listHandler([
        product(1, { title: 'Silk kurta', sku: 'K-1', category: 'kurtas', status: 'approved', has_pending_changes: true }),
        product(2, { title: 'Cotton saree', sku: 'S-2', category: 'sarees', status: 'rejected' }),
        product(3, { title: 'Old shawl', sku: 'W-3', status: 'archived' }),
        // The API sets has_pending_changes for every draft and every product in review, not only for an edited approved one.
        product(4, { title: 'New tote', sku: 'T-4', status: 'draft', has_pending_changes: true }),
        product(5, { title: 'Wool scarf', sku: 'F-5', status: 'pending_review', has_pending_changes: true }),
      ]),
    )
    await open('/products?status=')
    const table = await screen.findByRole('table', { name: 'Your products' })
    const first = within(within(table).getByRole('row', { name: /Silk kurta/ }))
    expect(first.getByText('K-1')).toBeTruthy()
    expect(first.getByText('kurtas')).toBeTruthy()
    expect(first.getByText('Live')).toBeTruthy()
    expect(first.getByText('Changes pending')).toBeTruthy()
    expect(first.getByText('10 Nov 2026')).toBeTruthy()
    expect(within(table).getByText('Needs changes')).toBeTruthy()
    expect(within(table).queryByText('Old shawl')).toBeNull() // archived stays hidden unless asked for
    // "Changes pending" is for an approved product being edited: not for a draft or one in review.
    expect(within(table).getAllByText('Changes pending')).toHaveLength(1)
    expect(within(within(table).getByRole('row', { name: /New tote/ })).queryByText('Changes pending')).toBeNull()
    expect(within(within(table).getByRole('row', { name: /Wool scarf/ })).queryByText('Changes pending')).toBeNull()
  })

  it('shows archived products only when asked for, and offers View, not Delete', async () => {
    server.use(listHandler([product(1, { title: 'Old shawl', status: 'archived' }), product(2)]))
    await open('/products?status=archived')
    const row = within(await screen.findByRole('row', { name: /Old shawl/ }))
    expect(row.getByText('Archived')).toBeTruthy()
    expect(row.getByRole('link', { name: 'View Old shawl' })).toBeTruthy()
    expect(row.queryByRole('button', { name: /Delete|Archive/ })).toBeNull()
  })

  it('links each product to its page and prefetches it on hover and focus', async () => {
    const seen: string[] = []
    server.use(listHandler([product(7, { title: 'Silk kurta' })]), detailHandler({ p7: detail('p7') }, seen))
    const { user } = await open()
    const link = await screen.findByRole('link', { name: 'Silk kurta' })
    expect(link.getAttribute('href')).toBe('/products/p7')
    await user.hover(link)
    await waitFor(() => expect(seen).toContain('p7'))
  })

  it('uses a table on a wide screen and cards on a phone, with the same information', async () => {
    server.use(listHandler([product(1, { title: 'Silk kurta', sku: 'K-1', has_pending_changes: true })]))
    await open('/products', { width: 1280 })
    expect(await screen.findByRole('table')).toBeTruthy()
    cleanup()
    await open('/products', { width: 320 })
    await screen.findByText('Silk kurta')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('list', { name: 'Your products' })).toBeTruthy()
    expect(screen.getByText(/SKU K-1 · kurtas/)).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.getByText('Changes pending')).toBeTruthy()
  })

  it('has row actions that a keyboard can reach, named by the product', async () => {
    server.use(listHandler([product(1, { title: 'Silk kurta' })]))
    const { user } = await open()
    const edit = await screen.findByRole('link', { name: 'Edit Silk kurta' })
    const del = screen.getByRole('button', { name: 'Archive Silk kurta' })
    edit.focus()
    expect(document.activeElement).toBe(edit)
    await user.tab()
    expect(document.activeElement).toBe(del)
  })

  it('shows a status it does not know as it is', async () => {
    server.use(listHandler([product(1, { title: 'Odd one', status: 'on_hold' })]))
    await open()
    expect(await screen.findByText('on_hold')).toBeTruthy()
  })
})

describe('filters in the address', () => {
  it('reads every filter and the page from the address and sends them, with limit and offset', async () => {
    const seen: URLSearchParams[] = []
    server.use(listHandler(many(80), seen))
    await open('/products?status=approved&category=kurtas&q=product&page=2')
    await screen.findByRole('table')
    const last = seen.at(-1)!
    expect(Object.fromEntries(last)).toEqual({ status: 'approved', category: 'kurtas', q: 'product', limit: String(PAGE_SIZE), offset: String(PAGE_SIZE) })
    expect((screen.getByLabelText('Search by title or SKU') as HTMLInputElement).value).toBe('product')
    expect((screen.getByLabelText('Category') as HTMLInputElement).value).toBe('kurtas')
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toBe('Live')
  })

  it('survives a reload: a fresh render at the same address shows the same list', async () => {
    server.use(listHandler([...many(30), product(99, { title: 'Draft one', status: 'draft' })]))
    const { router, user } = await open('/products')
    await screen.findByRole('table')
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'Draft' }))
    await waitFor(() => expect(search(router).get('status')).toBe('draft'))
    await screen.findByText('Draft one')

    const address = `${router.state.location.pathname}${router.state.location.search}`
    cleanup()
    await open(address)
    await screen.findByText('Draft one')
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toBe('Draft')
  })

  it('steps back through the filters with the back button, in the list and in the boxes', async () => {
    server.use(listHandler([...many(30), product(99, { title: 'Draft one', status: 'draft' })]))
    const { router, user } = await open('/products')
    await screen.findByRole('table')
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'Draft' }))
    await waitFor(() => expect(search(router).get('status')).toBe('draft'))
    await screen.findByText('Draft one')
    expect(router.state.historyAction).toBe('PUSH')

    await act(async () => { await router.navigate(-1) })
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toBe('All except archived')
    await waitFor(() => expect(screen.queryByText('Draft one')).toBeNull())
  })

  it('goes back to page 1 when a filter changes, and keeps the page when only the page changes', async () => {
    server.use(listHandler([...many(60), product(99, { title: 'Draft one', status: 'draft' })]))
    const { router, user } = await open('/products?page=3')
    await screen.findByRole('table')
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'Draft' }))
    await waitFor(() => expect(search(router).get('page')).toBeNull())
    expect(search(router).get('status')).toBe('draft')
  })

  it('searches after a pause, not on every key, and does not fill the history with keystrokes', async () => {
    const seen: URLSearchParams[] = []
    server.use(listHandler([product(1, { title: 'Silk kurta' }), product(2, { title: 'Cotton saree' })], seen))
    const { router } = await open('/products')
    await screen.findByRole('table')
    const before = seen.length
    // No pause between the keys (`delay: null`): they all land before any timer can run, so the
    // 300 ms debounce cannot fire mid-word however slow the runner is. With the default delay a
    // slow keystroke would let it fire and search for "s".
    const user = userEvent.setup({ delay: null })
    await user.click(screen.getByLabelText('Search by title or SKU'))
    await user.keyboard('silk')
    expect(search(router).get('q')).toBeNull() // still waiting for the pause
    await waitFor(() => expect(search(router).get('q')).toBe('silk'))
    await waitFor(() => expect(screen.queryByText('Cotton saree')).toBeNull())
    expect(screen.getByText('Silk kurta')).toBeTruthy()
    const queries = seen.slice(before).map((params) => params.get('q'))
    expect(queries).not.toContain('s')
    expect(queries).not.toContain('si')
    expect(queries.at(-1)).toBe('silk')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('does not lose characters typed while the address is catching up', async () => {
    server.use(listHandler(many(5)))
    const { router, user } = await open('/products')
    await screen.findByRole('table')
    const box = screen.getByLabelText('Search by title or SKU') as HTMLInputElement
    await user.click(box)
    await user.keyboard('prod')
    await new Promise((r) => setTimeout(r, 330))
    await user.keyboard('uct')
    expect(box.value).toBe('product')
    await waitFor(() => expect(search(router).get('q')).toBe('product'))
  })

  it('finds a product by SKU or by category', async () => {
    server.use(listHandler([product(1, { title: 'Silk kurta', sku: 'ZX-900', category: 'kurtas' }), product(2, { title: 'Saree', sku: 'AB-1', category: 'sarees' })]))
    const { user } = await open('/products')
    await screen.findByRole('table')
    await typeFast(user, screen.getByLabelText('Search by title or SKU'), 'zx-9')
    await waitFor(() => expect(screen.queryByText('Saree')).toBeNull())
    expect(screen.getByText('Silk kurta')).toBeTruthy()
    await typeFast(user, screen.getByLabelText('Category'), 'sarees')
    await screen.findByText(/No products match/)
  })
})

describe('paging', () => {
  it('shows the range and the total, and moves between pages', async () => {
    const seen: URLSearchParams[] = []
    server.use(listHandler(many(60), seen))
    const { router, user } = await open('/products')
    expect(await screen.findByText('Showing 1–25 of 60 products')).toBeTruthy()
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 26–50 of 60 products')).toBeTruthy()
    expect(search(router).get('page')).toBe('2')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 51–60 of 60 products')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('Showing 26–50 of 60 products')
    expect(seen.at(-1)!.get('offset')).toBe(String(PAGE_SIZE))
  })

  it('goes to the last page that exists when the address names one past the end', async () => {
    server.use(listHandler(many(30)))
    const { router } = await open('/products?page=9')
    await waitFor(() => expect(search(router).get('page')).toBe('2'))
    expect(await screen.findByText('Showing 26–30 of 30 products')).toBeTruthy()
  })
})

describe('empty states', () => {
  it('invites the first product and the bulk import when there are none', async () => {
    server.use(listHandler([]))
    await open('/products')
    expect(await screen.findByRole('heading', { level: 2, name: 'No products yet' })).toBeTruthy()
    const empty = screen.getByRole('heading', { level: 2, name: 'No products yet' }).parentElement!
    expect(within(empty).getByRole('link', { name: 'Add a product' }).getAttribute('href')).toBe('/products/new')
    expect(within(empty).getByRole('link', { name: 'Import from a spreadsheet' }).getAttribute('href')).toBe('/import')
  })

  it('says nothing matches, and Clear filters brings everything back, in the address and the boxes', async () => {
    server.use(listHandler(many(3)))
    const { router, user } = await open('/products?q=zzzz&category=nothing')
    expect(await screen.findByRole('heading', { level: 2, name: 'No products match' })).toBeTruthy()
    expect(screen.queryByText('No products yet')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await screen.findByRole('table')
    expect(router.state.location.search).toBe('')
    expect((screen.getByLabelText('Search by title or SKU') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Category') as HTMLInputElement).value).toBe('')
  })
})

describe('loading and errors', () => {
  it('shows a skeleton while loading', async () => {
    server.use(http.get(`${BASE}/v1/vendor/products`, async () => { await new Promise((r) => setTimeout(r, 300)); return HttpResponse.json({ items: [], total: 0, limit: 25, offset: 0 }) }))
    await open('/products')
    expect(await screen.findByRole('status', { name: 'Loading your products' })).toBeTruthy()
  })

  it('shows an error with Try again and the request id, then recovers', async () => {
    let fail = true
    server.use(
      http.get(`${BASE}/v1/vendor/products`, () =>
        fail ? apiErrorResponse(500, 'internal_error', 'boom', { 'X-Request-ID': 'req-77' }) : HttpResponse.json({ items: [product(1, { title: 'Back again' })], total: 1, limit: 25, offset: 0 }),
      ),
    )
    const { user } = await open('/products')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('req-77')
    expect(alert.textContent).not.toMatch(/boom|internal_error/)
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Back again')).toBeTruthy()
  })
})

describe('deleting', () => {
  const deleteRequests: string[] = []
  const withDelete = (status = 204, body?: ReturnType<typeof apiErrorResponse>) =>
    http.delete(`${BASE}/v1/vendor/products/:id`, ({ params }) => {
      deleteRequests.push(String(params.id))
      return body ?? new HttpResponse(null, { status })
    })

  async function startDelete(items: ReturnType<typeof product>[], details: Record<string, ReturnType<typeof detail>> = {}, label = 'Delete') {
    deleteRequests.length = 0
    server.use(listHandler(items), detailHandler(details))
    const { user } = await open('/products')
    await screen.findByRole('table')
    await user.click(await screen.findByRole('button', { name: new RegExp(`^${label} ${items[0]!.title}$`) }))
    return user
  }

  it('says "deleted for good" before deleting a draft that was never submitted, then deletes and says so', async () => {
    server.use(withDelete())
    const user = await startDelete([product(1, { title: 'New draft', status: 'draft', sku: 'D-1' })], { p1: detail('p1', { working: revision(1, null) }) })
    const dialog = await screen.findByRole('dialog', { name: 'Delete this product for good?' })
    expect(dialog.textContent).toMatch(/"New draft" \(D-1\) has never been sent for review, so it will be deleted and cannot be brought back/)
    expect(deleteRequests).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Delete product' }))
    await waitFor(() => expect(deleteRequests).toEqual(['p1']))
    expect(await screen.findByText('New draft was deleted.')).toBeTruthy()
  })

  it('says "archived, not deleted" for a live product, and that it goes off sale', async () => {
    server.use(withDelete())
    const user = await startDelete([product(1, { title: 'Live kurta', status: 'approved' })], {}, 'Archive')
    const dialog = await screen.findByRole('dialog', { name: 'Archive this product?' })
    expect(dialog.textContent).toMatch(/archived, not deleted.*off sale straight away.*SKU stays reserved/)
    await user.click(screen.getByRole('button', { name: 'Archive product' }))
    await waitFor(() => expect(deleteRequests).toEqual(['p1']))
    expect(await screen.findByText('Live kurta was archived.')).toBeTruthy()
  })

  it('says "archived" for a draft that is a rejected product being reworked', async () => {
    await startDelete([product(1, { title: 'Reworked', status: 'draft' })], { p1: detail('p1', { working: revision(2, null) }) })
    expect((await screen.findByRole('dialog', { name: 'Archive this product?' })).textContent).toMatch(/archived, not deleted/)
    expect(deleteRequests).toEqual([])
  })

  it('explains both possibilities when a draft\'s history cannot be read', async () => {
    deleteRequests.length = 0
    server.use(listHandler([product(1, { title: 'Mystery', status: 'draft' })]), http.get(`${BASE}/v1/vendor/products/:id`, () => HttpResponse.error()))
    const { user } = await open('/products')
    await user.click(await screen.findByRole('button', { name: 'Delete Mystery' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete or archive this product?' })
    expect(dialog.textContent).toMatch(/never been sent for review it will be deleted for good.*archived instead/)
  })

  it('never sends a request when the vendor cancels', async () => {
    const user = await startDelete([product(1, { title: 'Keep me' })], {}, 'Archive')
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deleteRequests).toEqual([])
  })

  it('explains a product in review cannot be deleted, without sending anything', async () => {
    const user = await startDelete([product(1, { title: 'In the queue', status: 'pending_review' })])
    const dialog = await screen.findByRole('dialog', { name: "This product can't be deleted right now" })
    expect(dialog.textContent).toMatch(/is in review.*Wait for the decision/)
    // The dialog hides the page from assistive technology while it is open, so ask for hidden elements too.
    expect(screen.getByRole('button', { name: 'Delete In the queue', hidden: true }).getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Archive product' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(deleteRequests).toEqual([])
  })

  it('explains a 409 product_in_review that arrives anyway (it went into review a moment ago)', async () => {
    server.use(withDelete(409, apiErrorResponse(409, 'product_in_review', 'In review')))
    const user = await startDelete([product(1, { title: 'Just submitted' })], {}, 'Archive')
    await user.click(await screen.findByRole('button', { name: 'Archive product' }))
    const alert = await screen.findByText(/This product is in review, so it cannot be deleted/)
    expect(alert.closest('[role]')?.getAttribute('role')).toBe('alert')
  })

  it('refreshes the list after a delete', async () => {
    let items = [product(1, { title: 'Gone soon' }), product(2, { title: 'Stays' })]
    server.use(
      http.get(`${BASE}/v1/vendor/products`, () => HttpResponse.json({ items, total: items.length, limit: 25, offset: 0 })),
      http.delete(`${BASE}/v1/vendor/products/:id`, () => { items = items.filter((item) => item.id !== 'p1'); return new HttpResponse(null, { status: 204 }) }),
    )
    const { user } = await open('/products')
    await user.click(await screen.findByRole('button', { name: 'Archive Gone soon' }))
    await user.click(await screen.findByRole('button', { name: 'Archive product' }))
    await waitFor(() => expect(screen.queryByText('Gone soon')).toBeNull())
    expect(screen.getByText('Stays')).toBeTruthy()
  })
})
