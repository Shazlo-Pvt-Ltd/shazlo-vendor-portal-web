import type { ModuleSummary } from '@shazlo/shell-protocol'
import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_ID } from '../mocks/identity'
import { campaigns, catalogue, catalogueSummary } from '../test/modules'
import { renderShell } from '../test/render'
import { server } from '../test/server'

// Home draws each module's summary (ADR 0011). The modules here are stand-ins (src/test/modules.ts):
// what is tested is how the shell draws any summary, not what one module counts.

// Monday 9 Nov 2026, 14:00 IST. The identity seed and the stand-in activity are relative to it.
const NOW = new Date('2026-11-09T14:00:00+05:30')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

// The Catalogue summary for the next render, changed by `change`.
function answer(change: (summary: ModuleSummary) => ModuleSummary) {
  const next = change(structuredClone(catalogueSummary))
  server.use(http.get(catalogue.entry.summaryUrl!, () => HttpResponse.json(next)))
}
const withoutActivity = (s: ModuleSummary) => ({ ...s, activity: s.activity && { ...s.activity, items: [] } })

const region = (name: string) => screen.findByRole('region', { name })
const figure = (card: HTMLElement, label: string) => within(card).findByRole('group', { name: label })

// The icon beside a card's title (decoration, so it is hidden from screen readers).
const headerIcon = (card: HTMLElement) => card.querySelector('h2')!.parentElement!.querySelector('svg')

const semibold = (el: HTMLElement) => {
  const style = getComputedStyle(el)
  return style.fontFamily.includes('Bodoni Moda') && style.fontWeight === '600'
}

describe('A-02 Home: greeting', () => {
  it.each([
    ['2026-11-09T08:15:00+05:30', 'Good morning, Naman'],
    ['2026-11-09T14:00:00+05:30', 'Good afternoon, Naman'],
    ['2026-11-09T19:30:00+05:30', 'Good evening, Naman'],
  ])('greets by the time of day in IST (%s)', async (iso, greeting) => {
    vi.setSystemTime(new Date(iso))
    await renderShell()
    expect(await screen.findByRole('heading', { level: 1, name: greeting })).toBeInTheDocument()
    expect(screen.getByText('Here is what is waiting across Shazlo One.')).toBeInTheDocument()
  })
})

describe('A-02 Home: a module summary', () => {
  it('draws a section with its figures, hints and main action', async () => {
    await renderShell()
    const card = await region('Catalogue review')
    const expected = [
      ['Waiting', '14', 'Listings 9 · Shop pages 2 · Sign-ups 3'],
      ['Waiting over 24 hours', '6', 'Oldest first in the queue'],
      ['Decided today', '1', 'Approved or sent back since midnight'],
      ['Median time to decision', '5 h 20 m', 'From submission to decision'],
    ] as const
    for (const [label, value, hint] of expected) {
      const group = await figure(card, label)
      expect(within(group).getByText(value)).toBeInTheDocument()
      expect(within(group).getByText(hint)).toBeInTheDocument()
    }
    // The first section's action is the module's main one, under the module's base path.
    expect(within(card).getByRole('link', { name: 'Open review queue' })).toHaveAttribute('href', '/catalogue/queue')
    expect(within(card).getByRole('link', { name: 'Open review queue' })).toHaveClass('MuiButton-contained')
  })

  it('links the figures that carry a path, and only those', async () => {
    await renderShell()
    const card = await region('Catalogue review')
    for (const [label, href] of [
      ['Waiting', '/catalogue/queue'],
      ['Waiting over 24 hours', '/catalogue/queue?sort=oldest'],
    ] as const) {
      const link = within(await figure(card, label)).getByRole('link')
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAccessibleName(new RegExp(`^${label}`))
      expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    }
    for (const label of ['Decided today', 'Median time to decision']) {
      const group = await figure(card, label)
      expect(within(group).queryByRole('link')).toBeNull()
      expect(group.querySelector('svg')).toBeNull()
    }
  })

  it('sets the card title, figure labels and values in semibold, with the section icon by the title', async () => {
    await renderShell()
    const card = await region('Catalogue review')
    expect(semibold(within(card).getByRole('heading', { level: 2, name: 'Catalogue review' }))).toBe(true)
    expect(headerIcon(card)).toHaveAttribute('aria-hidden', 'true')
    const waiting = await figure(card, 'Waiting')
    expect(semibold(within(waiting).getByText('Waiting'))).toBe(true)
    expect(semibold(within(waiting).getByText('14'))).toBe(true)
    expect(semibold(within(waiting).getByText('Listings 9 · Shop pages 2 · Sign-ups 3'))).toBe(false)
  })

  it('shows a dash, not a 0, for a figure the module cannot count, and groups large numbers', async () => {
    answer((s) => {
      const [first] = s.sections
      first!.figures[0]!.value = 10_000
      first!.figures[3]!.value = null
      return s
    })
    await renderShell()
    const card = await region('Catalogue review')
    expect(within(await figure(card, 'Waiting')).getByText('10,000')).toBeInTheDocument()
    expect(within(await figure(card, 'Median time to decision')).getByText('—')).toBeInTheDocument()
  })

  it('shows skeletons while the figures load', async () => {
    server.use(
      http.get(catalogue.entry.summaryUrl!, async () => {
        await delay(300)
      }),
    )
    await renderShell()
    expect(await screen.findByRole('status', { name: 'Loading Catalogue figures' })).toBeInTheDocument()
  })

  it('says when the figures did not load, with the module\'s reason, and tries again', async () => {
    // The module stays down until the admin tries again: React Query may refetch a failed query by
    // itself, and a one-off failure would be gone before the test looks.
    let down = true
    server.use(http.get(catalogue.entry.summaryUrl!, () => (down ? HttpResponse.json({ error: { code: 'unavailable', message: 'The catalogue is restarting.', request_id: 'r' } }, { status: 404 }) : undefined)))
    const { user } = await renderShell()
    const alert = (await screen.findByText('Catalogue figures did not load')).closest<HTMLElement>('[role="alert"]')!
    expect(alert).toHaveTextContent('The catalogue is restarting.')
    down = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(within(await figure(await region('Catalogue review'), 'Waiting')).getByText('14')).toBeInTheDocument()
    expect(screen.queryByText('Catalogue figures did not load')).toBeNull()
  })

  it('refuses a summary in a shape it cannot read, rather than showing part of it', async () => {
    answer((s) => ({ ...s, badge: { count: -1, label: 'broken' } }))
    await renderShell()
    const alert = (await screen.findByText('Catalogue figures did not load')).closest<HTMLElement>('[role="alert"]')!
    expect(alert).toHaveTextContent('The module answered in a form Shazlo One cannot read.')
    expect(screen.queryByRole('region', { name: 'Catalogue review' })).toBeNull()
  })
})

