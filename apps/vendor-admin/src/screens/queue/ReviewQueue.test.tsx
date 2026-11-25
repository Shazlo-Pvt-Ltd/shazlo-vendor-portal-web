import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { renderModule } from '../../test/render'
import { server } from '../../test/server'
import { isSecondary, isSemibold } from '../../test/style'

type Rendered = ReturnType<typeof renderModule>
type Router = Rendered['router']
type User = Rendered['user']

// Seed (packages/mock-vendor-api): 9 products, 2 brand pages and 3 applications wait, oldest
// first: Kaaya Ethnic (applied 4 days ago) down to the Ajrakh kurta (resubmitted 2 h ago).
const OLDEST_FIRST = [
  'Kaaya Ethnic',
  'Rann Weaves',
  'Patola Silk Stole',
  'Bandhej Cotton Saree — Rani',
  'Phulkari Dupatta — Mustard',
  'Mor Pankh Clothing brand page',
  'Saanjh Label',
  'Handloom Cotton Shirt — Rust',
  'Dabu Print Wrap Skirt',
  'Mirror-Work Potli Bag',
  'Pochampally Ikat Kurta',
  'Nila Handloom brand page',
  'Indigo Dabu Kurta Set',
  'Ajrakh Block-Print Kurta',
]

async function queueTable() {
  // The first visit compiles the screen's chunk; give it room on a busy machine.
  return screen.findByRole('table', { name: 'Items waiting for review' }, { timeout: 10_000 })
}

// Data rows only (the first row holds the column headers).
function rows(table: HTMLElement) {
  return within(table).getAllByRole('row').slice(1)
}

// Each row is one link, named after its item.
function titles(table: HTMLElement) {
  return rows(table).map((r) => within(r).getByRole('link').textContent)
}

async function waitForTitles(expected: string[]) {
  const table = await queueTable()
  await waitFor(() => {
    expect(table).not.toHaveAttribute('aria-busy', 'true')
    expect(titles(table)).toEqual(expected)
  }, { timeout: 10_000 })
  return table
}

// The router's location moves before React renders the page it names (route changes render in a
// transition). Wait for the page itself, so no route change is still pending when the test clicks:
// a pending commit would replace the queue under the click.
async function onPage(name: string) {
  return screen.findByRole('heading', { level: 1, name }, { timeout: 10_000 })
}

async function backToQueue(router: Router) {
  await router.navigate(-1)
  await onPage('Review queue')
  expect(router.state.location.pathname).toBe('/queue')
  return waitForTitles(OLDEST_FIRST)
}

function row(table: HTMLElement, title: string) {
  return within(table).getByRole('link', { name: title }).closest('tr')!
}

function params(router: Router) {
  return new URLSearchParams(router.state.location.search)
}

async function choose(user: User, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

// Every queue request the screen makes, so tests can check what was asked for.
function trackQueueRequests() {
  const seen: URLSearchParams[] = []
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url)
    if (url.pathname === '/api/v1/admin/queue') seen.push(url.searchParams)
  }
  server.events.on('request:start', listener)
  onTestFinished(() => {
    server.events.removeListener('request:start', listener)
  })
  return seen
}

