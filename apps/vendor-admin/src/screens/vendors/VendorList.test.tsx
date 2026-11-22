import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderModule } from '../../test/render'
import { server } from '../../test/server'
import { isSecondary, isSemibold } from '../../test/style'

type Rendered = ReturnType<typeof renderModule>
type User = Rendered['user']

const LIST = '*/api/v1/admin/vendors'

async function table() {
  return screen.findByRole('table', { name: 'Vendors' })
}

// Data rows only (the first row holds the column headers).
function rows(t: HTMLElement) {
  return within(t).getAllByRole('row').slice(1)
}

function brands(t: HTMLElement) {
  return rows(t).map((r) => within(r).getAllByRole('link')[0]!.textContent)
}

async function waitForBrands(expected: string[]) {
  const t = await table()
  await waitFor(() => {
    expect(t).not.toHaveAttribute('aria-busy', 'true')
    expect(brands(t)).toEqual(expected)
  })
  return t
}

function row(t: HTMLElement, brand: string) {
  return within(t).getByRole('link', { name: brand }).closest('tr')!
}

// The router's location moves before React renders the page it names (route changes render in a
// transition). Wait for the page itself, so no route change is still pending when the test clicks.
async function onPage(name: string) {
  return screen.findByRole('heading', { level: 1, name }, { timeout: 10_000 })
}

async function backToList(router: Rendered['router']) {
  await router.navigate('/vendors')
  await onPage('Vendors')
  return waitForBrands(ALL)
}

function params(router: Rendered['router']) {
  return new URLSearchParams(router.state.location.search)
}