describe('A-02 Home: alerts and links into the module', () => {
  it('shows a section alert with its action in place of the header action', async () => {
    await renderShell()
    const card = await region('Publishing to the app')
    const alert = within(card).getByRole('alert')
    expect(alert).toHaveTextContent('1 event did not reach the app. It retries automatically, or you can retry it now.')
    expect(within(alert).getByRole('link', { name: 'Open publishing' })).toHaveAttribute('href', '/catalogue/publishing')
    expect(within(card).getAllByRole('link', { name: 'Open publishing' })).toHaveLength(1)
    expect(headerIcon(card)).toHaveAttribute('aria-hidden', 'true')
  })

  it('links a later section\'s action quietly when there is no alert', async () => {
    answer((s) => ({ ...s, sections: s.sections.map((x) => ({ ...x, alert: null })) }))
    await renderShell()
    const card = await region('Publishing to the app')
    expect(within(card).queryByRole('alert')).toBeNull()
    const open = within(card).getByRole('link', { name: 'Open publishing' })
    expect(open).toHaveAttribute('href', '/catalogue/publishing')
    expect(open).not.toHaveClass('MuiButton-root')
  })

  it('links each figure to the module page it names', async () => {
    await renderShell()
    const card = await region('Publishing to the app')
    for (const [label, status] of [
      ['Delivered in the last 24 h', 'delivered'],
      ['Waiting', 'waiting'],
      ['Retrying', 'retrying'],
      ['Failed', 'failed'],
    ] as const) {
      const links = within(await figure(card, label)).getAllByRole('link')
      expect(links).toHaveLength(1)
      expect(links[0]).toHaveAttribute('href', `/catalogue/publishing?status=${status}`)
    }
  })

  it('opens that page in the module when a figure is clicked', async () => {
    const { user, router } = await renderShell()
    const card = await region('Publishing to the app')
    await user.click(within(await figure(card, 'Failed')).getByRole('link'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalogue/publishing'))
    expect(router.state.location.search).toBe('?status=failed')
    expect((await screen.findByTitle('Catalogue')).getAttribute('src')).toBe('http://catalogue.test/publishing?status=failed')
  })

  it('opens a figure from the keyboard', async () => {
    const { user, router } = await renderShell()
    const card = await region('Publishing to the app')
    const retrying = within(await figure(card, 'Retrying')).getByRole('link')
    retrying.focus()
    expect(retrying).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.search).toBe('?status=retrying'))
  })
})

