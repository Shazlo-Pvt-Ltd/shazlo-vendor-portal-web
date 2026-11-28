import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderModule, VENDOR_API_URL } from '../../test/render'
import { server } from '../../test/server'

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

// A review is keyed by its own id; the mock names a brand page's `rev_brand_<vendor id>`.
const rev = (vendorId: string) => `rev_brand_${vendorId}`

async function open(vendorId: string, heading: string) {
  const view = renderModule({ route: `/review/brand/${rev(vendorId)}` })
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
    // Returns and delivery are the vendor's store details, which load beside the page.
    expect(await within(live).findByText('Ships in 2–3 days')).toBeInTheDocument()
    expect(within(draft).getByText('Handloom sarees from the Deccan, woven to order.')).toBeInTheDocument()
    expect(await within(draft).findByText('Ships in 2–3 days')).toBeInTheDocument()
    expect(within(draft).getByText('Nila Handloom')).toBeInTheDocument()
    // vendor-api keeps no "based in" yet (#288), so the page shows no city.
    expect(within(draft).queryByText('Bengaluru')).toBeNull()
    expect(within(draft).getByText('14-day returns')).toBeInTheDocument()
    expect(within(draft).getByText('NH')).toBeInTheDocument()
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: `/review/brand/${rev('v_nila')}`, title: 'Nila Handloom brand page' }))
  })

  it('lists each change with the old value struck through', async () => {
    await open('v_nila', 'Nila Handloom · brand page')
    const changes = screen.getByRole('region', { name: 'Changes from the live page' })
    const fields = within(changes).getAllByRole('rowheader').map((c) => c.textContent)
    expect(fields).toEqual(['Tagline', 'Story', 'Cover image', 'Instagram', 'Website'])

    const tagline = changeRow(changes, 'Tagline')
    expect(within(tagline).getByText('Handloom from Karnataka.').closest('del')).not.toBeNull()
    expect(within(tagline).getByText('Handloom sarees from the Deccan, woven to order.').closest('ins')).not.toBeNull()

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
    // The item after this one in the queue is offered next.
    expect(screen.getByRole('link', { name: 'Next item' })).toHaveAttribute('href', '/review/product/rev_p_dabu_set')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('Approved', { selector: '[data-status]' })).toBeInTheDocument()
  })

  it('moves to the neighbours in the queue', async () => {
    await open('v_nila', 'Nila Handloom · brand page')
    expect(screen.getByRole('link', { name: 'Previous item in the queue' })).toHaveAttribute('href', '/review/product/rev_p_pochampally')
    expect(screen.getByRole('link', { name: 'Next item in the queue' })).toHaveAttribute('href', '/review/product/rev_p_dabu_set')
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
    const rejections: unknown[] = []
    server.use(
      http.post(`${VENDOR_API_URL}/v1/admin/reviews/:id/reject`, async ({ request }) => {
        rejections.push(await request.clone().json())
        return undefined
      }),
    )
    const { user, db, shell } = await open('v_morpankh', 'Mor Pankh Clothing · brand page')
    const owner = db.vendors.find((v) => v.id === 'v_morpankh')!.email
    await user.click(screen.getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send back Mor Pankh Clothing brand page' })
    expect(within(dialog).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual(['Images', 'Contact details in the text', 'Something else'])
    await user.click(within(dialog).getByRole('radio', { name: 'Contact details in the text' }))
    const template = 'Remove the phone number from your story; shoppers contact you through Shazlo.'
    expect(within(dialog).getByRole('textbox', { name: 'Message to the seller' })).toHaveValue(template)
    await user.click(within(dialog).getByRole('button', { name: 'Send back to seller' }))

    expect(await screen.findByText(`Sent back. ${owner} will see your message on the brand page.`)).toBeInTheDocument()
    expect(rejections).toEqual([{ version: 1, reason_code: 'contact_details', reason: template }])
    const b = db.brands.find((x) => x.vendorId === 'v_morpankh')!
    expect(b.status).toBe('rejected')
    expect(b.history[0]).toMatchObject({ event: 'rejected', by: 'Priya Mehta', note: template })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: `Sent back the Mor Pankh Clothing brand page. ${owner} will see your message.` })
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
  })

  it('says when the brand page does not exist', async () => {
    const { shell } = renderModule({ route: '/review/brand/rev_missing' })
    expect(await screen.findByRole('heading', { name: 'We could not find this brand page' })).toBeInTheDocument()
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/review/brand/rev_missing', title: 'Brand page not found' }))
  })

  it('says the same for a product review opened as a brand page', async () => {
    renderModule({ route: '/review/brand/rev_p_ajrakh' })
    expect(await screen.findByRole('heading', { name: 'We could not find this brand page' })).toBeInTheDocument()
  })
})

describe('A-07 Brand page review: what vendor-api does not have', () => {
  it('reads returns and delivery from the vendor’s store details', async () => {
    const view = renderModule({ route: `/review/brand/${rev('v_nila')}` })
    const nila = view.db.vendors.find((v) => v.id === 'v_nila')!
    nila.application.returns = { window_days: 7, condition: 'any_reason', refund_days: 5 }
    nila.application.delivery = { by: 'own', all_india: true, places: [], days: '5_7' }
    await screen.findByRole('heading', { level: 1, name: 'Nila Handloom · brand page' }, { timeout: 10_000 })
    const draft = screen.getByRole('region', { name: 'Submitted draft' })
    expect(await within(draft).findByText('7-day returns')).toBeInTheDocument()
    expect(within(draft).getByText('Ships in 5–7 days')).toBeInTheDocument()
  })

  it('still opens, without returns and delivery, when the store details cannot be read', async () => {
    server.use(http.get(`${VENDOR_API_URL}/v1/admin/vendors/:id/store-details`, () => HttpResponse.json({ error: { code: 'internal_error', message: 'Down', request_id: 'r' } }, { status: 500 })))
    await open('v_nila', 'Nila Handloom · brand page')
    const draft = screen.getByRole('region', { name: 'Submitted draft' })
    expect(within(draft).getByText('Handloom sarees from the Deccan, woven to order.')).toBeInTheDocument()
    expect(within(draft).queryByText(/returns/)).toBeNull()
    expect(within(draft).queryByText(/Ships in/)).toBeNull()
  })

  it('opens for a vendor that was suspended after it submitted, and when it is decided by someone else first (409)', async () => {
    const { user, db } = await open('v_nila', 'Nila Handloom · brand page')
    db.vendors.find((v) => v.id === 'v_nila')!.status = 'suspended'
    const b = db.brands.find((x) => x.vendorId === 'v_nila')!
    b.status = 'approved'
    b.history.unshift({ at: new Date(NOW.getTime() - 5 * 60_000).toISOString(), event: 'approved', by: 'Rahul Desai' })
    for (const name of CHECKS) await user.click(screen.getByRole('checkbox', { name }))
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))
    expect(await screen.findByText('Already approved by Reviewer · Today, 13:35')).toBeInTheDocument()
    expect(screen.getByText('Someone else decided this while you were reviewing.')).toBeInTheDocument()
  })
})
