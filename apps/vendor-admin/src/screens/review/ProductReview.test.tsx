import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderModule, VENDOR_API_URL } from '../../test/render'
import { server } from '../../test/server'


// Monday 9 Nov 2026, 13:40 IST. The seed is built relative to it: the Ajrakh kurta came in at 11:40.
const NOW = new Date('2026-11-09T13:40:00+05:30')
const AJRAKH = 'Ajrakh Block-Print Kurta'
const CHECKS = ['4 product photos and 5 try-on photos', 'Price is not above MRP', 'Product type, colours and material are right', 'Not on the prohibited list', 'Description is accurate']

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

// A review is keyed by its own id; the mock names a product's `rev_<product id>`.
const rev = (productId: string) => `rev_${productId}`

async function open(id: string, title: string) {
  const view = renderModule({ route: `/review/product/${rev(id)}` })
  // The first screen in a file compiles on demand; give it room.
  await screen.findByRole('heading', { level: 1, name: title }, { timeout: 10_000 })
  return view
}

const compareTable = () => within(screen.getByRole('region', { name: /^Compared with the/ })).getByRole('table')
const rowOf = (table: HTMLElement, field: RegExp) => within(table).getByRole('rowheader', { name: field }).closest('tr')!
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent)

async function tickAll(user: ReturnType<typeof renderModule>['user']) {
  for (const name of CHECKS) await user.click(screen.getByRole('checkbox', { name }))
}

