import { screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MockDb } from '../../mocks/db'
import { renderApp, type Viewport } from '../../test/render'
import { mockDb, server } from '../../test/server'

const SLOW = { timeout: 8000 }
vi.setConfig({ testTimeout: 40_000, hookTimeout: 60_000 })

beforeAll(async () => {
  await Promise.all([import('./StoreDetails'), import('./StoreSection')])
})

// Changes the seed that the next renderApp creates, before any request reads it.
function seed(change: (db: MockDb) => void) {
  let changed: MockDb | null = null
  server.use(
    http.all('*/api/v1/*', () => {
      if (changed !== mockDb) {
        change(mockDb)
        changed = mockDb
      }
    }),
  )
}

async function openStoreDetails({ viewport, prepare }: { viewport?: Viewport; prepare?: (db: MockDb) => void } = {}) {
  if (prepare) seed(prepare)
  const view = await renderApp({ route: '/store/details', viewport })
  await screen.findByRole('region', { name: 'Your brand' }, SLOW)
  return view
}

const card = (name: string) => screen.getByRole('region', { name })
// The value beside a label in a card.
const value = (region: HTMLElement, label: string) => within(region).getByText(label, { selector: 'dt' }).nextElementSibling

describe('Store details: the summary', () => {
  it('shows one card per topic with plain answers and a Change link to its page', async () => {
    await openStoreDetails()
    expect(screen.getByRole('heading', { level: 1, name: 'Store details' })).toBeInTheDocument()
    const titles = ['Your brand', 'Contact', 'Delivery', 'Returns', 'Payment on delivery', 'Payouts', 'Business details', 'Commission']
    for (const title of titles) expect(card(title)).toBeInTheDocument()

    const brand = card('Your brand')
    expect(value(brand, 'Store name')).toHaveTextContent('Kalki Studio')
    expect(value(brand, 'Sells')).toHaveTextContent('Women')
    expect(value(brand, 'Ships from')).toHaveTextContent('Ahmedabad, Gujarat')
    // The store name is not edited here.
    expect(within(brand).getByRole('link', { name: 'partners@shazlo.store' })).toHaveAttribute('href', 'mailto:partners@shazlo.store')
    expect(brand).toHaveTextContent('Ask us to change it')

    expect(value(card('Contact'), 'Mobile number')).toHaveTextContent('98250 12345')
    const delivery = card('Delivery')
    expect(value(delivery, 'Who delivers')).toHaveTextContent('Shazlo delivery service')
    expect(value(delivery, 'Pickup address')).toHaveTextContent('14 Sahjanand Society, near Polytechnic')
    expect(value(delivery, 'Pickup address')).toHaveTextContent('Ahmedabad 380015')
    const returns = card('Returns')
    expect(value(returns, 'Returns')).toHaveTextContent('7 days')
    expect(value(returns, 'Returns accepted')).toHaveTextContent('Unworn with tags')
    expect(value(returns, 'Refund time')).toHaveTextContent('5 working days after pickup')
    expect(value(card('Payment on delivery'), 'Pay on delivery')).toHaveTextContent('Cash on delivery, UPI on delivery')
    expect(value(card('Business details'), 'GST number')).toHaveTextContent('24AAKFK1234L1ZD')

    const links: [string, string][] = [
      ['Your brand', '/store/details/brand'],
      ['Contact', '/store/details/contact'],
      ['Delivery', '/store/details/delivery'],
      ['Returns', '/store/details/returns'],
      ['Payment on delivery', '/store/details/payment'],
      ['Payouts', '/store/details/payout'],
      ['Business details', '/store/details/business'],
    ]
    for (const [title, href] of links) expect(within(card(title)).getByRole('link', { name: `Change ${title}` })).toHaveAttribute('href', href)
  })

  it('marks missing topics To do and says why they matter', async () => {
    // The demo store has no payout yet.
    await openStoreDetails()
    const notice = screen.getByText('Finish these before you can send products for review').closest('[role="status"]') as HTMLElement
    expect(within(notice).getByRole('link', { name: 'Payouts' })).toHaveAttribute('href', '/store/details/payout')
    const payouts = card('Payouts')
    expect(within(payouts).getByText('To do')).toBeInTheDocument()
    expect(within(payouts).getByText('Not added yet.')).toBeInTheDocument()
    expect(screen.getAllByText('To do')).toHaveLength(1)
    // Business details are optional and never To do.
    expect(within(card('Business details')).queryByText('To do')).toBeNull()
  })

  it('masks a saved bank account and drops the notice once nothing is missing', async () => {
    await openStoreDetails({
      prepare: (db) => {
        db.store.payout = { method: 'bank', holder_name: 'Kalki Studio LLP', account_number: '50100123454821', ifsc: 'HDFC0001234' }
      },
    })
    const payouts = card('Payouts')
    expect(value(payouts, 'Paid to')).toHaveTextContent('HDFC Bank •••• 4821')
    expect(value(payouts, 'Account holder')).toHaveTextContent('Kalki Studio LLP')
    expect(document.body).not.toHaveTextContent('50100123454821')
    expect(screen.queryByText('To do')).toBeNull()
    expect(screen.queryByText('Finish these before you can send products for review')).toBeNull()
  })

  it('masks a UPI ID, and reads back delivering yourself and no returns', async () => {
    await openStoreDetails({
      prepare: (db) => {
        db.store.payout = { method: 'upi', upi_id: 'kalki.studio@okhdfcbank' }
        db.store.delivery = { mode: 'own', areas: { all_india: false, places: ['Ahmedabad', '380015'] }, delivery_days: '1_2' }
        db.store.returns = { window_days: 0, condition: null, refund_days: null }
        db.store.business = { legal_name: null, gstin: null }
      },
    })
    expect(value(card('Payouts'), 'UPI ID')).toHaveTextContent('ka•••@okhdfcbank')
    const delivery = card('Delivery')
    expect(value(delivery, 'Who delivers')).toHaveTextContent('We deliver ourselves')
    expect(value(delivery, 'Delivers to')).toHaveTextContent('Ahmedabad, 380015')
    expect(value(delivery, 'Delivery time')).toHaveTextContent('1–2 days')
    expect(value(card('Returns'), 'Returns')).toHaveTextContent('No returns')
    expect(within(card('Returns')).queryByText('Refund time')).toBeNull()
    expect(value(card('Business details'), 'GST number')).toHaveTextContent('Not added')
  })

  it('lists everything still to do for a brand that has saved nothing', async () => {
    await openStoreDetails({
      prepare: (db) => {
        db.store = { sells: null, city: null, instagram_or_website: null, contact: null, delivery: null, returns: null, pay_on_delivery: null, payout: null, business: { legal_name: null, gstin: null }, updated_at: null }
      },
    })
    const notice = screen.getByText('Finish these before you can send products for review').closest('[role="status"]') as HTMLElement
    expect(within(notice).getAllByRole('link').map((l) => l.textContent)).toEqual(['Your brand', 'Contact', 'Delivery', 'Returns', 'Payment on delivery', 'Payouts'])
    expect(screen.getAllByText('To do')).toHaveLength(6)
    expect(value(card('Your brand'), 'Sells')).toHaveTextContent('Not answered yet')
  })

  it('is one column on phones, with no yellow button on the page while the rate is agreed', async () => {
    await openStoreDetails({ viewport: 'mobile' })
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('main').querySelectorAll('.MuiButton-contained')).toHaveLength(0)
  })
})