describe('A-04 Review queue', { timeout: 40_000 }, () => {
  it('names itself to the shell and shows the queue with its figures', async () => {
    const { shell, db } = renderModule({ route: '/queue' })
    // The first screen in a file compiles on demand; give it room on a busy machine.
    expect(await screen.findByRole('heading', { level: 1, name: 'Review queue' }, { timeout: 10_000 })).toBeInTheDocument()
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/queue', title: 'Review queue' }))
    expect(await screen.findByText('14 waiting · oldest has waited 4 d 0 h')).toBeInTheDocument()

    const waiting = await screen.findByRole('group', { name: 'Waiting' })
    await waitFor(() => expect(within(waiting).getByText('14')).toBeInTheDocument())
    expect(within(waiting).getByText('Products 9 · Brand pages 2 · Applications 3')).toBeInTheDocument()
    const today = new Date().toISOString().slice(0, 10)
    const decided = db.decisions.filter((d) => d.at.slice(0, 10) === today).length
    expect(within(screen.getByRole('group', { name: 'Decided today' })).getByText(String(decided))).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Median time to decision' })).getByText('5 h 20 m')).toBeInTheDocument()
    const resubmissions = screen.getByRole('group', { name: 'Resubmissions waiting' })
    expect(within(resubmissions).getByText('2')).toBeInTheDocument()
    expect(within(resubmissions).getByText('Sent back before, now fixed')).toBeInTheDocument()

    const tabs = screen.getByRole('tablist', { name: 'Item type' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['All 14', 'Products 9', 'Brand pages 2', 'Vendor applications 3'])

    const table = await waitForTitles(OLDEST_FIRST)
    // Column headings in semibold; the chevron column is hidden from screen readers.
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Item', 'Vendor', 'Submitted', 'Waiting', 'Type'])
    for (const name of ['Item', 'Vendor', 'Submitted', 'Waiting', 'Type']) {
      expect(isSemibold(within(table).getByRole('columnheader', { name }))).toBe(true)
    }

    const ajrakh = row(table, 'Ajrakh Block-Print Kurta')
    // The title in semibold; the code under it regular, in the secondary ink.
    expect(isSemibold(within(ajrakh).getByRole('link', { name: 'Ajrakh Block-Print Kurta' }))).toBe(true)
    expect(isSecondary(within(ajrakh).getByText('KS-AJR-014'))).toBe(true)
    expect(within(ajrakh).getByText('KS-AJR-014')).toBeInTheDocument()
    expect(within(ajrakh).getByText('Kalki Studio')).toBeInTheDocument()
    expect(within(ajrakh).getByText(/^(Today|Yesterday), \d\d:\d\d$/)).toBeInTheDocument()
    expect(within(ajrakh).getByText('2 h')).toBeInTheDocument()
    expect(within(ajrakh).getByText('Resubmission #1')).toBeInTheDocument()

    // Over a day: the wait is flagged.
    const patola = row(table, 'Patola Silk Stole')
    expect(within(patola).getByText('34 h')).toHaveAttribute('data-overdue', 'true')
    expect(within(ajrakh).getByText('2 h')).not.toHaveAttribute('data-overdue')

    expect(within(row(table, 'Handloom Cotton Shirt — Rust')).getByText('Edit to live product')).toBeInTheDocument()
    expect(within(row(table, 'Nila Handloom brand page')).getByText('Edit to live page')).toBeInTheDocument()
    expect(within(row(table, 'Mor Pankh Clothing brand page')).getAllByText('First brand page')).toHaveLength(2)
    expect(within(row(table, 'Mirror-Work Potli Bag')).getByText('New product')).toBeInTheDocument()
    const kaaya = row(table, 'Kaaya Ethnic')
    expect(within(kaaya).getByText('Application')).toBeInTheDocument()
    expect(isSecondary(within(kaaya).getByText('Vendor application · Hyderabad, Telangana'))).toBe(true)
    expect(within(kaaya).getByText('KE')).toBeInTheDocument()
  })

  it('makes each whole row one link to its item, cued by a chevron', async () => {
    renderModule({ route: '/queue' })
    const table = await waitForTitles(OLDEST_FIRST)
    for (const r of rows(table)) {
      // One link and nothing else to press: no Review button beside it, nothing nested.
      expect(within(r).getAllByRole('link')).toHaveLength(1)
      expect(within(r).queryByRole('button')).toBeNull()
      // The link's cover spans the row, which shows a pointer and holds a decorative chevron.
      expect(within(r).getByRole('link')).toHaveAttribute('data-stretch')
      expect(getComputedStyle(r).position).toBe('relative')
      expect(getComputedStyle(r).cursor).toBe('pointer')
      expect(r.querySelector('[data-chevron]')!.closest('[aria-hidden="true"]')).not.toBeNull()
    }
    expect(within(table).getByRole('link', { name: 'Ajrakh Block-Print Kurta' })).toHaveAttribute('href', '/review/product/p_ajrakh')
    expect(within(table).getByRole('link', { name: 'Nila Handloom brand page' })).toHaveAttribute('href', '/review/brand/v_nila')
    expect(within(table).getByRole('link', { name: 'Kaaya Ethnic' })).toHaveAttribute('href', '/vendors/v_kaaya')
  })

  it('opens an item from the keyboard: Tab reaches each title link, Enter opens it', async () => {
    const { user, router } = renderModule({ route: '/queue' })
    const table = await waitForTitles(OLDEST_FIRST)
    const first = within(table).getByRole('link', { name: 'Kaaya Ethnic' })
    first.focus()
    await user.tab()
    // The next stop is the next row's link: no Review button in between.
    expect(within(table).getByRole('link', { name: 'Rann Weaves' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/vendors/v_rann'))
  })

  it('points to the commission rates brands proposed, which are decided on the vendor', async () => {
    const { user, router } = renderModule({ route: '/queue' })
    const line = await screen.findByText('3 brands proposed a commission rate.', undefined, { timeout: 10_000 })
    const link = within(line.parentElement!).getByRole('link', { name: 'Review rates' })
    expect(link).toHaveAttribute('href', '/vendors?commission=proposed')
    await user.click(link)
    await waitFor(() => expect(router.state.location.pathname).toBe('/vendors'))
    expect(new URLSearchParams(router.state.location.search).get('commission')).toBe('proposed')

  })

  it('has no rates line when no proposal waits', async () => {
    const { db } = renderModule({ route: '/queue' })
    for (const v of db.vendors) if (v.commission.state === 'proposed') v.commission.state = 'agreed'
    const waiting = await screen.findByRole('group', { name: 'Waiting' }, { timeout: 10_000 })
    await waitFor(() => expect(within(waiting).getByText('14')).toBeInTheDocument())
    expect(screen.queryByText(/proposed a commission rate/)).not.toBeInTheDocument()
  })

  it('switches type tabs through the URL, so back and links keep them', async () => {
    const { user, router } = renderModule({ route: '/queue' })
    await waitForTitles(OLDEST_FIRST)
    await user.click(screen.getByRole('tab', { name: 'Brand pages 2' }))
    expect(params(router).get('kind')).toBe('brand_page')
    await waitForTitles(['Mor Pankh Clothing brand page', 'Nila Handloom brand page'])
    expect(screen.getByRole('tab', { name: 'Brand pages 2' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: 'Vendor applications 3' }))
    await waitForTitles(['Kaaya Ethnic', 'Rann Weaves', 'Saanjh Label'])

    await router.navigate(-1)
    await waitForTitles(['Mor Pankh Clothing brand page', 'Nila Handloom brand page'])
  })

  it('opens on the filters in the link', async () => {
    renderModule({ route: '/queue?kind=product&vendor=v_kalki&sort=newest' })
    await waitForTitles(['Ajrakh Block-Print Kurta', 'Pochampally Ikat Kurta', 'Dabu Print Wrap Skirt', 'Handloom Cotton Shirt — Rust'])
    expect(screen.getByRole('tab', { name: 'Products 9' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('combobox', { name: 'Vendor' })).toHaveTextContent('Kalki Studio')
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('Newest first')
  })

  it('searches item, vendor or SKU once typing pauses', async () => {
    const seen = trackQueueRequests()
    const { user, router } = renderModule({ route: '/queue' })
    await waitForTitles(OLDEST_FIRST)
    const before = seen.length
    await user.type(screen.getByRole('textbox', { name: 'Search item, vendor or SKU' }), 'AT-PAT')
    await waitFor(() => expect(params(router).get('q')).toBe('AT-PAT'))
    await waitForTitles(['Patola Silk Stole'])
    // One request for the whole word, not one per letter.
    expect(seen.slice(before).filter((s) => s.get('q'))).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitForTitles(OLDEST_FIRST)
    expect(params(router).get('q')).toBeNull()
  })

  it('filters by vendor, submitted time and resubmissions, and sorts', async () => {
    const { user, router } = renderModule({ route: '/queue' })
    await waitForTitles(OLDEST_FIRST)

    await choose(user, 'Vendor', 'Kalki Studio')
    expect(params(router).get('vendor')).toBe('v_kalki')
    await waitForTitles(['Handloom Cotton Shirt — Rust', 'Dabu Print Wrap Skirt', 'Pochampally Ikat Kurta', 'Ajrakh Block-Print Kurta'])

    await choose(user, 'Sort', 'Newest first')
    expect(params(router).get('sort')).toBe('newest')
    await waitForTitles(['Ajrakh Block-Print Kurta', 'Pochampally Ikat Kurta', 'Dabu Print Wrap Skirt', 'Handloom Cotton Shirt — Rust'])

    await choose(user, 'Vendor', 'All vendors')
    await choose(user, 'Sort', 'Oldest first')
    expect(params(router).get('vendor')).toBeNull()
    expect(params(router).get('sort')).toBeNull()

    await choose(user, 'Submitted', '24–48 h ago')
    expect(params(router).get('submitted')).toBe('24h')
    await waitForTitles(['Patola Silk Stole', 'Bandhej Cotton Saree — Rani', 'Phulkari Dupatta — Mustard', 'Mor Pankh Clothing brand page', 'Saanjh Label'])
    await choose(user, 'Submitted', 'Older')
    await waitForTitles(['Kaaya Ethnic', 'Rann Weaves'])
    await choose(user, 'Submitted', 'Any time')
    expect(params(router).get('submitted')).toBeNull()

    await user.click(screen.getByRole('switch', { name: 'Resubmissions only' }))
    expect(params(router).get('resubmissions')).toBe('true')
    await waitForTitles(['Patola Silk Stole', 'Ajrakh Block-Print Kurta'])
    expect(screen.getByRole('switch', { name: 'Resubmissions only' })).toBeChecked()
  })

  it('opens each kind of item where it is reviewed', async () => {
    const { user, router } = renderModule({ route: '/queue' })
    const table = await waitForTitles(OLDEST_FIRST)

    // A click anywhere on the row opens the item (jsdom draws no cover, so this is the fallback).
    await user.click(within(row(table, 'Ajrakh Block-Print Kurta')).getByText('Kalki Studio'))
    await onPage('Ajrakh Block-Print Kurta')
    expect(router.state.location.pathname).toBe('/review/product/p_ajrakh')
    expect(router.state.historyAction).toBe('PUSH')
    const again = await backToQueue(router)

    await user.click(within(again).getByRole('link', { name: 'Nila Handloom brand page' }))
    await onPage('Nila Handloom · brand page')
    expect(router.state.location.pathname).toBe('/review/brand/v_nila')
    // One click, one history entry: back returns to the queue.
    const third = await backToQueue(router)

    await user.click(within(third).getByRole('link', { name: 'Kaaya Ethnic' }))
    await onPage('Kaaya Ethnic')
    expect(router.state.location.pathname).toBe('/vendors/v_kaaya')
  })

  it('exports the listed rows as a CSV file', async () => {
    const blobs: Blob[] = []
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:review-queue'
    })
    const downloads: { download: string; href: string }[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ download: this.download, href: this.href })
    })
    onTestFinished(() => {
      create.mockRestore()
      click.mockRestore()
    })

    const { user, shell } = renderModule({ route: '/queue?vendor=v_kalki' })
    await waitForTitles(['Handloom Cotton Shirt — Rust', 'Dabu Print Wrap Skirt', 'Pochampally Ikat Kurta', 'Ajrakh Block-Print Kurta'])
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))

    await waitFor(() => expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Exported 4 rows' }))
    expect(downloads).toEqual([{ download: expect.stringMatching(/^review-queue-\d{4}-\d{2}-\d{2}\.csv$/), href: 'blob:review-queue' }])
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blobs[0]!)
    })
    const lines = text.replace(/^\uFEFF/, '').trim().split('\r\n')
    expect(lines[0]).toBe('Item,Detail,Type,Vendor,Submitted at,Waiting')
    expect(lines).toHaveLength(5)
    expect(lines[1]).toMatch(/^Handloom Cotton Shirt — Rust,KS-HCS-003,Edit to live product,Kalki Studio,\d{4}-\d{2}-\d{2}T/)
  })

  it('says when nothing is waiting', async () => {
    const { db } = renderModule({ route: '/queue' })
    for (const p of db.products) p.status = 'approved'
    for (const b of db.brands) b.status = 'approved'
    for (const v of db.vendors) if (v.status === 'applied' || v.status === 'under_review') v.status = 'approved'

    expect(await screen.findByRole('heading', { name: 'Nothing waiting' })).toBeInTheDocument()
    expect(screen.getByText('Nice work')).toBeInTheDocument()
    expect(screen.getByText('Nothing is waiting for a decision.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })

  it('says when filters match nothing, and clears them', async () => {
    const { user, router } = renderModule({ route: '/queue?q=zzz&submitted=older' })
    expect(await screen.findByRole('heading', { name: 'No items match these filters' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitForTitles(OLDEST_FIRST)
    expect(params(router).toString()).toBe('')
  })

  it('shows a load error with a way to try again', async () => {
    server.use(http.get('*/api/v1/admin/queue', () => HttpResponse.json({ error: { code: 'forbidden', message: 'The queue is not available to your role.', request_id: 'r' } }, { status: 403 })))
    const { user } = renderModule({ route: '/queue' })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The review queue did not load')
    expect(alert).toHaveTextContent('The queue is not available to your role.')

    server.resetHandlers()
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitForTitles(OLDEST_FIRST)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