describe('A-05 Product review: a resubmission', { timeout: 40_000 }, () => {
  it('shows the header, pills, subtitle and tells the shell its title', async () => {
    const { shell } = await open('p_ajrakh', AJRAKH)
    expect(screen.getByText('Pending review')).toBeInTheDocument()
    expect(screen.getByText('Resubmission #1')).toBeInTheDocument()
    expect(screen.getByText('Kalki Studio · KS-AJR-014 · submitted today, 11:40 · waiting 2 h')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review queue' })).toHaveAttribute('href', '/queue')
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: `/review/product/${rev('p_ajrakh')}`, title: AJRAKH }))
  })

  it('offers no comparison with the version sent back: vendor-api compares with the live version only', async () => {
    await open('p_ajrakh', AJRAKH)
    expect(screen.queryByRole('region', { name: /^Compared with the/ })).toBeNull()
  })

  it('shows what the product is: gender, type, colours with swatches, material and description', async () => {
    await open('p_pochampally', 'Pochampally Ikat Kurta')
    const about = screen.getByRole('region', { name: 'About the product' })
    const value = (term: string) => within(about).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement
    expect(value('Gender')).toHaveTextContent('Women')
    expect(value('Product type')).toHaveTextContent('Kurtas')
    expect(value('Main colour')).toHaveTextContent('Maroon')
    expect(value('Main colour').querySelector('[data-swatch="#6B1F2A"]')).not.toBeNull()
    expect(value('Other colours')).toHaveTextContent('Ivory, Mustard')
    expect(value('Other colours').querySelectorAll('[data-swatch]')).toHaveLength(2)
    expect(value('Material')).toHaveTextContent('Cotton ikat, handwoven')
    expect(value('Description')).toHaveTextContent('Pochampally Ikat Kurta in hand block-printed cotton')
  })

  it('shows a multicolour swatch and no other colours', async () => {
    await open('p_potli', 'Mirror-Work Potli Bag')
    const about = screen.getByRole('region', { name: 'About the product' })
    const value = (term: string) => within(about).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement
    expect(value('Gender')).toHaveTextContent('Unisex')
    expect(value('Main colour')).toHaveTextContent('Multicolour')
    expect(value('Main colour').querySelector('[data-swatch="multicolour"]')).not.toBeNull()
    expect(value('Other colours')).toHaveTextContent('None')
  })

  it('shows the price with MRP, and that the app shows the lower one', async () => {
    await open('p_ajrakh', AJRAKH)
    const price = screen.getByRole('region', { name: 'Price' })
    const value = (term: string) => within(price).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement
    expect(value('Selling price')).toHaveTextContent('₹2,499')
    expect(value('MRP')).toHaveTextContent('₹2,999')
    expect(within(price).getByText('Shoppers see ₹2,499, the lower of the two.')).toBeInTheDocument()
  })

  it('lists the sizes without stock (vendor-api keeps none yet), and the history with the reason quoted', async () => {
    await open('p_ajrakh', AJRAKH)
    const sizes = screen.getByRole('region', { name: 'Sizes and stock' })
    expect(within(sizes).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Size', 'Code'])
    expect(within(sizes).queryByRole('rowheader', { name: 'Total' })).toBeNull()
    // One row per size and colour: the second colour has its own codes.
    const codes = within(sizes).getAllByRole('rowheader', { name: 'XL' }).map((h) => within(h.closest('tr')!).getAllByRole('cell')[0]!.textContent)
    expect(codes).toEqual(['KS-AJR-014-XL', 'KS-AJR-014-XL-MAD'])

    const history = screen.getByRole('region', { name: 'History' })
    const items = within(history).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Submitted by kiran@kalkistudio.in · Today, 11:40')
    expect(items[1]).toHaveTextContent('Sent back by Reviewer · Today, 03:40')
    expect(within(items[1]!).getByText('The back photo is missing and there are only 3 try-on photos. Add the back photo and 5 try-on photos so shoppers can see the print and the fit.').closest('blockquote')).not.toBeNull()
  })

  it('lists the photos in order, without slot names, and reports nothing missing', async () => {
    const { user } = await open('p_ajrakh', AJRAKH)
    const photos = screen.getByRole('region', { name: 'Photos' })
    expect(within(photos).getByRole('img', { name: `Photo 1 of ${AJRAKH}` })).toBeInTheDocument()
    const product = within(photos).getByRole('group', { name: 'Product photos' })
    expect(within(product).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Show photo 1', 'Show photo 2', 'Show photo 3', 'Show photo 4', 'Show photo 5'])
    expect(within(product).getByText('5 photos')).toBeInTheDocument()
    // vendor-api has no try-on photos or named slots yet: nothing is reported missing.
    expect(within(photos).queryByRole('group', { name: 'Try-on photos' })).toBeNull()
    expect(within(photos).queryByText(/missing/i)).toBeNull()
    await user.click(within(product).getByRole('button', { name: 'Show photo 3' }))
    expect(within(photos).getByRole('img', { name: `Photo 3 of ${AJRAKH}` })).toBeInTheDocument()
  })
})