describe('Store details: commission (spec §6)', () => {
  it('shows the agreed rate, and asks for a different one only when asked', async () => {
    const { user, db } = await openStoreDetails()
    const commission = card('Commission')
    expect(commission.closest('#commission')).not.toBeNull()
    expect(await within(commission).findByText('12% of each sale.')).toBeInTheDocument()
    expect(within(commission).queryByRole('textbox')).toBeNull()

    await user.click(within(commission).getByRole('button', { name: 'Ask for a different rate' }))
    const field = within(commission).getByRole('textbox', { name: 'Rate you propose, in %' })
    expect(field).toHaveAttribute('inputmode', 'decimal')
    await user.type(field, '12')
    await user.click(within(commission).getByRole('button', { name: 'Send proposal' }))
    expect(field).toHaveAccessibleDescription('That is already your agreed rate.')
    expect(field).toHaveFocus()
    await user.click(within(commission).getByRole('button', { name: 'Cancel' }))
    expect(within(commission).queryByRole('textbox')).toBeNull()

    await user.click(within(commission).getByRole('button', { name: 'Ask for a different rate' }))
    await user.type(within(commission).getByRole('textbox', { name: 'Rate you propose, in %' }), '10')
    await user.click(within(commission).getByRole('button', { name: 'Send proposal' }))
    expect(await within(commission).findByText('You proposed 10%. Waiting for Shazlo.')).toBeInTheDocument()
    expect(within(commission).getByText('Proposal sent. We usually reply within 2 working days.')).toBeInTheDocument()
    expect(within(commission).getByText('Your rate stays at 12% of each sale until Shazlo agrees a new one.')).toBeInTheDocument()
    expect(db.commission).toMatchObject({ state: 'proposed', proposed_bps: 1000, agreed_bps: 1200 })
  })

  it('offers to propose a rate when none is agreed, checking it like the API does', async () => {
    const { user, db } = await openStoreDetails({ prepare: (d) => (d.commission = { state: 'not_set', agreed_bps: null, proposed_bps: null, note: null, updated_at: null }) })
    const commission = card('Commission')
    expect(await within(commission).findByText('Not agreed yet. Propose a rate, or our team will set it with you.')).toBeInTheDocument()
    const field = within(commission).getByRole('textbox', { name: 'Rate you propose, in %' })
    const send = within(commission).getByRole('button', { name: 'Send proposal' })
    // The only yellow button on the page.
    expect(screen.getByRole('main').querySelectorAll('.MuiButton-contained')).toHaveLength(1)

    await user.click(send)
    expect(field).toHaveAccessibleDescription('Enter a percentage, like 12 or 12.5.')
    // Checked on Send; a message goes as soon as the rate is fixed.
    await user.type(field, '45')
    expect(field).toHaveAccessibleDescription('From 0% to 40%, like 12 or 12.5.')
    await user.click(send)
    expect(field).toHaveAccessibleDescription('Enter a rate from 0% to 40%.')
    expect(db.commission.state).toBe('not_set')
    await user.clear(field)
    await user.type(field, '12.5')
    expect(field).toHaveAccessibleDescription('From 0% to 40%, like 12 or 12.5.')
    await user.click(send)
    expect(await within(commission).findByText('You proposed 12.5%. Waiting for Shazlo.')).toBeInTheDocument()
    expect(db.commission).toMatchObject({ state: 'proposed', proposed_bps: 1250 })
    expect(within(commission).queryByRole('textbox')).toBeNull()
  })

  it('waits quietly while a proposal is with Shazlo', async () => {
    await openStoreDetails({ prepare: (d) => (d.commission = { state: 'proposed', agreed_bps: null, proposed_bps: 1000, note: null, updated_at: null }) })
    const commission = card('Commission')
    expect(await within(commission).findByText('You proposed 10%. Waiting for Shazlo.')).toBeInTheDocument()
    expect(within(commission).queryByRole('textbox')).toBeNull()
    expect(within(commission).queryByRole('button')).toBeNull()
  })

  it("shows Shazlo's note on a proposal sent back, and lets the brand propose again", async () => {
    const note = 'Most brands in your price range agree 12%. Can we talk about 12%?'
    const { user, db } = await openStoreDetails({ prepare: (d) => (d.commission = { state: 'sent_back', agreed_bps: null, proposed_bps: 800, note, updated_at: null }) })
    const commission = card('Commission')
    expect(await within(commission).findByText('Shazlo sent your proposal of 8% back.')).toBeInTheDocument()
    expect(within(commission).getByText(`“${note}”`)).toBeInTheDocument()
    await user.type(within(commission).getByRole('textbox', { name: 'Rate you propose, in %' }), '11')
    await user.click(within(commission).getByRole('button', { name: 'Send proposal' }))
    expect(await within(commission).findByText('You proposed 11%. Waiting for Shazlo.')).toBeInTheDocument()
    await waitFor(() => expect(db.commission).toMatchObject({ state: 'proposed', proposed_bps: 1100, note: null }))
  })
})
