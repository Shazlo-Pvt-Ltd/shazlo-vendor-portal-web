import { mockModuleToken } from '@shazlo/mock-vendor-api'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type * as S from '../../api/model'
import { dashboardCopy } from '../../copy/dashboard'
import { formatRelative } from '../../lib/format'
import { isOutboxStatus } from '../../lib/status'
import { renderModule, VENDOR_API_URL } from '../../test/render'
import { server } from '../../test/server'
import { parseQueueParams } from '../queue/parts/useQueueParams'
import { parseVendorParams } from '../vendors/list/useVendorParams'
import { groupByBrand } from './parts/brandsWaiting'
import { MAX_BRAND_ROWS } from './parts/BrandsWaitingCard'

type Db = ReturnType<typeof renderModule>['db']

// The figures come from the seed in packages/mock-vendor-api. Vendor counts are read off the mock's
// records; the summary's figures (its 24-hour and today windows) are asked of the mock itself.
async function adminGet<T>(path: string): Promise<T> {
  const token = mockModuleToken({ id: 'a_priya', name: 'Priya Mehta' }, Math.floor(Date.now() / 1000) + 300)
  const response = await fetch(`${VENDOR_API_URL}/api/v1/admin${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return (await response.json()) as T
}

const forbidden = (message: string) => HttpResponse.json({ error: { code: 'forbidden', message, request_id: 'req-test' } }, { status: 403 })

async function onDashboard() {
  // The first visit compiles the screen's chunk; give it room on a busy machine.
  return screen.findByRole('heading', { level: 1, name: 'Vendor dashboard' }, { timeout: 10_000 })
}

const region = (name: string) => screen.getByRole('region', { name })

async function figures(card: string, label: string) {
  return within(region(card)).findByRole('group', { name: label }, { timeout: 10_000 })
}

// A figure shows its number and opens its list (or, with href null, opens nothing).
function expectFigure(container: HTMLElement, label: string, value: number, href: string | null) {
  const group = within(container).getByRole('group', { name: label })
  expect(group.querySelector('.MuiTypography-stat')?.textContent).toBe(value.toLocaleString('en-IN'))
  if (href === null) expect(within(group).queryByRole('link')).toBeNull()
  else expect(within(group).getByRole('link')).toHaveAttribute('href', href)
}

const pendingProducts = (db: Db) => db.products.filter((p) => p.status === 'pending_review')

// The brands with waiting products, as the card should list them: most products first, then the
// longest wait.
function expectedBrands(db: Db) {
  const byVendor = new Map<string, { name: string; count: number; oldest: number }>()
  for (const p of pendingProducts(db)) {
    const entry = byVendor.get(p.vendorId) ?? { name: db.vendors.find((v) => v.id === p.vendorId)!.brand_name, count: 0, oldest: Infinity }
    entry.count += 1
    entry.oldest = Math.min(entry.oldest, Date.parse(p.submittedAt))
    byVendor.set(p.vendorId, entry)
  }
  return [...byVendor.values()].sort((a, b) => b.count - a.count || a.oldest - b.oldest)
}

describe('Vendor dashboard', { timeout: 40_000 }, () => {
  it('names itself to Shazlo One, offers the review queue and shows its cards in order', async () => {
    const { shell } = renderModule({ route: '/dashboard' })
    await onDashboard()
    expect(screen.getByText(dashboardCopy.subtitle)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open review queue' })).toHaveAttribute('href', '/queue')
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/dashboard', title: 'Dashboard' }))
    expect(screen.getAllByRole('region').map((r) => r.querySelector('h2')?.textContent)).toEqual(['Vendors', 'Review queue', 'Brands with products waiting', 'Publishing to the app', 'Recent decisions'])
  })

  it('counts the vendors from the seed, each figure opening its filtered list', async () => {
    const { db } = renderModule({ route: '/dashboard' })
    await onDashboard()
    const group = await figures('Vendors', 'Vendor figures')
    const withStatus = (status: S.VendorStatus) => db.vendors.filter((v) => v.status === status).length
    const applied = withStatus('applied')
    const asked = withStatus('under_review')
    expect(withStatus('approved')).toBeGreaterThan(0)
    expect(applied + asked).toBeGreaterThan(0)

    expectFigure(group, 'Live vendors', withStatus('approved'), '/vendors?status=approved')
    expectFigure(group, 'Applications waiting', applied + asked, '/queue?kind=application')
    expectFigure(group, 'Rates to review', db.vendors.filter((v) => v.commission.state === 'proposed').length, '/vendors?commission=proposed')
    expectFigure(group, 'Suspended', withStatus('suspended'), '/vendors?status=suspended')
    expect(within(group).getByText(`New ${applied} · More info asked ${asked}`)).toBeInTheDocument()
    expect(within(region('Vendors')).getByRole('link', { name: 'All vendors' })).toHaveAttribute('href', '/vendors')
  })

  it('shows the review queue figures from the summary', async () => {
    const { db } = renderModule({ route: '/dashboard' })
    await onDashboard()
    const group = await figures('Review queue', 'Review queue figures')
    const summary = await adminGet<S.Summary>('/summary')
    expect(summary.queue.product).toBe(pendingProducts(db).length)
    expect(summary.queue.brand_page).toBe(db.brands.filter((b) => b.status === 'pending_review').length)

    expectFigure(group, 'Products waiting', summary.queue.product, '/queue?kind=product')
    expectFigure(group, 'Brand pages waiting', summary.queue.brand_page, '/queue?kind=brand_page')
    expectFigure(group, 'Waiting over 24 h', summary.queue.over_24h, '/queue?sort=oldest')
    expectFigure(group, 'Decided today', summary.decided_today, null)
  })

  it('links every figure to a filter its screen reads', async () => {
    renderModule({ route: '/dashboard' })
    await onDashboard()
    await figures('Vendors', 'Vendor figures')
    await figures('Review queue', 'Review queue figures')
    await figures('Publishing to the app', 'Publishing figures')
    const hrefs = screen.getAllByRole('group').flatMap((g) => (g.getAttribute('aria-labelledby') ? within(g).queryAllByRole('link') : [])).map((a) => a.getAttribute('href')!)
    expect(hrefs).toHaveLength(11)
    for (const href of hrefs) {
      const url = new URL(href, 'http://module.test')
      const params = [...url.searchParams]
      expect(params, href).toHaveLength(1)
      const [[key, value]] = params as [[string, string]]
      if (url.pathname === '/vendors') expect(parseVendorParams(url.searchParams)[key as 'status' | 'commission'], href).toBe(value)
      else if (url.pathname === '/queue') expect(parseQueueParams(url.searchParams)[key as 'kind' | 'sort'], href).toBe(value)
      else if (url.pathname === '/publishing') expect(key === 'status' && isOutboxStatus(value), href).toBe(true)
      else throw new Error(`Unexpected link ${href}`)
    }
  })

  it('opens the queue on the applications tab from its figure', async () => {
    const { user, router } = renderModule({ route: '/dashboard' })
    await onDashboard()
    const group = await figures('Vendors', 'Vendor figures')
    await user.click(within(within(group).getByRole('group', { name: 'Applications waiting' })).getByRole('link'))
    await screen.findByRole('heading', { level: 1, name: 'Review queue' }, { timeout: 10_000 })
    expect(router.state.location.search).toBe('?kind=application')
    expect(screen.getByRole('tab', { name: /^Vendor applications/, selected: true })).toBeInTheDocument()
  })

  it('lists each brand with waiting products once, most first, linking to its Products tab', async () => {
    const { db, user, router } = renderModule({ route: '/dashboard' })
    await onDashboard()
    const list = await screen.findByRole('list', { name: 'Brands with products waiting' }, { timeout: 10_000 })
    const expected = expectedBrands(db)
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(expected.length)
    rows.forEach((row, i) => expect(within(row).getByText(expected[i]!.name)).toBeInTheDocument())

    // Kalki Studio's four waiting products are one row, at the top.
    const kalkiProducts = pendingProducts(db).filter((p) => p.vendorId === 'v_kalki')
    expect(kalkiProducts).toHaveLength(4)
    expect(within(list).getAllByText('Kalki Studio')).toHaveLength(1)
    const kalki = rows[0]!
    expect(within(kalki).getByText('Kalki Studio')).toBeInTheDocument()
    expect(within(kalki).getAllByRole('link')).toHaveLength(1)
    expect(within(kalki).getByRole('link')).toHaveAttribute('href', '/vendors/v_kalki?tab=products')
    expect(within(kalki).getByText('4 products waiting')).toBeInTheDocument()
    const oldest = kalkiProducts.map((p) => p.submittedAt).sort()[0]!
    expect(within(kalki).getByText(dashboardCopy.brands.oldest(formatRelative(oldest)))).toHaveAttribute('datetime', oldest)
    // A brand with one product waiting says so in the singular.
    expect(within(rows.at(-1)!).getByText('1 product waiting')).toBeInTheDocument()
    expect(screen.queryByText(/not shown$/)).not.toBeInTheDocument()

    await user.click(within(kalki).getByRole('link'))
    await screen.findByRole('heading', { level: 1, name: 'Kalki Studio' }, { timeout: 10_000 })
    expect(router.state.location.pathname + router.state.location.search).toBe('/vendors/v_kalki?tab=products')
    expect(screen.getByRole('tab', { name: /^Products/, selected: true })).toBeInTheDocument()
  })

  it(`shows at most ${MAX_BRAND_ROWS} brands and says how many more wait in the queue`, async () => {
    const { db } = renderModule({ route: '/dashboard' })
    // Before the page asks: one waiting product each for brands with none.
    const template = pendingProducts(db)[0]!
    const without = db.vendors.filter((v) => !db.products.some((p) => p.vendorId === v.id))
    without.slice(0, 5).forEach((v, i) => db.products.push({ ...template, id: `p_extra_${i}`, sku: `EX-${i}`, vendorId: v.id }))
    const brands = expectedBrands(db)
    expect(brands.length).toBeGreaterThan(MAX_BRAND_ROWS)

    await onDashboard()
    const list = await screen.findByRole('list', { name: 'Brands with products waiting' }, { timeout: 10_000 })
    expect(within(list).getAllByRole('listitem')).toHaveLength(MAX_BRAND_ROWS)
    const card = region('Brands with products waiting')
    expect(within(card).getByText(`${brands.length - MAX_BRAND_ROWS} more brands not shown`)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'See all in the review queue' })).toHaveAttribute('href', '/queue?kind=product')
  })

  it('shows publishing figures by status and warns when an event failed', async () => {
    renderModule({ route: '/dashboard' })
    await onDashboard()
    const group = await figures('Publishing to the app', 'Publishing figures')
    const { publishing } = await adminGet<S.Summary>('/summary')
    expect(publishing.failed).toBeGreaterThan(0)

    expectFigure(group, 'Delivered in the last 24 h', publishing.delivered_24h, '/publishing?status=delivered')
    expectFigure(group, 'Waiting', publishing.waiting, '/publishing?status=waiting')
    expectFigure(group, 'Retrying', publishing.retrying, '/publishing?status=retrying')
    expectFigure(group, 'Failed', publishing.failed, '/publishing?status=failed')

    const card = region('Publishing to the app')
    const warning = within(card).getByRole('alert')
    expect(warning).toHaveTextContent(dashboardCopy.publishing.failedBanner.title(publishing.failed))
    expect(within(warning).getByRole('link', { name: 'See failed events' })).toHaveAttribute('href', '/publishing?status=failed')
    expect(within(card).getByRole('link', { name: 'Open publishing' })).toHaveAttribute('href', '/publishing')
  })

  it('shows no publishing warning when nothing failed', async () => {
    const { db } = renderModule({ route: '/dashboard' })
    for (const event of db.outbox) if (event.status === 'failed') event.status = 'delivered'
    await onDashboard()
    const group = await figures('Publishing to the app', 'Publishing figures')
    expectFigure(group, 'Failed', 0, '/publishing?status=failed')
    expect(within(region('Publishing to the app')).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lists recent decisions with their outcome and reviewer, opening the page each has', async () => {
    renderModule({ route: '/dashboard' })
    await onDashboard()
    const list = await screen.findByRole('list', { name: 'Recent decisions' }, { timeout: 10_000 })
    const { recent } = await adminGet<S.Summary>('/summary')
    expect(new Set(recent.map((d) => d.kind))).toEqual(new Set(['product', 'brand_page', 'application']))
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(recent.length)

    const where = (d: (typeof recent)[number]) => (d.kind === 'brand_page' ? `/review/brand/${d.vendor.id}` : d.kind === 'application' ? `/vendors/${d.vendor.id}` : '/queue')
    recent.forEach((d, i) => {
      const row = rows[i]!
      expect(within(row).getAllByRole('link')).toHaveLength(1)
      expect(within(row).getByRole('link')).toHaveAttribute('href', where(d))
      expect(within(row).getByText(d.title)).toBeInTheDocument()
      expect(row).toHaveTextContent(`${d.vendor.name} · ${dashboardCopy.decisions.kind[d.kind]}`)
      expect(within(row).getByText(d.decision === 'approved' ? 'Approved' : 'Sent back')).toHaveAttribute('data-status', d.decision === 'approved' ? 'live' : 'sentBack')
      expect(row).toHaveTextContent(`by ${d.reviewer} · ${formatRelative(d.at)}`)
    })
  })

  it('keeps the rest of the page when the vendor counts fail, and retries them', async () => {
    server.use(http.get('*/api/v1/admin/vendors', () => forbidden('Vendors are not available to your role.'), { once: true }))
    const { user } = renderModule({ route: '/dashboard' })
    await onDashboard()
    const card = region('Vendors')
    const alert = await within(card).findByRole('alert', {}, { timeout: 10_000 })
    expect(alert).toHaveTextContent('Vendor figures did not load')
    expect(alert).toHaveTextContent('Vendors are not available to your role.')
    expect(within(card).queryByRole('group', { name: 'Vendor figures' })).not.toBeInTheDocument()

    // The other cards carry on.
    expect(await figures('Review queue', 'Review queue figures')).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Brands with products waiting' })).toBeInTheDocument()
    expect(await figures('Publishing to the app', 'Publishing figures')).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Recent decisions' })).toBeInTheDocument()

    // The button shows "Try again" and is named after what it loads.
    const retry = within(alert).getByRole('button', { name: 'Try again to load vendor figures' })
    expect(retry).toHaveTextContent('Try again')
    await user.click(retry)
    expect(await figures('Vendors', 'Vendor figures')).toBeInTheDocument()
    await waitFor(() => expect(within(card).queryByRole('alert')).not.toBeInTheDocument())
  })

  it('keeps the rest of the page when the product queue fails, and retries it', async () => {
    server.use(http.get('*/v1/admin/queue', () => forbidden('The queue is not available to your role.'), { once: true }))
    const { user } = renderModule({ route: '/dashboard' })
    await onDashboard()
    const card = region('Brands with products waiting')
    const alert = await within(card).findByRole('alert', {}, { timeout: 10_000 })
    expect(alert).toHaveTextContent('Brands with products waiting did not load')
    expect(alert).toHaveTextContent('The queue is not available to your role.')
    expect(within(card).queryByRole('list')).not.toBeInTheDocument()
    expect(within(card).queryByRole('status')).not.toBeInTheDocument()
    // The card has no padding of its own; the banner lines up with the card's title.
    const inset = alert.closest('[data-layout]')!.parentElement!
    expect(Number.parseFloat(getComputedStyle(inset).paddingLeft)).toBeGreaterThan(0)

    // The other cards carry on.
    expect(await figures('Vendors', 'Vendor figures')).toBeInTheDocument()
    expect(await figures('Review queue', 'Review queue figures')).toBeInTheDocument()
    expect(await figures('Publishing to the app', 'Publishing figures')).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Recent decisions' })).toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'Try again to load brands with products waiting' }))
    const list = await within(card).findByRole('list', { name: 'Brands with products waiting' }, { timeout: 10_000 })
    expect(within(list).getByRole('link', { name: /^Kalki Studio/ })).toHaveAttribute('href', '/vendors/v_kalki?tab=products')
    await waitFor(() => expect(within(card).queryByRole('alert')).not.toBeInTheDocument())
  })

  it('keeps the last figures and brands under the banner when a later load fails', async () => {
    // Only Date is faked: the clock stands still until the test moves it on.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { shell } = renderModule({ route: '/dashboard' })
      await onDashboard()
      const before = await figures('Review queue', 'Review queue figures')
      const products = within(before).getByRole('group', { name: 'Products waiting' }).textContent
      await screen.findByRole('list', { name: 'Brands with products waiting' }, { timeout: 10_000 })

      // From now on the summary and the queue fail. The admin leaves the page and comes back once
      // its data is stale, so it loads again.
      server.use(
        http.get('*/api/v1/admin/summary', () => forbidden('The summary is not available to your role.')),
        http.get('*/v1/admin/queue', () => forbidden('The queue is not available to your role.')),
      )
      shell.navigate('/vendors')
      await screen.findByRole('heading', { level: 1, name: 'Vendors' }, { timeout: 10_000 })
      vi.setSystemTime(Date.now() + 60_000)
      shell.navigate('/dashboard')
      await onDashboard()

      for (const [card, title] of [
        ['Review queue', 'Review queue figures did not load'],
        ['Brands with products waiting', 'Brands with products waiting did not load'],
        ['Publishing to the app', 'Publishing figures did not load'],
        ['Recent decisions', 'Recent decisions did not load'],
      ] as const) {
        // The publishing card also keeps its failed-events warning, a second alert.
        const banner = await within(region(card)).findByText(title, {}, { timeout: 10_000 })
        expect(banner.closest('[role="alert"]')).not.toBeNull()
      }
      // What loaded before stays under each banner.
      const after = within(region('Review queue')).getByRole('group', { name: 'Review queue figures' })
      expect(within(after).getByRole('group', { name: 'Products waiting' }).textContent).toBe(products)
      const list = within(region('Brands with products waiting')).getByRole('list', { name: 'Brands with products waiting' })
      expect(within(list).getByRole('link', { name: /^Kalki Studio/ })).toBeInTheDocument()
      expect(within(region('Publishing to the app')).getByRole('group', { name: 'Publishing figures' })).toBeInTheDocument()
      expect(within(region('Recent decisions')).getByRole('list', { name: 'Recent decisions' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a failed summary in each card that uses it, with its own retry, and keeps the others', async () => {
    server.use(http.get('*/api/v1/admin/summary', () => forbidden('The summary is not available to your role.')))
    renderModule({ route: '/dashboard' })
    await onDashboard()
    for (const [card, title, retry] of [
      ['Review queue', 'Review queue figures did not load', 'Try again to load review queue figures'],
      ['Publishing to the app', 'Publishing figures did not load', 'Try again to load publishing figures'],
      ['Recent decisions', 'Recent decisions did not load', 'Try again to load recent decisions'],
    ] as const) {
      const alert = await within(region(card)).findByRole('alert', {}, { timeout: 10_000 })
      expect(alert).toHaveTextContent(title)
      expect(within(alert).getByRole('button', { name: retry })).toBeEnabled()
    }
    // Three retry buttons, each telling a screen reader which card it reloads.
    const names = screen.getAllByRole('button', { name: /^Try again/ }).map((b) => b.getAttribute('aria-label'))
    expect(names).toHaveLength(3)
    expect(new Set(names).size).toBe(3)
    expect(await figures('Vendors', 'Vendor figures')).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Brands with products waiting' })).toBeInTheDocument()
    expect(within(region('Vendors')).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows each card’s skeleton until its own data arrives', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    // Holds the summary back, then lets the mock answer it.
    server.use(http.get('*/api/v1/admin/summary', async () => {
      await held
    }))
    renderModule({ route: '/dashboard' })
    await onDashboard()
    expect(await figures('Vendors', 'Vendor figures')).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Brands with products waiting' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading review queue figures' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading publishing figures' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading recent decisions' })).toBeInTheDocument()

    release()
    expect(await figures('Review queue', 'Review queue figures')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading recent decisions' })).not.toBeInTheDocument()
  })

  it('says when no products and no decisions wait', async () => {
    const { db } = renderModule({ route: '/dashboard' })
    for (const p of db.products) p.status = 'approved'
    db.decisions.length = 0
    await onDashboard()
    const brands = region('Brands with products waiting')
    expect(await within(brands).findByRole('heading', { name: 'No products waiting' }, { timeout: 10_000 })).toBeInTheDocument()
    expect(within(brands).queryByRole('list')).not.toBeInTheDocument()
    expect(await within(region('Recent decisions')).findByRole('heading', { name: 'No decisions yet' })).toBeInTheDocument()
    expectFigure(await figures('Review queue', 'Review queue figures'), 'Products waiting', 0, '/queue?kind=product')
  })
})

describe('groupByBrand', () => {
  const item = (id: string, vendor: string, hoursAgo: number, kind: S.ItemKind = 'product'): S.QueueItem => ({
    id,
    kind,
    subject_id: id,
    title: id,
    detail: '',
    vendor: { id: vendor, name: vendor.toUpperCase() },
    submitted_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    change: 'new',
    resubmission: 0,
    thumbnail_url: null,
  })

  it('counts products per brand, most first, then the longest wait, and skips other kinds', () => {
    const a2 = item('a2', 'a', 9)
    const b2 = item('b2', 'b', 3)
    const brands = groupByBrand([item('a1', 'a', 1), item('b1', 'b', 2), a2, item('c1', 'c', 30), b2, item('page', 'd', 50, 'brand_page')])
    // a and b both have two; a's oldest has waited longer. c has one, however old.
    expect(brands.map((b) => [b.vendor.id, b.count, b.oldest])).toEqual([
      ['a', 2, a2.submitted_at],
      ['b', 2, b2.submitted_at],
      ['c', 1, expect.any(String)],
    ])
    expect(brands[0]!.vendor).toEqual({ id: 'a', name: 'A' })
  })

  it('is empty when no products wait', () => {
    expect(groupByBrand([item('page', 'd', 5, 'brand_page')])).toEqual([])
  })
})
