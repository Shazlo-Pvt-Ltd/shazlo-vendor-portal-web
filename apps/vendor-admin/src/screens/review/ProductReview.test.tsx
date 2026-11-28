import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { neutral } from '@shazlo/ui'
import { renderModule, VENDOR_API_URL } from '../../test/render'
import { server } from '../../test/server'
import { isBold, isSecondary, isSemibold, rgb } from '../../test/style'

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

async function open(id: string, title: string) {
  const view = renderModule({ route: `/review/product/${id}` })
  // The first screen in a file compiles on demand; give it room.
  await screen.findByRole('heading', { level: 1, name: title }, { timeout: 10_000 })
  return view
}

const compareTable = () => within(screen.getByRole('region', { name: /^Compared with the/ })).getByRole('table')
const rowOf = (table: HTMLElement, field: RegExp) => within(table).getByRole('rowheader', { name: field }).closest('tr')!
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent)

// A reference table's header row: semibold on the muted fill, over a firm rule.
function expectHeaderRow(table: HTMLElement) {
  for (const th of within(table).getAllByRole('columnheader')) {
    expect(isSemibold(th)).toBe(true)
    expect(getComputedStyle(th).backgroundColor).toBe(rgb(neutral.muted))
    expect(getComputedStyle(th).borderBottomWidth).toBe('2px')
    expect(getComputedStyle(th).borderBottomColor).toBe(rgb(neutral.lineStrong))
  }
}

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
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/review/product/p_ajrakh', title: AJRAKH }))
  })

  it('compares with the sent-back version and marks the rows that changed', async () => {
    await open('p_ajrakh', AJRAKH)
    const table = compareTable()
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Field', 'Sent-back version', 'This submission'])
    expect(within(table).getAllByText('Changed')).toHaveLength(3)

    const photos = rowOf(table, /^Product photos/)
    expect(within(photos).getByText('Changed')).toBeInTheDocument()
    expect(cells(photos)).toEqual(['Front, detail, worn, extra', 'Front, back, detail, worn, extra'])
    const tryOn = rowOf(table, /^Try-on photos/)
    expect(within(tryOn).getByText('Changed')).toBeInTheDocument()
    expect(cells(tryOn)).toEqual(['3 photos', '5 photos'])

    const sizes = rowOf(table, /^Sizes and stock/)
    expect(within(sizes).getByText('Changed')).toBeInTheDocument()
    expect(cells(sizes)).toEqual(['XS 4 · S 8 · M 10 · L 6 · XL 0', 'XS 4 · S 8 · M 10 · L 6 · XL 3'])

    expect(cells(rowOf(table, /^Title/))).toEqual([AJRAKH, 'Same'])
    expect(cells(rowOf(table, /^Selling price/))).toEqual(['₹2,499 / ₹2,999', 'Same'])
    expect(cells(rowOf(table, /^Gender · product type/))).toEqual(['Women · Kurtas', 'Same'])
    expect(cells(rowOf(table, /^Colours/))).toEqual(['Indigo, also Madder red', 'Same'])
    expect(cells(rowOf(table, /^Material/))).toEqual(['Cotton (mul)', 'Same'])
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

  it('shows the product photos and the try-on photos by name, tags new ones and switches the main photo', async () => {
    const { user } = await open('p_ajrakh', AJRAKH)
    const photos = screen.getByRole('region', { name: 'Photos' })
    expect(within(photos).getByRole('img', { name: `Front photo of ${AJRAKH}` })).toBeInTheDocument()

    const product = within(photos).getByRole('group', { name: 'Product photos' })
    expect(within(product).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Show front photo', 'Show back photo', 'Show detail photo', 'Show worn photo', 'Show extra photo'])
    expect(within(product).getByText('4 of 4 · 1 extra')).toBeInTheDocument()
    const front = within(product).getByRole('button', { name: 'Show front photo' })
    const back = within(product).getByRole('button', { name: 'Show back photo' })
    expect(front).toHaveAttribute('aria-pressed', 'true')
    expect(back).toHaveAccessibleDescription('New in this submission')
    expect(within(back).getByText('New')).toBeInTheDocument()
    expect(within(product).getByRole('button', { name: 'Show detail photo' })).not.toHaveAccessibleDescription()

    const tryOn = within(photos).getByRole('group', { name: 'Try-on photos' })
    expect(within(tryOn).getByText('Real people wearing it, so shoppers see the true fit.')).toBeInTheDocument()
    expect(within(tryOn).getByText('5 of 5')).toBeInTheDocument()
    expect(within(tryOn).getAllByRole('button')).toHaveLength(5)
    expect(within(tryOn).getByRole('button', { name: 'Show try-on 3 photo' })).not.toHaveAccessibleDescription()
    expect(within(tryOn).getByRole('button', { name: 'Show try-on 4 photo' })).toHaveAccessibleDescription('New in this submission')
    expect(within(photos).queryByText(/missing/)).toBeNull()

    await user.click(back)
    expect(within(photos).getByRole('img', { name: `Back photo of ${AJRAKH}` })).toBeInTheDocument()
    expect(back).toHaveAttribute('aria-pressed', 'true')
    expect(front).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(tryOn).getByRole('button', { name: 'Show try-on 2 photo' }))
    expect(within(photos).getByRole('img', { name: `Try-on 2 photo of ${AJRAKH}` })).toBeInTheDocument()
    expect(back).toHaveAttribute('aria-pressed', 'false')
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

  it('shows the size chart the brand saved for kurtas, in cm', async () => {
    await open('p_ajrakh', AJRAKH)
    const chart = screen.getByRole('region', { name: 'Size chart' })
    expect(within(chart).getByText('Used for all their kurtas. Measurements in cm.')).toBeInTheDocument()
    const table = within(chart).getByRole('table')
    // Each measurement column names its unit.
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Size', 'Chest (cm)', 'Waist (cm)', 'Length (cm)', 'Shoulder (cm)'])
    const xs = within(table).getByRole('rowheader', { name: 'XS' }).closest('tr')!
    expect(within(xs).getAllByRole('cell').map((c) => c.textContent)).toEqual(['86', '76', '104', '—'])
    const m = within(table).getByRole('rowheader', { name: 'M' }).closest('tr')!
    expect(within(m).getAllByRole('cell').map((c) => c.textContent)).toEqual(['96', '86', '106', '36.5'])
  })

  it('sets the size chart apart: a muted header row, size labels in semibold, a rule between columns', async () => {
    await open('p_ajrakh', AJRAKH)
    const table = within(screen.getByRole('region', { name: 'Size chart' })).getByRole('table')
    expectHeaderRow(table)
    const chest = within(table).getByRole('columnheader', { name: 'Chest (cm)' })
    expect(isSecondary(within(chest).getByText('(cm)'))).toBe(true)
    const m = within(table).getByRole('rowheader', { name: 'M' })
    expect(isSemibold(m)).toBe(true)
    // A rule under every row but the last, and between the columns.
    const lastRow = within(table).getAllByRole('row').at(-1)
    for (const cell of within(m.closest('tr')!).getAllByRole('cell')) {
      expect(getComputedStyle(cell).borderBottomColor).toBe(rgb(neutral.line))
      expect(getComputedStyle(cell).borderLeftColor).toBe(rgb(neutral.line))
      expect(getComputedStyle(cell).textAlign).toBe('right')
    }
    expect(getComputedStyle(within(lastRow!).getAllByRole('cell')[0]!).borderBottomWidth).toMatch(/^0(px)?$/)
  })

  it('shows a size chart photo, or says there is none', async () => {
    await open('p_handloom', 'Handloom Cotton Shirt — Rust')
    const chart = screen.getByRole('region', { name: 'Size chart' })
    expect(within(chart).getByRole('img', { name: 'The brand’s size chart for shirts' })).toBeInTheDocument()
    expect(within(chart).getByText('Used for all their shirts. A photo of their own chart.')).toBeInTheDocument()
  })

  it('sets the sizes table apart: a muted header row, semibold sizes, mono codes, right-aligned stock and a bold total', async () => {
    await open('p_ajrakh', AJRAKH)
    const table = within(screen.getByRole('region', { name: 'Sizes and stock' })).getByRole('table')
    expectHeaderRow(table)
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Size', 'Code', 'Stock'])
    expect(getComputedStyle(within(table).getByRole('columnheader', { name: 'Stock' })).textAlign).toBe('right')

    const xl = within(table).getByRole('rowheader', { name: 'XL' })
    expect(isSemibold(xl)).toBe(true)
    const [code, stock] = within(xl.closest('tr')!).getAllByRole('cell')
    expect(getComputedStyle(code!).fontFamily).toMatch(/monospace/)
    expect(isSecondary(code!)).toBe(true)
    expect(getComputedStyle(stock!).textAlign).toBe('right')
    expect(getComputedStyle(xl).borderBottomColor).toBe(rgb(neutral.line))

    // The total reads as a total: bold, over a firm rule.
    const total = within(table).getByRole('rowheader', { name: 'Total' })
    const totalRow = total.closest('tr')!
    expect(totalRow).toHaveAttribute('data-total')
    expect(within(totalRow).getAllByRole('cell').map((c) => c.textContent)).toEqual(['', '31'])
    for (const cell of [total, ...within(totalRow).getAllByRole('cell')]) {
      expect(getComputedStyle(cell).borderTopWidth).toBe('2px')
      expect(getComputedStyle(cell).borderTopColor).toBe(rgb(neutral.lineStrong))
    }
    expect(isBold(total)).toBe(true)
    expect(isBold(within(totalRow).getByText('31'))).toBe(true)
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
    expect(within(items[1]!).getByText('The back photo is missing and there are only 3 try-on photos. Add the back photo and 5 try-on photos so shoppers can see the print and the fit.').closest('blockquote')).not.toBeNull()
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
    // The page first says "someone else decided" alone, then again with who and when once it has
    // reloaded the item: wait for the settled page, or the first message can be swapped out from under the check.
    expect(await screen.findByText('Already approved by Rahul Desai · Today, 13:35')).toBeInTheDocument()
    expect(screen.getByText('Someone else decided this while you were reviewing.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
  })

  it('shows an error and keeps the decision open when approving fails', async () => {
    server.use(http.post(`${VENDOR_API_URL}/api/v1/admin/products/:id/approve`, () => HttpResponse.json({ error: { code: 'internal_error', message: 'Something went wrong on our side.', request_id: 'r' } }, { status: 500 })))
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
    server.use(http.post(`${VENDOR_API_URL}/api/v1/admin/products/:id/reject`, () => HttpResponse.json({ error: { code: 'validation_error', message: 'Request validation failed', request_id: 'r', details: [{ loc: ['body', 'reason'], msg: 'Say which photo is missing.', type: 'value_error' }] } }, { status: 422 })))
    const { user } = await open('p_ajrakh', AJRAKH)
    await user.click(screen.getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Product photos' }))
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
    expect(screen.getByRole('region', { name: 'About the product' })).toHaveTextContent('Dabu Print Wrap Skirt in hand block-printed cotton')
    expect(screen.queryByRole('region', { name: 'Size chart' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Sizes and stock' })).toHaveTextContent('No size chart for skirts.')
    expect(screen.getByRole('region', { name: 'Price' })).toHaveTextContent('Shoppers see ₹1,450, the lower of the two.')
  })

  it('flags a missing required photo', async () => {
    const view = renderModule({ route: '/review/product/p_dabu_skirt' })
    const p = view.db.products.find((x) => x.id === 'p_dabu_skirt')!
    p.submitted.photos = p.submitted.photos.filter((i) => i.slot !== 'back')
    await screen.findByRole('heading', { level: 1, name: 'Dabu Print Wrap Skirt' })
    const photos = screen.getByRole('region', { name: 'Photos' })
    expect(within(photos).getByText('Back photo missing')).toBeInTheDocument()
    expect(within(photos).getByText('3 of 4')).toBeInTheDocument()
    expect(within(photos).getByText('Missing back photo. Every product needs front, back, detail and worn photos.')).toBeInTheDocument()
  })

  it('flags missing try-on photos', async () => {
    await open('p_dabu_set', 'Indigo Dabu Kurta Set')
    const tryOn = within(screen.getByRole('region', { name: 'Photos' })).getByRole('group', { name: 'Try-on photos' })
    expect(within(tryOn).getByText('2 of 5')).toBeInTheDocument()
    expect(within(tryOn).getAllByRole('button')).toHaveLength(2)
    for (const n of [3, 4, 5]) expect(within(tryOn).getByText(`Try-on ${n} photo missing`)).toBeInTheDocument()
    expect(within(tryOn).getByText('3 of 5 try-on photos missing. Every product needs 5 photos of real people wearing it.')).toBeInTheDocument()
  })

  it('says when the selling price is above the MRP, and shows a missing MRP', async () => {
    const view = renderModule({ route: '/review/product/p_patola' })
    view.db.products.find((x) => x.id === 'p_patola')!.submitted.price_paise = 5999_00
    await screen.findByRole('heading', { level: 1, name: 'Patola Silk Stole' }, { timeout: 10_000 })
    const price = screen.getByRole('region', { name: 'Price' })
    expect(within(price).getByText('The selling price is above the MRP. The app shows the lower price, ₹5,499.')).toBeInTheDocument()
    expect(cells(rowOf(compareTable(), /^Selling price/))).toEqual(['₹5,999 / ₹5,499', 'Same'])
    expect(cells(rowOf(compareTable(), /^Material/))).toEqual(['Silk', 'Pure silk, double ikat'])
  })

  it('shows an MRP that was not given', async () => {
    await open('p_pochampally', 'Pochampally Ikat Kurta')
    const price = screen.getByRole('region', { name: 'Price' })
    expect(within(price).getByText('MRP', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Not given')
    expect(within(price).getByText('Shoppers see ₹2,299.')).toBeInTheDocument()
  })

  it('shows a decided product read-only', async () => {
    const view = renderModule({ route: '/review/product/p_potli' })
    const p = view.db.products.find((x) => x.id === 'p_potli')!
    p.status = 'rejected'
    p.history.unshift({ at: new Date(NOW.getTime() - 30 * 60_000).toISOString(), event: 'rejected', by: 'Rahul Desai', note: 'Price is above the MRP.' })
    await screen.findByRole('heading', { level: 1, name: 'Mirror-Work Potli Bag' })
    expect(await screen.findByText('Already sent back by Rahul Desai · Today, 13:10')).toBeInTheDocument()
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
        if (calls === 1) return HttpResponse.json({ error: { code: 'bad_request', message: 'Down', request_id: 'r' } }, { status: 400 })
        return undefined
      }),
    )
    const { user } = renderModule({ route: '/review/product/p_ajrakh' })
    expect(await screen.findByText('We could not load this submission')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: AJRAKH })).toBeInTheDocument()
  })
})