async function choose(user: User, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

// jsdom's Blob has no text(); FileReader gives the raw bytes, byte-order mark included.
function readBytes(blob: Blob) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

const ALL = [
  'Ambar Textiles',
  'Bandhej House',
  'Indigo Loom',
  'Kaaya Ethnic',
  'Kalki Studio',
  'Kesariya Prints',
  'Kutch Kala',
  'Mor Pankh Clothing',
  'Nila Handloom',
  'QuickFashion Hub',
  'Rangrez Studio',
  'Rann Weaves',
  'Saanjh Label',
  'Sutra Collective',
  'Trendz Outlet',
]

// Screens render the full MUI tree and these tests read computed styles; give a busy machine room.
describe('A-08 Vendors', { timeout: 40_000 }, () => {
  it('lists the 15 seed vendors with owner, status, since and commission', async () => {
    const { shell } = renderModule({ route: '/vendors' })
    // The first screen in a file compiles on demand; give it room on a busy machine.
    expect(await screen.findByRole('heading', { level: 1, name: 'Vendors' }, { timeout: 10_000 })).toBeInTheDocument()
    const t = await waitForBrands(ALL)
    expect(await screen.findByText('15 brands · 3 applications waiting')).toBeInTheDocument()
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/vendors', title: 'Vendors' }))

    for (const name of ['Brand', 'Owner', 'Sells', 'Live products', 'Status', 'Since', 'Commission']) {
      expect(isSemibold(within(t).getByRole('columnheader', { name }))).toBe(true)
    }
    const kalki = row(t, 'Kalki Studio')
    expect(isSemibold(within(kalki).getByRole('link', { name: 'Kalki Studio' }))).toBe(true)
    expect(isSecondary(within(kalki).getByText('Ahmedabad, Gujarat'))).toBe(true)
    expect(within(kalki).getByText('Ahmedabad, Gujarat')).toBeInTheDocument()
    expect(within(kalki).getByText('Kiran Shah')).toBeInTheDocument()
    expect(within(kalki).getByText('Women')).toBeInTheDocument()
    expect(within(kalki).getByText('18')).toBeInTheDocument()
    expect(within(kalki).getByText('Approved')).toBeInTheDocument()
    expect(within(kalki).getByText('12%')).toBeInTheDocument()
    expect(within(kalki).getByRole('button', { name: 'Actions for Kalki Studio' })).toBeInTheDocument()

    expect(within(row(t, 'Bandhej House')).getByText('12%')).toBeInTheDocument()
    const rann = row(t, 'Rann Weaves')
    expect(within(rann).getByText('Applied')).toBeInTheDocument()
    expect(within(rann).getByText('Not set')).toBeInTheDocument()
    expect(within(rann).getByText('Women and men')).toBeInTheDocument()
    // An application is opened from its row like any vendor; it has no row menu.
    expect(within(rann).getAllByRole('link').map((l) => l.textContent)).toEqual(['Rann Weaves'])
    expect(within(rann).queryByRole('button')).not.toBeInTheDocument()
    expect(within(row(t, 'Kaaya Ethnic')).getByText('More info asked')).toBeInTheDocument()
    expect(within(row(t, 'QuickFashion Hub')).getByText('Rejected')).toBeInTheDocument()
    expect(within(row(t, 'Trendz Outlet')).getByText('Suspended')).toBeInTheDocument()

    const tabs = screen.getByRole('tablist', { name: 'Vendor status' })
    expect(within(tabs).getByRole('tab', { name: 'All 15' })).toHaveAttribute('aria-selected', 'true')
    expect(within(tabs).getByRole('tab', { name: 'Applied 2' })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: 'More info asked 1' })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: 'Rate to review 3' })).toBeInTheDocument()
    const proposal = within(row(t, 'Indigo Loom')).getByText('10% proposed')
    expect(proposal).toHaveAttribute('data-status', 'pending')
    expect(within(row(t, 'Sutra Collective')).getByText('15%')).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: 'Approved 10' })).toBeInTheDocument()
  })

  it('filters by status tab through the URL', async () => {
    const { user, router } = renderModule({ route: '/vendors' })
    await waitForBrands(ALL)
    await user.click(screen.getByRole('tab', { name: 'Applied 2' }))
    await waitForBrands(['Rann Weaves', 'Saanjh Label'])
    expect(params(router).get('status')).toBe('applied')
    expect(screen.getByRole('tab', { name: 'Applied 2' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: 'All 15' }))
    await waitForBrands(ALL)
    expect(params(router).has('status')).toBe(false)
  })

  it('finds the brands whose proposed rate waits, through the URL', async () => {
    const { user, router } = renderModule({ route: '/vendors?status=approved' })
    await waitForBrands(['Ambar Textiles', 'Bandhej House', 'Indigo Loom', 'Kalki Studio', 'Kesariya Prints', 'Kutch Kala', 'Mor Pankh Clothing', 'Nila Handloom', 'Rangrez Studio', 'Sutra Collective'])
    await user.click(screen.getByRole('tab', { name: 'Rate to review 3' }))
    const t = await waitForBrands(['Indigo Loom', 'Rangrez Studio', 'Saanjh Label'])
    expect(params(router).get('commission')).toBe('proposed')
    expect(params(router).has('status')).toBe(false)
    expect(screen.getByRole('tab', { name: 'Rate to review 3' })).toHaveAttribute('aria-selected', 'true')
    expect(within(row(t, 'Rangrez Studio')).getByText('12% proposed')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Approved 10' }))
    await waitFor(() => expect(params(router).get('status')).toBe('approved'))
    expect(params(router).has('commission')).toBe(false)
  })

  it('says when no rate waits', async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ items: [], counts: { all: 12, applied: 0, under_review: 0, approved: 12, rejected: 0, suspended: 0, rate_to_review: 0 }, cities: [] })))
    renderModule({ route: '/vendors?commission=proposed' })
    expect(await screen.findByRole('heading', { name: 'No rates to review' })).toBeInTheDocument()
  })

  // Starts inside one city so each re-render stays small on a busy machine.
  it('searches by owner after typing stops, and clears the search', async () => {
    const { user, router } = renderModule({ route: '/vendors?city=Bhuj%2C+Gujarat' })
    const bhuj = ['Bandhej House', 'Kutch Kala', 'Rann Weaves']
    await waitForBrands(bhuj)
    const search = screen.getByRole('textbox', { name: 'Search brand, owner, email or phone' })
    await user.type(search, 'aarti')
    await waitForBrands(['Rann Weaves'])
    expect(params(router).get('q')).toBe('aarti')
    expect(search).toHaveValue('aarti')

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveValue('')
    await waitForBrands(bhuj)
    expect(params(router).has('q')).toBe(false)
    expect(params(router).get('city')).toBe('Bhuj, Gujarat')
  })

  it('filters by city and sorts through the URL', async () => {
    const { user, router } = renderModule({ route: '/vendors' })
    await waitForBrands(ALL)
    await choose(user, 'City', 'Bhuj, Gujarat')
    await waitForBrands(['Bandhej House', 'Kutch Kala', 'Rann Weaves'])
    expect(params(router).get('city')).toBe('Bhuj, Gujarat')

    await choose(user, 'City', 'All cities')
    await waitForBrands(ALL)
    await choose(user, 'Sort', 'Most live products')
    expect(params(router).get('sort')).toBe('products')
    const t = await table()
    await waitFor(() => expect(brands(t).slice(0, 3)).toEqual(['Kesariya Prints', 'Nila Handloom', 'Rangrez Studio']))
  })

  it('reads its filters from the URL on load', async () => {
    renderModule({ route: '/vendors?status=approved&city=Jaipur%2C+Rajasthan&sort=newest' })
    await waitForBrands(['Mor Pankh Clothing', 'Kesariya Prints'])
    expect(screen.getByRole('tab', { name: 'Approved 10' })).toHaveAttribute('aria-selected', 'true')
  })

  it('makes each whole row one link to the vendor, cued by a chevron, with the menu above it', async () => {
    renderModule({ route: '/vendors' })
    const t = await waitForBrands(ALL)
    for (const r of rows(t)) {
      const links = within(r).getAllByRole('link')
      expect(links).toHaveLength(1)
      expect(links[0]).toHaveAttribute('data-stretch')
      expect(getComputedStyle(r).position).toBe('relative')
      expect(getComputedStyle(r).cursor).toBe('pointer')
      expect(r.querySelector('[data-chevron]')!.closest('[aria-hidden="true"]')).not.toBeNull()
    }
    expect(within(t).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Brand', 'Owner', 'Sells', 'Live products', 'Status', 'Since', 'Commission', 'Actions'])
    // The row menu is a separate control beside the link, never inside it, and sits above its cover.
    const menu = within(row(t, 'Kalki Studio')).getByRole('button', { name: 'Actions for Kalki Studio' })
    expect(menu.closest('a')).toBeNull()
    expect(getComputedStyle(menu).position).toBe('relative')
    expect(getComputedStyle(menu).zIndex).toBe('1')
  })

  it('opens the vendor from its row, its link or the keyboard, and applications the same way', async () => {
    const { user, router } = renderModule({ route: '/vendors' })
    const t = await waitForBrands(ALL)
    await user.click(within(row(t, 'Kalki Studio')).getByText('Kiran Shah'))
    await onPage('Kalki Studio')
    expect(router.state.location.pathname).toBe('/vendors/v_kalki')

    const again = await backToList(router)
    await user.click(within(row(again, 'Rann Weaves')).getByRole('link', { name: 'Rann Weaves' }))
    await onPage('Rann Weaves')
    expect(router.state.location.pathname).toBe('/vendors/v_rann')

    const third = await backToList(router)
    within(third).getByRole('link', { name: 'Saanjh Label' }).focus()
    await user.keyboard('{Enter}')
    await onPage('Saanjh Label')
    expect(router.state.location.pathname).toBe('/vendors/v_saanjh')
  })

  it('opens the row menu without opening the vendor', async () => {
    const { user, router } = renderModule({ route: '/vendors' })
    const t = await waitForBrands(ALL)
    await user.click(within(row(t, 'Kalki Studio')).getByRole('button', { name: 'Actions for Kalki Studio' }))
    expect(await screen.findByRole('menuitem', { name: 'Suspend' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/vendors')
    await user.click(screen.getByRole('menuitem', { name: 'Open' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/vendors/v_kalki'))
  })

  it('suspends an approved vendor with a reason', async () => {
    const { user, db, shell } = renderModule({ route: '/vendors' })
    const t = await waitForBrands(ALL)
    await user.click(within(row(t, 'Kalki Studio')).getByRole('button', { name: 'Actions for Kalki Studio' }))
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Reactivate' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Suspend' }))

    const dialog = await screen.findByRole('dialog', { name: 'Suspend Kalki Studio?' })
    expect(within(dialog).getByText('Suspending hides all of their products from the app at once and pauses new orders.')).toBeInTheDocument()
    const reason = within(dialog).getByRole('textbox', { name: 'Reason for suspending' })
    await user.type(reason, 'Too short')
    await user.click(within(dialog).getByRole('button', { name: 'Suspend vendor' }))
    expect(await within(dialog).findByText('Write at least 10 characters.')).toBeInTheDocument()
    expect(reason).toHaveFocus()
    expect(db.vendors.find((v) => v.id === 'v_kalki')!.status).toBe('approved')

    await user.type(reason, ' — orders shipped late three times')
    await user.click(within(dialog).getByRole('button', { name: 'Suspend vendor' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const kalki = db.vendors.find((v) => v.id === 'v_kalki')!
    expect(kalki.status).toBe('suspended')
    expect(kalki.history[0]).toMatchObject({ event: 'suspended', note: 'Too short — orders shipped late three times' })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Suspended Kalki Studio' })
    await waitFor(() => expect(within(row(t, 'Kalki Studio')).getByText('Suspended')).toBeInTheDocument())
  })

  it('reactivates a suspended vendor after confirming', async () => {
    const { user, db, shell } = renderModule({ route: '/vendors?status=suspended' })
    const t = await waitForBrands(['Trendz Outlet'])
    await user.click(within(row(t, 'Trendz Outlet')).getByRole('button', { name: 'Actions for Trendz Outlet' }))
    expect(screen.queryByRole('menuitem', { name: 'Suspend' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Reactivate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reactivate Trendz Outlet?' })
    await user.click(within(dialog).getByRole('button', { name: 'Reactivate vendor' }))
    await waitFor(() => expect(db.vendors.find((v) => v.id === 'v_trendz')!.status).toBe('approved'))
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Reactivated Trendz Outlet' })
    expect(await screen.findByText('No suspended vendors')).toBeInTheDocument()
  })

  it('tells the shell when an action fails', async () => {
    server.use(http.post('*/api/v1/admin/vendors/:id/reactivate', () => HttpResponse.json({ message: 'Only suspended vendors can be reactivated.', extra: { code: 'invalid_transition' } }, { status: 409 })))
    const { user, shell } = renderModule({ route: '/vendors?status=suspended' })
    const t = await waitForBrands(['Trendz Outlet'])
    await user.click(within(row(t, 'Trendz Outlet')).getByRole('button', { name: 'Actions for Trendz Outlet' }))
    await user.click(screen.getByRole('menuitem', { name: 'Reactivate' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivate vendor' }))
    await waitFor(() => expect(shell.toasts()).toContainEqual({ level: 'error', message: 'Only suspended vendors can be reactivated.' }))
  })

  it('exports the listed rows as a CSV file', async () => {
    const created: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      created.push(blob as Blob)
      return 'blob:vendors'
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { user, shell } = renderModule({ route: '/vendors' })
    await waitForBrands(ALL)
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))

    expect(click).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(1)
    const bytes = await readBytes(created[0]!)
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const lines = new TextDecoder().decode(bytes).trim().split('\r\n')
    expect(lines[0]).toBe('Brand,Owner,Email,Phone,City,Sells,Status,Live products,Since,Commission')
    expect(lines).toHaveLength(16)
    expect(lines.find((l) => l.startsWith('Kalki Studio'))).toMatch(/^Kalki Studio,Kiran Shah,kiran@kalkistudio\.in,.*,"Ahmedabad, Gujarat",Women,Approved,18,.*,12%$/)
    expect(lines.find((l) => l.startsWith('Indigo Loom'))).toMatch(/,Women and men,Approved,12,.*,12% · 10% proposed$/)
    expect(lines.find((l) => l.startsWith('Rann Weaves'))).toMatch(/,Applied,0,.*,Not set$/)
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Exported 15 vendors' })
  })

  it('shows no results with a way to clear the filters', async () => {
    const { user, router } = renderModule({ route: '/vendors?q=nobody-here&city=Delhi' })
    expect(await screen.findByRole('heading', { name: 'No vendors match' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitForBrands(ALL)
    expect(params(router).toString()).toBe('')
  })

  it('shows an empty state for a quiet tab', async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ items: [], counts: { all: 12, applied: 0, under_review: 0, approved: 12, rejected: 0, suspended: 0, rate_to_review: 0 }, cities: [] })))
    renderModule({ route: '/vendors?status=applied' })
    expect(await screen.findByRole('heading', { name: 'No new applications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all vendors' })).toBeInTheDocument()
  })

  it('shows a skeleton while loading, then an error with Try again', async () => {
    let fail = true
    server.use(
      http.get(LIST, () => {
        if (fail) return HttpResponse.json({ message: 'Database is down.', extra: { code: 'unavailable' } }, { status: 400 })
        return undefined
      }),
    )
    const { user } = renderModule({ route: '/vendors' })
    expect(await screen.findByRole('table', { name: 'Vendors' })).toHaveAttribute('aria-busy', 'true')
    expect(await screen.findByText('We could not load vendors')).toBeInTheDocument()
    expect(screen.getByText('Database is down.')).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitForBrands(ALL)
  })
})
