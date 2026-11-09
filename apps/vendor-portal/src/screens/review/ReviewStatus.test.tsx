import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '../../test/render'

// The suite shares a busy machine with other dev servers; give async UI generous time.
const wait = { timeout: 10_000 }

describe('V-09 Review status', () => {
  it('lists decided items with the reviewer reasons quoted and a link to fix them', async () => {
    renderRoute('/review')
    expect(await screen.findByRole('heading', { name: 'Recently decided' }, wait)).toBeTruthy()
    expect(screen.getByText('“Back photo is missing. Add front, back and a fabric close-up.”')).toBeTruthy()
    expect(screen.getByText('“Price ₹3,999 does not match the MRP on the tag (₹3,499).”')).toBeTruthy()

    const fixes = await screen.findAllByRole('link', { name: /^Fix and resubmit/ }, wait)
    expect(fixes.map(a => a.getAttribute('href'))).toEqual(['/products/p_ajrakh', '/products/p_kutch'])

    // Approved items are "Live" once the app confirms, "Publishing" until then.
    expect(screen.getByText('Linen Co-ord Set — Indigo')).toBeTruthy()
    expect(screen.getByText('Publishing')).toBeTruthy()
    expect(screen.getByText(/^Approved .* · publishing to the app$/)).toBeTruthy()
  }, 30_000)

  it('shows what is waiting, the 24-hour target, and filters by tab', async () => {
    renderRoute('/review')
    expect(await screen.findByRole('heading', { name: 'Waiting for review' }, wait)).toBeTruthy()
    expect(screen.getByText('Dabu Print Wrap Skirt')).toBeTruthy()
    expect(await screen.findByText('Edit in review', undefined, wait)).toBeTruthy()
    expect(screen.getByText('Submitted yesterday · the live version stays in the app')).toBeTruthy()
    expect(screen.getByText(/^Most items are reviewed within 24 hours\. Your oldest waiting item has been in the queue for /)).toBeTruthy()

    fireEvent.click(await screen.findByRole('tab', { name: /Sent back/ }, wait))
    expect(screen.queryByRole('heading', { name: 'Waiting for review' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Sent back' })).toBeTruthy()
    expect(screen.queryByText('Bandhani Silk Dupatta')).toBeNull()
    expect(screen.getByText('Kutch Mirror-Work Jacket')).toBeTruthy()
  }, 30_000)
})
