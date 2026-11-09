import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderModule, VENDOR_API_URL } from '../../test/render'
import { server } from '../../test/server'

// Monday 9 Nov 2026, 13:40 IST. The seed is built relative to it: the Ajrakh kurta came in at 11:40.
const NOW = new Date('2026-11-09T13:40:00+05:30')
const AJRAKH = 'Ajrakh Block-Print Kurta'
const CHECKS = ['Front, back and close-up photos', 'Price matches the MRP on the tag', 'Category and fabric are right', 'Not on the prohibited list', 'Description is accurate']

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

async function open(id: string, title: string) {
  const view = renderModule({ route: `/review/product/${id}` })
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

describe('A-05 Product review: a resubmission', () => {
  it('shows the header, pills, subtitle and tells the shell its title', async () => {
    const { shell } = await open('p_ajrakh', AJRAKH)
    expect(screen.getByText('Pending review')).toBeInTheDocument()
    expect(screen.getByText('Resubmission #1')).toBeInTheDocument()
    expect(screen.getByText('Kalki Studio · KS-AJR-014 · submitted today, 11:40 · waiting 2 h')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review queue' })).toHaveAttribute('href', '/queue')
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/review/product/p_ajrakh', title: AJRAKH }))
  })

  it('compares with the sent-back version and marks the rows that changed', async () => {
    await open('p_ajrakh', AJRAKH)
    const table = compareTable()
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Field', 'Sent-back version', 'This submission'])
    expect(within(table).getAllByText('Changed')).toHaveLength(2)

    const photos = rowOf(table, /^Photos/)
    expect(within(photos).getByText('Changed')).toBeInTheDocument()
    expect(cells(photos)).toEqual(['Front, close-up, extra', 'Front, back, close-up, extra'])

    const sizes = rowOf(table, /^Sizes and stock/)
    expect(within(sizes).getByText('Changed')).toBeInTheDocument()
    expect(cells(sizes)).toEqual(['XS 4 · S 8 · M 10 · L 6 · XL 0', 'XS 4 · S 8 · M 10 · L 6 · XL 3'])

    expect(cells(rowOf(table, /^Title/))).toEqual([AJRAKH, 'Same'])
    expect(cells(rowOf(table, /^Selling price/))).toEqual(['₹2,499 / ₹2,999', 'Same'])
    expect(cells(rowOf(table, /^Type · gender · fabric/))).toEqual(['Kurtas · Women · Cotton (mul)', 'Same'])
    expect(within(rowOf(table, /^Title/)).queryByText('Changed')).toBeNull()
  })

  it('truncates the description in the comparison until asked', async () => {
    const { user } = await open('p_ajrakh', AJRAKH)
    const row = rowOf(compareTable(), /^Description/)
    expect(cells(row)[0]).toMatch(/…$/)
    await user.click(within(row).getByRole('button', { name: 'Show full description' }))
    expect(cells(row)[0]).toBe('Ajrakh Block-Print Kurta in hand block-printed cotton, dyed with natural colours. Hand wash cold.')
    expect(within(row).getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('tags the new back photo and switches the main photo from the thumbnails', async () => {
    const { user } = await open('p_ajrakh', AJRAKH)
    const photos = screen.getByRole('region', { name: 'Photos' })
    expect(within(photos).getByRole('img', { name: `Front photo of ${AJRAKH}` })).toBeInTheDocument()
    const front = within(photos).getByRole('button', { name: 'Show front photo' })
    const back = within(photos).getByRole('button', { name: 'Show back photo' })
    expect(front).toHaveAttribute('aria-pressed', 'true')
    expect(back).toHaveAccessibleDescription('New in this submission')
    expect(within(back).getByText('New')).toBeInTheDocument()
    expect(within(photos).getByRole('button', { name: 'Show close-up photo' })).not.toHaveAccessibleDescription()

    await user.click(back)
    expect(within(photos).getByRole('img', { name: `Back photo of ${AJRAKH}` })).toBeInTheDocument()
    expect(back).toHaveAttribute('aria-pressed', 'true')
    expect(front).toHaveAttribute('aria-pressed', 'false')
  })

  it('lists sizes and stock, and the history with the reason quoted', async () => {
    await open('p_ajrakh', AJRAKH)
    const sizes = screen.getByRole('region', { name: 'Sizes and stock' })
    const xl = within(sizes).getByRole('rowheader', { name: 'XL' }).closest('tr')!
    expect(within(xl).getAllByRole('cell').map((c) => c.textContent)).toEqual(['KS-AJR-014-XL', '3'])

    const history = screen.getByRole('region', { name: 'History' })
    const items = within(history).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Submitted by Kiran Shah · Today, 11:40')
    expect(items[1]).toHaveTextContent('Sent back by Priya Mehta · Today, 03:40')
    expect(within(items[1]!).getByText('Back photo is missing. Add front, back and a fabric close-up so shoppers can see the print.').closest('blockquote')).not.toBeNull()
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

  it('approves: the product is approved, an event is queued, the shell gets a toast and the next item is offered', async () => {
    const { user, db, shell } = await open('p_ajrakh', AJRAKH)
    const events = db.outbox.length
    await tickAll(user)
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))

    expect(await screen.findByText('Approved. Publishing to the app.')).toBeInTheDocument()
    expect(db.products.find((p) => p.id === 'p_ajrakh')!.status).toBe('approved')
    expect(db.outbox).toHaveLength(events + 1)
    expect(db.outbox[0]).toMatchObject({ event: 'product.published', subject: AJRAKH, status: 'waiting' })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: `Approved ${AJRAKH}. Publishing to the app.` })
    // The oldest item still waiting comes next.
    expect(screen.getByRole('link', { name: 'Next item' })).toHaveAttribute('href', '/review/product/p_patola')
    expect(screen.getByRole('link', { name: 'Back to the queue' })).toHaveAttribute('href', '/queue')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull()
    expect(screen.getByText('Approved', { selector: '[data-status]' })).toBeInTheDocument()
    expect(screen.queryByText('Pending review')).toBeNull()
  })

  it('goes to the next item from the outcome', async () => {
    const { user, router } = await open('p_ajrakh', AJRAKH)
    await tickAll(user)
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))
    await user.click(await screen.findByRole('link', { name: 'Next item' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Patola Silk Stole' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/review/product/p_patola')
    // A fresh item starts with a fresh checklist.
    expect(screen.getByRole('checkbox', { name: CHECKS[0] })).not.toBeChecked()
  })

  it('shows the decided state when someone else decided first (409)', async () => {
    const { user, db } = await open('p_ajrakh', AJRAKH)
    const p = db.products.find((x) => x.id === 'p_ajrakh')!
    p.status = 'approved'
    p.history.unshift({ at: new Date(NOW.getTime() - 5 * 60_000).toISOString(), event: 'approved', by: 'Rahul Desai' })
    await tickAll(user)
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))
    expect(await screen.findByText('Someone else decided this while you were reviewing.')).toBeInTheDocument()
    expect(await screen.findByText('Already approved by Rahul Desai · Today, 13:35.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
  })

  it('shows an error and keeps the decision open when approving fails', async () => {
    server.use(http.post(`${VENDOR_API_URL}/api/v1/admin/products/:id/approve`, () => HttpResponse.json({ message: 'Something went wrong on our side.' }, { status: 500 })))
    const { user } = await open('p_ajrakh', AJRAKH)
    await tickAll(user)
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side.')
    expect(screen.getByRole('button', { name: 'Approve and publish' })).toBeEnabled()
  })
})

describe('A-06 Send back', () => {
  it('fills the message from a template, keeps edits and records the note', async () => {
    const { user, db, shell } = await open('p_ajrakh', AJRAKH)
    await user.click(screen.getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: `Send back ${AJRAKH}` })
    const message = within(dialog).getByRole('textbox', { name: 'Message to the seller' })
    expect(message).toHaveAccessibleDescription(/The seller sees this word for word\./)

    await user.click(within(dialog).getByRole('radio', { name: 'Photos' }))
    const template = 'Photos are missing or unclear. Add front, back and a fabric close-up on a plain background.'
    expect(message).toHaveValue(template)
    await user.click(message)
    await user.keyboard('{End}')
    await user.paste(' The back photo is blurred.')
    expect(within(dialog).getByText(`${template.length + 27} / 600`)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send back to seller' }))

    expect(await screen.findByText('Sent back. Kiran Shah will see your message on the product.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const p = db.products.find((x) => x.id === 'p_ajrakh')!
    expect(p.status).toBe('rejected')
    expect(p.history[0]).toMatchObject({ event: 'rejected', by: 'Priya Mehta', note: `${template} The back photo is blurred.` })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: `Sent back ${AJRAKH}. Kiran Shah will see your message.` })
    expect(screen.getByText('Sent back', { selector: '[data-status]' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull()
  })

  it('asks for a reason and at least 10 characters, and focuses the first problem', async () => {
    const { user, db } = await open('p_ajrakh', AJRAKH)
    await user.click(screen.getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: `Send back ${AJRAKH}` })
    await user.click(within(dialog).getByRole('button', { name: 'Send back to seller' }))
    expect(await within(dialog).findByText('Choose a reason.')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'Photos' })).toHaveFocus()

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
    server.use(http.post(`${VENDOR_API_URL}/api/v1/admin/products/:id/reject`, () => HttpResponse.json({ message: 'Tell the seller what to change.', extra: { code: 'validation_error', fields: { reason: 'Say which photo is missing.' } } }, { status: 422 })))
    const { user } = await open('p_ajrakh', AJRAKH)
    await user.click(screen.getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Photos' }))
    await user.click(within(dialog).getByRole('button', { name: 'Send back to seller' }))
    expect(await within(dialog).findByText('Say which photo is missing.')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Message to the seller' })).toHaveFocus()
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
    expect(within(table).getByRole('columnheader', { name: 'Live version' })).toBeInTheDocument()
    expect(cells(rowOf(table, /^Selling price/))).toEqual(['₹1,299 / ₹1,499', '₹1,199 / ₹1,499'])
    expect(within(rowOf(table, /^Selling price/)).getByText('Changed')).toBeInTheDocument()
    expect(within(rowOf(table, /^Description/)).getByText('Changed')).toBeInTheDocument()
  })

  it('hides the comparison for a first submission', async () => {
    await open('p_dabu_skirt', 'Dabu Print Wrap Skirt')
    expect(screen.queryByRole('region', { name: /^Compared with the/ })).toBeNull()
    expect(screen.queryByText('New')).toBeNull()
    expect(screen.getByRole('region', { name: 'Description' })).toHaveTextContent('Dabu Print Wrap Skirt in hand block-printed cotton')
  })

  it('flags a missing required photo', async () => {
    const view = renderModule({ route: '/review/product/p_dabu_skirt' })
    const p = view.db.products.find((x) => x.id === 'p_dabu_skirt')!
    p.submitted.images = p.submitted.images.filter((i) => i.angle !== 'back')
    await screen.findByRole('heading', { level: 1, name: 'Dabu Print Wrap Skirt' })
    const photos = screen.getByRole('region', { name: 'Photos' })
    expect(within(photos).getByText('Back photo missing')).toBeInTheDocument()
    expect(within(photos).getByText('Missing back photo. Every product needs a front, back and close-up.')).toBeInTheDocument()
  })

  it('shows a decided product read-only', async () => {
    const view = renderModule({ route: '/review/product/p_potli' })
    const p = view.db.products.find((x) => x.id === 'p_potli')!
    p.status = 'rejected'
    p.history.unshift({ at: new Date(NOW.getTime() - 30 * 60_000).toISOString(), event: 'rejected', by: 'Rahul Desai', note: 'Price is above the MRP.' })
    await screen.findByRole('heading', { level: 1, name: 'Mirror-Work Potli Bag' })
    expect(await screen.findByText('Already sent back by Rahul Desai · Today, 13:10.')).toBeInTheDocument()
    expect(screen.getByText('Sent back', { selector: '[data-status]' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull()
  })
})

describe('A-05 Product review: moving through the queue', () => {
  it('links to the previous and next items, which can be brand pages', async () => {
    const { user, router } = await open('p_handloom', 'Handloom Cotton Shirt — Rust')
    expect(screen.getByRole('link', { name: 'Previous item in the queue' })).toHaveAttribute('href', '/review/brand/v_morpankh')
    await user.click(screen.getByRole('link', { name: 'Next item in the queue' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dabu Print Wrap Skirt' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/review/product/p_dabu_skirt')
  })

  it('disables Next at the end of the queue', async () => {
    const { user } = await open('p_ajrakh', AJRAKH)
    expect(screen.getByRole('link', { name: 'Previous item in the queue' })).toHaveAttribute('href', '/review/product/p_dabu_set')
    const next = screen.getByRole('button', { name: 'Next item in the queue' })
    expect(next).toBeDisabled()
    await user.hover(next.parentElement!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('This is the last item in the queue')
  })

  it('says when the product does not exist', async () => {
    const { shell } = renderModule({ route: '/review/product/p_missing' })
    expect(await screen.findByRole('heading', { name: 'We could not find this product' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the queue' })).toHaveAttribute('href', '/queue')
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/review/product/p_missing', title: 'Product not found' }))
  })

  it('offers Try again when loading fails', async () => {
    let calls = 0
    server.use(
      http.get(`${VENDOR_API_URL}/api/v1/admin/products/:id/review`, () => {
        calls += 1
        if (calls === 1) return HttpResponse.json({ message: 'Down' }, { status: 400 })
        return undefined
      }),
    )
    const { user } = renderModule({ route: '/review/product/p_ajrakh' })
    expect(await screen.findByText('We could not load this submission.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: AJRAKH })).toBeInTheDocument()
  })
})