describe('A-02 Home: activity', () => {
  it('lists the latest activity with who acted and when, each opening its page in the module', async () => {
    await renderShell()
    const card = await region('Recent decisions')
    const rows = await within(card).findAllByRole('listitem')
    const expected = [
      ['Bandhani Silk Dupatta', 'Kalki Studio · Listing', 'Approved', 'by Priya Mehta', '3 h ago', '/catalogue/queue'],
      ['Ajrakh Block-Print Kurta', 'Kalki Studio · Listing', 'Sent back', 'by Priya Mehta', '10 h ago', '/catalogue/queue'],
      ['Kalki Studio shop page', 'Kalki Studio · Shop page', 'Approved', 'by Naman Sinha', 'Yesterday', '/catalogue/review/shop/s_kalki'],
      ['Mor Pankh Clothing', 'Mor Pankh Clothing · Sign-up', 'Approved', 'by Rahul Desai', '6 Nov', '/catalogue/sellers/s_morpankh'],
    ] as const
    expect(rows).toHaveLength(expected.length)
    expected.forEach(([title, subtitle, pill, by, when, href], i) => {
      const row = rows[i]!
      // The whole row is one link: title, subtitle, the status, and who and when.
      const links = within(row).getAllByRole('link')
      expect(links).toHaveLength(1)
      const link = links[0]!
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAccessibleName(new RegExp(`^${title}`))
      expect(link).toHaveTextContent(subtitle)
      expect(link.querySelector('[data-status]')).toHaveTextContent(pill)
      expect(link).toHaveTextContent(by)
      expect(link).toHaveTextContent(when)
      expect(semibold(within(link).getByText(title))).toBe(true)
      // A chevron closes the row.
      const chevron = link.lastElementChild!
      expect(chevron.closest('[data-status]')).toBeNull()
      expect(chevron.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    })
    expect(rows[0]!.querySelector('[data-status]')).toHaveAttribute('data-status', 'live')
    expect(rows[1]!.querySelector('[data-status]')).toHaveAttribute('data-status', 'sentBack')
    expect(headerIcon(card)).toHaveAttribute('aria-hidden', 'true')
  })

  it('says so when there is nothing yet, with no empty rows or chevrons', async () => {
    answer(withoutActivity)
    await renderShell()
    const card = await region('Recent decisions')
    expect(await within(card).findByRole('heading', { name: 'No decisions yet' })).toBeInTheDocument()
    expect(within(card).getByText('Approvals and send-backs show here as reviewers make them.')).toBeInTheDocument()
    expect(within(card).queryAllByRole('link')).toHaveLength(0)
    expect(within(card).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('keeps a long title inside one link', async () => {
    const long = 'Hand-block-printed Ajrakh kurta with natural indigo and madder dyes, mirror work and a contrast placket'
    answer((s) => {
      s.activity!.items[0]!.title = long
      return s
    })
    await renderShell()
    const [first] = await within(await region('Recent decisions')).findAllByRole('listitem')
    const link = within(first!).getByRole('link')
    expect(link).toHaveAccessibleName(new RegExp(`^${long}`))
    expect(getComputedStyle(within(link).getByText(long)).overflowWrap).toBe('anywhere')
  })

  it('opens an item from anywhere on its row', async () => {
    const { user, router } = await renderShell()
    const [, , shopPage] = await within(await region('Recent decisions')).findAllByRole('listitem')
    await user.click(within(shopPage!).getByText('by Naman Sinha', { exact: false }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalogue/review/shop/s_kalki'))
  })

  it('shows an item without a page as a plain row, and leaves out "by" where the module tracks nobody', async () => {
    answer((s) => {
      const [first] = s.activity!.items
      s.activity!.items = [{ id: first!.id, title: first!.title, status: first!.status, at: first!.at }]
      return s
    })
    await renderShell()
    const [row] = await within(await region('Recent decisions')).findAllByRole('listitem')
    expect(within(row!).queryByRole('link')).toBeNull()
    expect(row).toHaveTextContent('3 h ago')
    expect(row).not.toHaveTextContent('by ')
  })
})

describe('#299 Home: names behind the activity', () => {
  it('keeps the figures and says "a former admin" when identity-api cannot be reached for names', async () => {
    server.use(http.get('*/v1/admins/names', () => HttpResponse.json({ error: { code: 'unavailable', message: 'down', request_id: 'r' } }, { status: 503 })))
    await renderShell()
    const rows = await within(await region('Recent decisions')).findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('by a former admin')
    expect(within(await figure(await region('Catalogue review'), 'Waiting')).getByText('14')).toBeInTheDocument()
  })

  it('says "a former admin" for someone identity-api no longer knows, and keeps the others', async () => {
    server.use(
      http.get('*/v1/admins/names', ({ request }) => {
        const ids = new URL(request.url).searchParams.getAll('ids')
        // Priya is gone; the others are still there.
        return HttpResponse.json({ items: ids.filter((id) => id !== ADMIN_ID.priya).map((id) => ({ id, display_name: id === ADMIN_ID.naman ? 'Naman Sinha' : 'Rahul Desai' })) })
      }),
    )
    await renderShell()
    const rows = await within(await region('Recent decisions')).findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('by a former admin')
    expect(rows[2]).toHaveTextContent('by Naman Sinha')
    expect(rows[3]).toHaveTextContent('by Rahul Desai')
  })

  it('keeps the names it had when a later lookup fails, rather than calling everyone "a former admin"', async () => {
    const { context } = await renderShell()
    const list = await region('Recent decisions')
    await waitFor(() => expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('by Priya Mehta'))
    let asked = 0
    server.use(
      http.get('*/v1/admins/names', () => {
        asked += 1
        return HttpResponse.json({ error: { code: 'unavailable', message: 'down', request_id: 'r' } }, { status: 503 })
      }),
    )
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000))
    await act(() => context.queryClient.refetchQueries({ queryKey: ['module-summary', 'catalogue'] }))
    expect(asked).toBe(1)
    await waitFor(() => expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('by Priya Mehta'))
  })

  it('looks the names up once for the refreshes of the next five minutes', async () => {
    let asked = 0
    server.use(
      http.get('*/v1/admins/names', () => {
        asked += 1
      }),
    )
    const { context } = await renderShell()
    await within(await region('Recent decisions')).findAllByRole('listitem')
    await waitFor(() => expect(asked).toBe(1))
    vi.setSystemTime(new Date(NOW.getTime() + 60_000))
    await act(() => context.queryClient.refetchQueries({ queryKey: ['module-summary', 'catalogue'] }))
    expect(asked).toBe(1)
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000))
    await act(() => context.queryClient.refetchQueries({ queryKey: ['module-summary', 'catalogue'] }))
    expect(asked).toBe(2)
  })

  it('asks for each admin once, however many items they acted on', async () => {
    const asked: string[][] = []
    server.use(
      http.get('*/v1/admins/names', ({ request }) => {
        asked.push(new URL(request.url).searchParams.getAll('ids'))
      }),
    )
    await renderShell()
    await within(await region('Recent decisions')).findAllByRole('listitem')
    expect(asked).toHaveLength(1)
    expect(asked[0]).toHaveLength(3)
    expect(new Set(asked[0]).size).toBe(3)
  })

  it('shows an item whose admin was never recorded, without asking for names', async () => {
    let asked = false
    server.use(
      http.get('*/v1/admins/names', () => {
        asked = true
      }),
    )
    answer((s) => {
      s.activity!.items = [{ ...s.activity!.items[1]!, actor_id: null }]
      return s
    })
    await renderShell()
    const rows = await within(await region('Recent decisions')).findAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Sent back')
    expect(rows[0]).toHaveTextContent('by a former admin')
    expect(asked).toBe(false)
  })
})

describe('A-02 Home: roles', () => {
  it('shows a super admin every module, and no Admins card', async () => {
    let asked = false
    server.use(
      http.get('*/v1/admins', () => {
        asked = true
      }),
    )
    await renderShell()
    expect(within(await figure(await region('Catalogue review'), 'Waiting')).getByText('14')).toBeInTheDocument()
    expect(within(await figure(await region('Campaigns'), 'Drafts to approve')).getByText('3')).toBeInTheDocument()
    expect(within(await region('Campaigns')).getByRole('link')).toHaveAttribute('href', '/campaigns/drafts')
    expect(screen.queryByRole('region', { name: 'Admins' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Manage admins' })).toBeNull()
    expect(asked).toBe(false)
  })

  it('shows a reviewer only the modules their role opens, and never asks the others', async () => {
    let asked = false
    server.use(
      http.get(campaigns.entry.summaryUrl!, () => {
        asked = true
      }),
    )
    await renderShell({ as: 'priya' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Good afternoon, Priya' })).toBeInTheDocument()
    expect(within(await figure(await region('Catalogue review'), 'Waiting')).getByText('14')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Campaigns' })).toBeNull()
    expect(asked).toBe(false)
  })

  it('tells an admin without module roles that there is nothing here yet', async () => {
    const { context } = await renderShell({ as: 'priya' })
    await screen.findByRole('heading', { level: 1, name: 'Good afternoon, Priya' })
    const admin = context.session.get().admin!
    act(() => context.session.adopt({ access_token: context.session.accessToken()!, expires_in: 900, admin: { ...admin, roles: [] } }))
    expect(await screen.findByRole('heading', { name: 'No modules for your role yet' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Catalogue review' })).toBeNull()
  })
})
