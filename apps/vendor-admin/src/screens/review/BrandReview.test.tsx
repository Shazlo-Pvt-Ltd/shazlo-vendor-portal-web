import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderModule } from '../../test/render'

// Monday 9 Nov 2026, 13:40 IST: Nila's edit came in at 08:40, Mor Pankh's first page yesterday at 11:40.
const NOW = new Date('2026-11-09T13:40:00+05:30')
const CHECKS = ['Images belong to the brand', 'No phone numbers or outside links in the text', 'No text baked into the cover image', 'Story is accurate and respectful']

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

async function open(vendorId: string, heading: string) {
  const view = renderModule({ route: `/review/brand/${vendorId}` })
  // The first screen in a file compiles on demand; give it room.
  await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 10_000 })
  return view
}

const changeRow = (changes: HTMLElement, field: string) => within(changes).getByRole('rowheader', { name: field }).closest('tr')!

describe('A-07 Brand page review: an edit to a live page', () => {
  it('shows the header and both phones, and tells the shell its title', async () => {
    const { shell } = await open('v_nila', 'Nila Handloom · brand page')
    expect(screen.getByText('Edit to live page')).toBeInTheDocument()
    expect(screen.getByText('Pending review')).toBeInTheDocument()
    expect(screen.getByText('Nila Handloom · submitted today, 08:40 · waiting 5 h')).toBeInTheDocument()
    const live = screen.getByRole('region', { name: 'Live now' })
    const draft = screen.getByRole('region', { name: 'Submitted draft' })
    expect(within(live).getByText('Handloom from Karnataka.')).toBeInTheDocument()
    expect(within(live).getByText('Ships in 2–3 days')).toBeInTheDocument()
    expect(within(draft).getByText('Handloom sarees from the Deccan, woven to order.')).toBeInTheDocument()
    expect(within(draft).getByText('Ships in 3–5 days')).toBeInTheDocument()
    expect(within(draft).getByText('Nila Handloom')).toBeInTheDocument()
    expect(within(draft).getByText('Bengaluru')).toBeInTheDocument()
    expect(within(draft).getByText('7-day returns')).toBeInTheDocument()
    expect(within(draft).getByText('NH')).toBeInTheDocument()
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/review/brand/v_nila', title: 'Nila Handloom brand page' }))
  })

  it('lists each change with the old value struck through', async () => {
    await open('v_nila', 'Nila Handloom · brand page')
    const changes = screen.getByRole('region', { name: 'Changes from the live page' })
    const fields = within(changes).getAllByRole('rowheader').map((c) => c.textContent)
    expect(fields).toEqual(['Tagline', 'Story', 'Cover image', 'Dispatch time', 'Instagram', 'Website'])

    const tagline = changeRow(changes, 'Tagline')
    expect(within(tagline).getByText('Handloom from Karnataka.').closest('del')).not.toBeNull()
    expect(within(tagline).getByText('Handloom sarees from the Deccan, woven to order.').closest('ins')).not.toBeNull()

    const dispatch = changeRow(changes, 'Dispatch time')
    expect(within(dispatch).getByText('Ships in 2–3 days').closest('del')).not.toBeNull()
    expect(within(dispatch).getByText('Ships in 3–5 days').closest('ins')).not.toBeNull()

    const cover = changeRow(changes, 'Cover image')
    expect(within(cover).getByRole('img', { name: 'Cover image before' })).toBeInTheDocument()
    expect(within(cover).getByRole('img', { name: 'Cover image after' })).toBeInTheDocument()
  })

  it('approves: the page goes live, an event is queued, the shell gets a toast', async () => {
    const { user, db, shell } = await open('v_nila', 'Nila Handloom · brand page')
    const approve = screen.getByRole('button', { name: 'Approve and publish' })
    expect(approve).toBeDisabled()
    for (const name of CHECKS) await user.click(screen.getByRole('checkbox', { name }))
    await user.click(approve)

    expect(await screen.findByText('Approved. Publishing to the app.')).toBeInTheDocument()
    const b = db.brands.find((x) => x.vendorId === 'v_nila')!
    expect(b.status).toBe('approved')
    expect(db.outbox[0]).toMatchObject({ event: 'brand_profile.published', subject: 'Nila Handloom' })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Approved the Nila Handloom brand page. Publishing to the app.' })
    expect(screen.getByRole('link', { name: 'Next item' })).toHaveAttribute('href', '/review/product/p_patola')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('Approved', { selector: '[data-status]' })).toBeInTheDocument()
  })

  it('moves to the neighbours in the queue', async () => {
    await open('v_nila', 'Nila Handloom · brand page')
    expect(screen.getByRole('link', { name: 'Previous item in the queue' })).toHaveAttribute('href', '/review/product/p_pochampally')
    expect(screen.getByRole('link', { name: 'Next item in the queue' })).toHaveAttribute('href', '/review/product/p_dabu_set')
    expect(screen.getByRole('link', { name: 'Review queue' })).toHaveAttribute('href', '/queue')
  })
})

describe('A-07 Brand page review: a first page', () => {
  it('shows only the draft, says it is not live yet, and has no changes list', async () => {
    await open('v_morpankh', 'Mor Pankh Clothing · brand page')
    expect(screen.getByText('First brand page')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Live now' })).toBeNull()
    const draft = screen.getByRole('region', { name: 'Submitted draft' })
    expect(within(draft).getByText(/Call us on 98290 11111/)).toBeInTheDocument()
    expect(screen.getByText('Not live yet. This is the brand’s first page.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Changes from the live page' })).toBeNull()
  })

  it('sends back for the phone number in the story', async () => {
    const { user, db, shell } = await open('v_morpankh', 'Mor Pankh Clothing · brand page')
    await user.click(screen.getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send back Mor Pankh Clothing brand page' })
    expect(within(dialog).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual(['Images', 'Contact details in the text', 'Something else'])
    await user.click(within(dialog).getByRole('radio', { name: 'Contact details in the text' }))
    const template = 'Remove the phone number from your story; shoppers contact you through Shazlo.'
    expect(within(dialog).getByRole('textbox', { name: 'Message to the seller' })).toHaveValue(template)
    await user.click(within(dialog).getByRole('button', { name: 'Send back to seller' }))

    expect(await screen.findByText('Sent back. Devansh Patel will see your message on the brand page.')).toBeInTheDocument()
    const b = db.brands.find((x) => x.vendorId === 'v_morpankh')!
    expect(b.status).toBe('rejected')
    expect(b.history[0]).toMatchObject({ event: 'rejected', by: 'Priya Mehta', note: template })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Sent back the Mor Pankh Clothing brand page. Devansh Patel will see your message.' })
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
  })

  it('says when the brand page does not exist', async () => {
    const { shell } = renderModule({ route: '/review/brand/v_kalki' })
    expect(await screen.findByRole('heading', { name: 'We could not find this brand page' })).toBeInTheDocument()
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/review/brand/v_kalki', title: 'Brand page not found' }))
  })
})
