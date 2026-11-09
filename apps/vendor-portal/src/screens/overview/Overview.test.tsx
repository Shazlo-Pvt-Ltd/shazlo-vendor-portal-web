import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '../../test/render'

// The suite shares a busy machine with other dev servers; give async UI generous time.
const wait = { timeout: 10_000 }

describe('V-04 Overview', () => {
  it('pins the sent-back banner above the catalog counts', async () => {
    renderRoute('/')
    const banner = await screen.findByText('2 products were sent back by the review team', undefined, wait)
    expect(screen.getByText('Fix the notes on each product and resubmit. They stay off the app until approved.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See feedback' }).getAttribute('href')).toBe('/review?tab=sent_back')
    const stats = screen.getByRole('list', { name: 'Catalog' })
    expect(banner.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }, 30_000)

  it('shows the four counts, each opening Products filtered to that tab', async () => {
    renderRoute('/')
    const stats = await screen.findByRole('list', { name: 'Catalog' }, wait)
    const links = within(stats).getAllByRole('link')
    expect(links.map(l => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Live on Shazlo18Visible in the app feed', '/products?tab=live'],
      ['Pending review4Usually reviewed within 24 h', '/products?tab=pending'],
      ['Sent back2Needs your changes', '/products?tab=sent_back'],
      ['Drafts3Not submitted yet', '/products?tab=drafts'],
    ])
  }, 30_000)

  it('quotes reviewer reasons verbatim and shows the brand page and checklist status', async () => {
    renderRoute('/')
    expect(await screen.findByText('“Back photo is missing. Add front, back and a fabric close-up.”', undefined, wait)).toBeTruthy()
    expect(screen.getByText('“Price ₹3,999 does not match the MRP on the tag (₹3,499).”')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View all' }).getAttribute('href')).toBe('/review')
    expect(await screen.findByText('Published 20 Oct. You have a draft with 2 unpublished changes (cover image, story).', undefined, wait)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Continue editing/ }).getAttribute('href')).toBe('/brand')
    expect(screen.getByText('4 of 5 done')).toBeTruthy()
  }, 30_000)
})
