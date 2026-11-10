import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderModule } from '../test/render'
import { setViewport } from '../test/viewport'

// On a phone the lists are cards: one list item per row, the same facts, and a link (or button)
// named after the item that opens it. No table is drawn.
beforeEach(() => setViewport(390))

async function cardList(name: string) {
  // The first visit compiles the screen's chunk; give it room on a busy machine.
  const list = await screen.findByRole('list', { name }, { timeout: 10_000 })
  await waitFor(() => expect(list).not.toHaveAttribute('aria-busy', 'true'), { timeout: 10_000 })
  return list
}

const card = (list: HTMLElement, name: string) => within(list).getByRole('link', { name }).closest('li')!

describe('Phone layout', { timeout: 40_000 }, () => {
  it('shows the review queue as cards that open the item', async () => {
    const { user, router } = renderModule({ route: '/queue' })
    const list = await cardList('Items waiting for review')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(14))

    const ajrakh = card(list, 'Ajrakh Block-Print Kurta')
    expect(within(ajrakh).getByRole('link', { name: 'Ajrakh Block-Print Kurta' })).toHaveAttribute('href', '/review/product/p_ajrakh')
    expect(within(ajrakh).getByText('KS-AJR-014')).toBeInTheDocument()
    expect(within(ajrakh).getByText('Kalki Studio')).toBeInTheDocument()
    expect(within(ajrakh).getByText('Resubmission #1')).toBeInTheDocument()
    expect(within(ajrakh).getByText('2 h')).toBeInTheDocument()
    expect(within(card(list, 'Patola Silk Stole')).getByText('34 h')).toHaveAttribute('data-overdue', 'true')
    expect(within(list).getByRole('link', { name: 'Nila Handloom brand page' })).toHaveAttribute('href', '/review/brand/v_nila')
    expect(within(list).getByRole('link', { name: 'Kaaya Ethnic' })).toHaveAttribute('href', '/vendors/v_kaaya')

    // The figures and filters are still there, the tabs scroll.
    expect(screen.getByRole('group', { name: 'Waiting' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search item, vendor or SKU' })).toBeInTheDocument()

    await user.click(within(list).getByRole('link', { name: 'Ajrakh Block-Print Kurta' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/review/product/p_ajrakh'))
  })

  it('shows vendors as cards with status, owner and the row actions', async () => {
    const { user, router } = renderModule({ route: '/vendors' })
    const list = await cardList('Vendors')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(15))

    const kalki = card(list, 'Kalki Studio')
    expect(within(kalki).getByRole('link', { name: 'Kalki Studio' })).toHaveAttribute('href', '/vendors/v_kalki')
    expect(within(kalki).getByText('Kiran Shah')).toBeInTheDocument()
    expect(within(kalki).getByText('Approved')).toBeInTheDocument()
    expect(within(kalki).getByText('15%')).toBeInTheDocument()
    expect(within(kalki).getByText('18')).toBeInTheDocument()

    // An approved vendor's menu offers suspend; an application is opened from its card.
    await user.click(within(kalki).getByRole('button', { name: 'Actions for Kalki Studio' }))
    expect(await screen.findByRole('menuitem', { name: 'Suspend' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(within(card(list, 'Kaaya Ethnic')).queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()

    await user.click(within(list).getByRole('link', { name: 'Kaaya Ethnic' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/vendors/v_kaaya'))
  })

  it('shows outbox events as cards and opens the chosen one full screen', async () => {
    const { user, router } = renderModule({ route: '/publishing' })
    const list = await cardList('Outbox events')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(16))

    const failed = within(list).getByRole('button', { name: 'Phulkari Dupatta — Mustard' }).closest('li')!
    expect(within(failed).getByText('product.published')).toBeInTheDocument()
    expect(within(failed).getByText('Nila Handloom')).toBeInTheDocument()
    expect(within(failed).getByText('Failed')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /^Retry all failed/ })).toBeInTheDocument()
    await user.click(within(failed).getByRole('button', { name: 'Phulkari Dupatta — Mustard' }))
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('event')).toBeTruthy())
    const dialog = await screen.findByRole('dialog', { name: 'Event details' })
    expect(within(dialog).getByRole('heading', { name: 'Phulkari Dupatta — Mustard' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close details' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(new URLSearchParams(router.state.location.search).get('event')).toBeNull()
  })

  it('keeps the review decision in a bar at the bottom of a product review', async () => {
    const { user } = renderModule({ route: '/review/product/p_ajrakh' })
    await screen.findByRole('heading', { level: 1, name: 'Ajrakh Block-Print Kurta' }, { timeout: 10_000 })
    const bar = screen.getByRole('region', { name: 'Decision' })
    const approve = within(bar).getByRole('button', { name: 'Approve and publish' })
    expect(approve).toBeDisabled()
    expect(within(bar).getByRole('button', { name: 'Send back' })).toBeEnabled()
    // One set of decision buttons on the page: the checklist card holds only the checks.
    expect(screen.getAllByRole('button', { name: 'Approve and publish' })).toHaveLength(1)

    const checklist = screen.getByRole('group', { name: 'Review checklist' })
    for (const box of within(checklist).getAllByRole('checkbox')) await user.click(box)
    expect(approve).toBeEnabled()

    await user.click(within(bar).getByRole('button', { name: 'Send back' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