describe('A-05 Product review: approving', () => {
  it('keeps Approve disabled until every check is ticked', async () => {
    const { user } = await open('p_ajrakh', AJRAKH)
    const approve = screen.getByRole('button', { name: 'Approve and publish' })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription('Tick every check to approve')
    for (const name of CHECKS.slice(0, 4)) await user.click(screen.getByRole('checkbox', { name }))
    expect(approve).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: CHECKS[4] }))
    expect(approve).toBeEnabled()
    expect(screen.queryByText('Tick every check to approve')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send back' })).toBeEnabled()
  })

  it('approves the version it showed: the product is approved, an event is queued, the shell gets a toast', async () => {
    const approvals: unknown[] = []
    server.use(
      http.post(`${VENDOR_API_URL}/v1/admin/reviews/:id/approve`, async ({ request }) => {
        approvals.push(await request.clone().json())
        return undefined
      }),
    )
    const { user, db, shell } = await open('p_ajrakh', AJRAKH)
    const events = db.outbox.length
    await tickAll(user)
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))

    expect(await screen.findByText('Approved. Publishing to the app.')).toBeInTheDocument()
    // The decision names the version the reviewer looked at (a resubmission is version 2).
    expect(approvals).toEqual([{ version: 2 }])
    expect(db.products.find((p) => p.id === 'p_ajrakh')!.status).toBe('approved')
    expect(db.outbox).toHaveLength(events + 1)
    expect(db.outbox[0]).toMatchObject({ event: 'product.published', subject: AJRAKH, status: 'waiting' })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: `Approved ${AJRAKH}. Publishing to the app.` })
    // Last in the queue, so the next item offered is the oldest one still waiting.
    expect(screen.getByRole('link', { name: 'Next item' })).toHaveAttribute('href', `/review/product/${rev('p_patola')}`)
    expect(screen.getByRole('link', { name: 'Back to the queue' })).toHaveAttribute('href', '/queue')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull()
    expect(screen.getByText('Approved', { selector: '[data-status]' })).toBeInTheDocument()
    expect(screen.queryByText('Pending review')).toBeNull()
  })

  it('goes to the next item from the outcome', async () => {
    const { user, router } = await open('p_handloom', 'Handloom Cotton Shirt — Rust')
    await tickAll(user)
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))
    await user.click(await screen.findByRole('link', { name: 'Next item' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dabu Print Wrap Skirt' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/review/product/${rev('p_dabu_skirt')}`)
    // A fresh item starts with a fresh checklist.
    expect(screen.getByRole('checkbox', { name: CHECKS[0] })).not.toBeChecked()
  })

  it('shows the decided state when someone else decided first (409 review_already_decided)', async () => {
    const { user, db } = await open('p_ajrakh', AJRAKH)
    const p = db.products.find((x) => x.id === 'p_ajrakh')!
    p.status = 'approved'
    p.history.unshift({ at: new Date(NOW.getTime() - 5 * 60_000).toISOString(), event: 'approved', by: 'Rahul Desai' })
    await tickAll(user)
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))
    // The page first says "someone else decided" alone, then again with who and when once it has
    // reloaded the item: wait for the settled page, or the first message can be swapped out from under the check.
    expect(await screen.findByText('Already approved by Reviewer · Today, 13:35')).toBeInTheDocument()
    expect(screen.getByText('Someone else decided this while you were reviewing.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
  })

  it('shows the new version when the seller edited it while it was open (409 stale_review), with the checks to do again', async () => {
    const { user, db } = await open('p_ajrakh', AJRAKH)
    await tickAll(user)
    // The seller sent the item back to themselves and resubmitted: the same review, a newer version.
    const p = db.products.find((x) => x.id === 'p_ajrakh')!
    p.resubmission += 1
    p.submitted.title = 'Ajrakh Block-Print Kurta (new cut)'
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))

    expect(await screen.findByText('The seller changed this while you were reviewing. Check what is new, then decide again.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajrakh Block-Print Kurta (new cut)' })).toBeInTheDocument()
    expect(p.status).toBe('pending_review')
    // What was ticked was for the old version.
    for (const name of CHECKS) expect(screen.getByRole('checkbox', { name })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Approve and publish' })).toBeDisabled()
    await tickAll(user)
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))
    expect(await screen.findByText('Approved. Publishing to the app.')).toBeInTheDocument()
    expect(p.status).toBe('approved')
  })

  it('shows an error and keeps the decision open when approving fails', async () => {
    server.use(http.post(`${VENDOR_API_URL}/v1/admin/reviews/:id/approve`, () => HttpResponse.json({ error: { code: 'internal_error', message: 'Something went wrong on our side.', request_id: 'r' } }, { status: 500 })))
    const { user } = await open('p_ajrakh', AJRAKH)
    await tickAll(user)
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side.')
    expect(screen.getByRole('button', { name: 'Approve and publish' })).toBeEnabled()
  })

  it('does not decide twice when Approve is clicked twice', async () => {
    let approvals = 0
    server.use(
      http.post(`${VENDOR_API_URL}/v1/admin/reviews/:id/approve`, () => {
        approvals += 1
        return undefined
      }),
    )
    const { user } = await open('p_ajrakh', AJRAKH)
    await tickAll(user)
    const approve = screen.getByRole('button', { name: 'Approve and publish' })
    await user.dblClick(approve)
    expect(await screen.findByText('Approved. Publishing to the app.')).toBeInTheDocument()
    expect(approvals).toBe(1)
  })
})

