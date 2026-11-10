// Phone layout (frame narrower than 600 px): the three list screens become card lists, review
// decisions sit in a sticky bar and the reason dialog fills the screen.
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMock } from '../api'
import { renderRoute } from '../test/render'
import { mockViewport } from '../test/viewport'

const cards = (name: string) => within(screen.getByRole('list', { name })).getAllByRole('listitem')

describe('phone layout', () => {
  beforeEach(() => { resetMock(); mockViewport(390) })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the review queue as tappable cards instead of a table', async () => {
    const { router } = renderRoute('/queue')
    await screen.findByRole('list', { name: 'Review queue' }, { timeout: 8000 })
    expect(screen.queryByRole('table')).toBeNull()
    const items = cards('Review queue')
    expect(items).toHaveLength(14)
    const first = within(items[0]!)
    expect(first.getByText('Saanjh Label')).toBeTruthy()
    expect(first.getByText('1 d 2 h')).toBeTruthy()
    expect(first.getByText('New application')).toBeTruthy()
    expect(within(items[3]!).getByText('Resubmission #2')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: /Brand pages/ }))
    expect(cards('Review queue')).toHaveLength(2)
    fireEvent.click(screen.getByRole('tab', { name: /^All/ }))

    fireEvent.click(within(cards('Review queue')[3]!).getByRole('link', { name: 'Review Ajrakh Block-Print Kurta' }))
    expect(await screen.findByRole('heading', { name: 'Ajrakh Block-Print Kurta', level: 1 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/review/product/p_ajrakh_kurta')
  })

  it('shows vendors as cards with their status, owner and a link to open each one', async () => {
    renderRoute('/vendors')
    await screen.findByRole('list', { name: 'Vendors' }, { timeout: 8000 })
    expect(screen.queryByRole('table')).toBeNull()
    const items = cards('Vendors')
    expect(items).toHaveLength(36)
    const first = within(items[0]!)
    expect(first.getByText('Saanjh Label')).toBeTruthy()
    expect(first.getByText('Under review')).toBeTruthy()
    expect(first.getByText('+91 99241 18850')).toBeTruthy()
    expect(first.getByRole('link', { name: 'Open Saanjh Label' }).getAttribute('href')).toBe('/vendors/v_saanjh')

    fireEvent.click(screen.getByText('Suspended', { selector: 'button[role=tab] span' }))
    const suspended = within(cards('Vendors')[0]!)
    expect(suspended.getByRole('link', { name: 'Studio Ivory' })).toBeTruthy()
    expect(suspended.getByRole('button', { name: 'More actions for Studio Ivory' })).toBeTruthy()
  })

  it('shows outbox events as cards and opens the detail under the chosen one', async () => {
    renderRoute('/publishing')
    await screen.findByRole('list', { name: 'Outbox events' }, { timeout: 8000 })
    expect(screen.queryByRole('table')).toBeNull()
    const items = cards('Outbox events')
    expect(items.length).toBeGreaterThan(5)
    // The failed event is first and open.
    const first = within(items[0]!)
    expect(first.getByRole('button', { name: /Phulkari Dupatta — Mustard/, expanded: true })).toBeTruthy()
    expect(first.getByText(/^Tries 8\/8 · /)).toBeTruthy()
    expect(within(first.getByRole('region', { name: 'Event detail' })).getByText('HTTP 422 from central app')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Bandhani Silk Dupatta/ }))
    const detail = screen.getByRole('region', { name: 'Event detail' })
    expect(within(detail).getByText('product:BH-BSD-011:rev-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Phulkari Dupatta — Mustard/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps review decisions in a bar and opens the send-back dialog full screen', async () => {
    renderRoute('/review/product/p_ajrakh_kurta')
    const bar = await screen.findByRole('region', { name: 'Decision' }, { timeout: 8000 })
    expect(within(bar).getByRole('button', { name: 'Approve and publish' })).toBeTruthy()
    // The diff reads as a list on phones, not a sideways-scrolling table.
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByText('Same')).toHaveLength(4)
    fireEvent.click(within(bar).getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send back to Kalki Studio' })
    expect(dialog.className).toContain('MuiDialog-paperFullScreen')
  })
})