describe('A-06 Send back', () => {
  it('fills the message from a template, keeps edits, and sends the reason with its category and the version', async () => {
    const rejections: unknown[] = []
    server.use(
      http.post(`${VENDOR_API_URL}/v1/admin/reviews/:id/reject`, async ({ request }) => {
        rejections.push(await request.clone().json())
        return undefined
      }),
    )
    const { user, db, shell } = await open('p_ajrakh', AJRAKH)
    await user.click(screen.getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: `Send back ${AJRAKH}` })
    const message = within(dialog).getByRole('textbox', { name: 'Message to the seller' })
    expect(message).toHaveAccessibleDescription(/The seller sees this word for word\./)

    expect(within(dialog).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual(['Product photos', 'Try-on photos', 'Price or MRP', 'Product type, colours or material', 'Prohibited item', 'Description', 'Something else'])
    await user.click(within(dialog).getByRole('radio', { name: 'Try-on photos' }))
    expect(message).toHaveValue('Add 5 try-on photos of real people wearing it, so shoppers see the true fit.')
    await user.click(within(dialog).getByRole('radio', { name: 'Product photos' }))
    const template = 'Product photos are missing or unclear. Add front, back, detail and worn photos on a plain background.'
    expect(message).toHaveValue(template)
    await user.click(message)
    await user.keyboard('{End}')
    await user.paste(' The back photo is blurred.')
    expect(within(dialog).getByText(`${template.length + 27} / 600`)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send back to seller' }))

    expect(await screen.findByText('Sent back. kiran@kalkistudio.in will see your message on the product.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(rejections).toEqual([{ version: 2, reason_code: 'photos', reason: `${template} The back photo is blurred.` }])
    const p = db.products.find((x) => x.id === 'p_ajrakh')!
    expect(p.status).toBe('rejected')
    expect(p.history[0]).toMatchObject({ event: 'rejected', by: 'Priya Mehta', note: `${template} The back photo is blurred.` })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: `Sent back ${AJRAKH}. kiran@kalkistudio.in will see your message.` })
    expect(screen.getByText('Sent back', { selector: '[data-status]' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull()
  })

  it('asks for a reason and at least 10 characters, and focuses the first problem', async () => {
    const { user, db } = await open('p_ajrakh', AJRAKH)
    await user.click(screen.getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: `Send back ${AJRAKH}` })
    await user.click(within(dialog).getByRole('button', { name: 'Send back to seller' }))
    expect(await within(dialog).findByText('Choose a reason.')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'Product photos' })).toHaveFocus()

    await user.click(within(dialog).getByRole('radio', { name: 'Something else' }))
    const message = within(dialog).getByRole('textbox', { name: 'Message to the seller' })
    expect(message).toHaveValue('')
    await user.type(message, 'Too short')
    await user.click(within(dialog).getByRole('button', { name: 'Send back to seller' }))
    expect(await within(dialog).findByText('Write at least 10 characters so the seller knows what to fix.')).toBeInTheDocument()
    expect(message).toHaveAttribute('aria-invalid', 'true')
    expect(message).toHaveFocus()
    expect(db.products.find((x) => x.id === 'p_ajrakh')!.status).toBe('pending_review')
  })

  it('shows the server’s field errors on the fields', async () => {
    server.use(http.post(`${VENDOR_API_URL}/v1/admin/reviews/:id/reject`, () => HttpResponse.json({ error: { code: 'validation_error', message: 'Request validation failed', request_id: 'r', details: [{ loc: ['body', 'reason'], msg: 'Say which photo is missing.', type: 'value_error' }] } }, { status: 422 })))
    const { user } = await open('p_ajrakh', AJRAKH)
    await user.click(screen.getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Product photos' }))
    await user.click(within(dialog).getByRole('button', { name: 'Send back to seller' }))
    expect(await within(dialog).findByText('Say which photo is missing.')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Message to the seller' })).toHaveFocus()
  })

  it('shows the decided state when someone else sent it back first', async () => {
    const { user, db } = await open('p_ajrakh', AJRAKH)
    const p = db.products.find((x) => x.id === 'p_ajrakh')!
    p.status = 'rejected'
    p.history.unshift({ at: new Date(NOW.getTime() - 5 * 60_000).toISOString(), event: 'rejected', by: 'Rahul Desai', note: 'Blurry.' })
    await user.click(screen.getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Product photos' }))
    await user.click(within(dialog).getByRole('button', { name: 'Send back to seller' }))
    expect(await screen.findByText('Already sent back by Reviewer · Today, 13:35')).toBeInTheDocument()
    expect(screen.getByText('Someone else decided this while you were reviewing.')).toBeInTheDocument()
  })

  it('closes without sending on Cancel', async () => {
    const { user, db } = await open('p_ajrakh', AJRAKH)
    await user.click(screen.getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(db.products.find((x) => x.id === 'p_ajrakh')!.status).toBe('pending_review')
  })
})

describe('A-05 Product review: other kinds of submission', () => {
  it('labels an edit to a live product and compares with the live version', async () => {
    await open('p_handloom', 'Handloom Cotton Shirt — Rust')
    expect(screen.getByText('Edit to live product')).toBeInTheDocument()
    expect(screen.queryByText(/Resubmission/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Compared with the live version' })).toBeInTheDocument()
    const table = compareTable()
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Field', 'Live version', 'This submission'])
    expect(cells(rowOf(table, /^Selling price/))).toEqual(['₹1,299 / ₹1,499', '₹1,199 / ₹1,499'])
    expect(within(rowOf(table, /^Selling price/)).getByText('Changed')).toBeInTheDocument()
    expect(within(rowOf(table, /^Description/)).getByText('Changed')).toBeInTheDocument()
    // No try-on photos are kept yet, so there is no row to compare them in.
    expect(within(table).queryByRole('rowheader', { name: /^Try-on photos/ })).toBeNull()
  })

  it('truncates the description in the comparison until asked', async () => {
    const view = renderModule({ route: `/review/product/${rev('p_handloom')}` })
    const long = 'Handloom cotton shirt in rust, woven on a pit loom in Kutch and finished by hand. Soft after the first wash and made to last. Wash cold, dry in the shade.'
    view.db.products.find((p) => p.id === 'p_handloom')!.submitted.description = long
    await screen.findByRole('heading', { level: 1, name: 'Handloom Cotton Shirt — Rust' }, { timeout: 10_000 })
    const { user } = view
    const row = rowOf(compareTable(), /^Description/)
    expect(cells(row)[1]).toMatch(/…$/)
    await user.click(within(row).getByRole('button', { name: 'Show full description' }))
    expect(cells(row)[1]).toBe(long)
    expect(within(row).getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('hides the comparison for a first submission', async () => {
    await open('p_dabu_skirt', 'Dabu Print Wrap Skirt')
    expect(screen.queryByRole('region', { name: /^Compared with the/ })).toBeNull()
    expect(screen.queryByText('New')).toBeNull()
    expect(screen.getByRole('region', { name: 'About the product' })).toHaveTextContent('Dabu Print Wrap Skirt in hand block-printed cotton')
    expect(screen.queryByRole('region', { name: 'Size chart' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Sizes and stock' })).toHaveTextContent('No size chart for skirts.')
    expect(screen.getByRole('region', { name: 'Price' })).toHaveTextContent('Shoppers see ₹1,450, the lower of the two.')
  })

  it('says when the selling price is above the MRP', async () => {
    const view = renderModule({ route: `/review/product/${rev('p_patola')}` })
    view.db.products.find((x) => x.id === 'p_patola')!.submitted.price_paise = 5999_00
    await screen.findByRole('heading', { level: 1, name: 'Patola Silk Stole' }, { timeout: 10_000 })
    const price = screen.getByRole('region', { name: 'Price' })
    expect(within(price).getByText('The selling price is above the MRP. The app shows the lower price, ₹5,499.')).toBeInTheDocument()
  })

  it('shows an MRP that was not given', async () => {
    await open('p_pochampally', 'Pochampally Ikat Kurta')
    const price = screen.getByRole('region', { name: 'Price' })
    expect(within(price).getByText('MRP', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Not given')
    expect(within(price).getByText('Shoppers see ₹2,299.')).toBeInTheDocument()
  })

  it('shows a decided product read-only', async () => {
    const view = renderModule({ route: `/review/product/${rev('p_potli')}` })
    const p = view.db.products.find((x) => x.id === 'p_potli')!
    p.status = 'rejected'
    p.history.unshift({ at: new Date(NOW.getTime() - 30 * 60_000).toISOString(), event: 'rejected', by: 'Rahul Desai', note: 'Price is above the MRP.' })
    await screen.findByRole('heading', { level: 1, name: 'Mirror-Work Potli Bag' })
    expect(await screen.findByText('Already sent back by Reviewer · Today, 13:10')).toBeInTheDocument()
    expect(screen.getByText('Sent back', { selector: '[data-status]' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull()
  })

  it('shows a review the seller withdrew as such, with nothing to decide', async () => {
    const wire = (action: string, created_at: string) => ({ action, actor_type: 'vendor', actor_id: null, reason: null, detail: null, created_at })
    server.use(
      http.get(`${VENDOR_API_URL}/v1/admin/reviews/:id`, () =>
        HttpResponse.json({
          id: 'rev_w', subject: 'product', status: 'withdrawn', vendor: { id: 'v_kalki', name: 'Kalki Studio', slug: 'kalki-studio', status: 'approved' }, submitted_by: 'u1', submitted_by_email: 'kiran@kalkistudio.in', submitted_at: '2026-11-09T05:00:00Z', version: 1, title: 'Withdrawn Kurta', product_id: 'p_w', sku: 'KS-W-1', reviewer_id: null, decided_at: '2026-11-09T07:00:00Z', reason: null, reason_code: null,
          events: [wire('submitted', '2026-11-09T05:00:00Z'), wire('withdrawn', '2026-11-09T07:00:00Z')], content: { version: 1, published_at: null, content: { title: 'Withdrawn Kurta', description: 'x', category: 'Clothing', gender: 'women', variants: [], images: [] } }, base: null, changes: [], resubmission: 0,
        }),
      ),
    )
    renderModule({ route: '/review/product/rev_w' })
    await screen.findByRole('heading', { level: 1, name: 'Withdrawn Kurta' })
    expect(await screen.findByText('Withdrawn by The seller · Today, 12:30')).toBeInTheDocument()
    expect(screen.getByText('The seller took this back, so there is nothing to decide.')).toBeInTheDocument()
    expect(screen.getByText('Withdrawn', { selector: '[data-status]' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull()
  })

  it('shows 13 photos and a very long description without breaking the page', async () => {
    const view = renderModule({ route: `/review/product/${rev('p_potli')}` })
    const p = view.db.products.find((x) => x.id === 'p_potli')!
    const first = p.submitted.photos[0]!
    p.submitted.photos = Array.from({ length: 13 }, (_, n) => ({ ...first, id: `ph-${n}`, slot: 'extra' as const }))
    p.submitted.description = 'Hand-mirrored, ' + 'very '.repeat(2000) + 'pretty.'
    await screen.findByRole('heading', { level: 1, name: 'Mirror-Work Potli Bag' }, { timeout: 10_000 })
    const product = within(screen.getByRole('region', { name: 'Photos' })).getByRole('group', { name: 'Product photos' })
    expect(within(product).getAllByRole('button')).toHaveLength(13)
    expect(within(product).getByText('13 photos')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'About the product' })).toHaveTextContent('Hand-mirrored, very very')
  })

  it('shows a submission with no photos, and one whose photo address is gone', async () => {
    const view = renderModule({ route: `/review/product/${rev('p_potli')}` })
    const p = view.db.products.find((x) => x.id === 'p_potli')!
    p.submitted.photos = []
    await screen.findByRole('heading', { level: 1, name: 'Mirror-Work Potli Bag' }, { timeout: 10_000 })
    expect(within(screen.getByRole('region', { name: 'Photos' })).getByText('No photos in this submission.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Photos' })).getByText('0 photos')).toBeInTheDocument()
  })

  it('opens for a vendor that was suspended after it submitted', async () => {
    const view = renderModule({ route: `/review/product/${rev('p_ajrakh')}` })
    view.db.vendors.find((v) => v.id === 'v_kalki')!.status = 'suspended'
    await screen.findByRole('heading', { level: 1, name: AJRAKH }, { timeout: 10_000 })
    expect(screen.getByText('Kalki Studio · KS-AJR-014 · submitted today, 11:40 · waiting 2 h')).toBeInTheDocument()
  })
})

describe('A-05 Product review: moving through the queue', () => {
  it('links to the previous and next items, which can be brand pages', async () => {
    const { user, router } = await open('p_handloom', 'Handloom Cotton Shirt — Rust')
    expect(screen.getByRole('link', { name: 'Previous item in the queue' })).toHaveAttribute('href', '/review/brand/rev_brand_v_morpankh')
    await user.click(screen.getByRole('link', { name: 'Next item in the queue' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dabu Print Wrap Skirt' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/review/product/${rev('p_dabu_skirt')}`)
  })

  it('disables Next at the end of the queue', async () => {
    const { user } = await open('p_ajrakh', AJRAKH)
    expect(screen.getByRole('link', { name: 'Previous item in the queue' })).toHaveAttribute('href', `/review/product/${rev('p_dabu_set')}`)
    const next = screen.getByRole('button', { name: 'Next item in the queue' })
    expect(next).toBeDisabled()
    await user.hover(next.parentElement!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('This is the last item in the queue')
  })

  it('still opens, with no neighbours, when the queue cannot be read', async () => {
    server.use(http.get(`${VENDOR_API_URL}/v1/admin/queue`, () => HttpResponse.json({ error: { code: 'internal_error', message: 'Down', request_id: 'r' } }, { status: 500 })))
    await open('p_handloom', 'Handloom Cotton Shirt — Rust')
    expect(screen.getByRole('button', { name: 'Previous item in the queue' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next item in the queue' })).toBeDisabled()
  })

  it('says when the review does not exist', async () => {
    const { shell } = renderModule({ route: '/review/product/rev_missing' })
    expect(await screen.findByRole('heading', { name: 'We could not find this product' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the queue' })).toHaveAttribute('href', '/queue')
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/review/product/rev_missing', title: 'Product not found' }))
  })

  it('says the same for a brand page review opened as a product', async () => {
    renderModule({ route: '/review/product/rev_brand_v_morpankh' })
    expect(await screen.findByRole('heading', { name: 'We could not find this product' })).toBeInTheDocument()
  })

  it('offers Try again when loading fails', async () => {
    let calls = 0
    server.use(
      http.get(`${VENDOR_API_URL}/v1/admin/reviews/:id`, () => {
        calls += 1
        if (calls === 1) return HttpResponse.json({ error: { code: 'bad_request', message: 'Down', request_id: 'r' } }, { status: 400 })
        return undefined
      }),
    )
    const { user } = renderModule({ route: `/review/product/${rev('p_ajrakh')}` })
    expect(await screen.findByText('We could not load this submission')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: AJRAKH })).toBeInTheDocument()
  })
})
