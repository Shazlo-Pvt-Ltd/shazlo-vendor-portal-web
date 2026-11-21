import { configure, screen, waitFor, within } from '@testing-library/react'
import { File as NodeFile } from 'node:buffer'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MockDb } from '../../mocks/db'
import { renderApp } from '../../test/render'

// The editor renders a large MUI tree, and on slow machines working out every element's
// accessible name (ByRole with a name) takes seconds. These tests find controls by their label or
// text inside a small part of the page, and keep ByRole for the semantics worth checking.
configure({ asyncUtilTimeout: 8000, defaultHidden: true })
const SAVED = { timeout: 8000 }
const LONG = 45_000

const product = (db: MockDb, id: string) => db.products.find((p) => p.id === id)!
const angles = (db: MockDb, id: string) => product(db, id).images.map((i) => i.angle)
const count = (db: MockDb, id: string, angle: string) => angles(db, id).filter((a) => a === angle).length

// A form part: its card (or, on a phone step, its section) by the heading or label that names it.
function part(name: string): HTMLElement {
  const labelled = document.querySelector<HTMLElement>(`section[aria-label="${name}"]`)
  if (labelled) return labelled
  const heading = screen.getAllByText(name, { selector: 'h2' }).find((h) => h.closest('section'))
  if (!heading) throw new Error(`No part named ${name}`)
  return heading.closest('section')!
}
const findPart = (name: string) => waitFor(() => part(name))
const list = (name: string) => document.querySelector<HTMLElement>(`ul[aria-label="${name}"]`)!
const fieldset = (legend: string, root: HTMLElement = document.body) => within(root).getByText(legend, { selector: 'legend' }).closest('fieldset')!
const button = (name: string | RegExp, root: HTMLElement = document.body) => within(root).getByText(name, { selector: 'button' })
const queryButton = (name: string | RegExp, root: HTMLElement = document.body) => within(root).queryByText(name, { selector: 'button' })
const bannerWith = (text: string | RegExp) => screen.getByText(text).closest<HTMLElement>('[role="alert"], [role="status"]')!
const h1 = () => document.querySelector('h1')
const findH1 = (text: string) => waitFor(() => expect(h1()?.textContent).toBe(text))
// Node's File, not jsdom's: the upload goes through Node's fetch and FormData, which only accept their own.
const png = (name: string) => new NodeFile([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' }) as unknown as File
const pngs = (...names: string[]) => names.map(png)
// The status word next to the page title.
const statusText = () => h1()!.parentElement!.querySelector('[data-status]')
const openMenu = () => document.querySelector<HTMLElement>('[role="menu"]')
const findMenu = () => waitFor(() => expect(openMenu()).not.toBeNull())
const menuClosed = () => waitFor(() => expect(openMenu()).toBeNull())
const menuItems = () => within(openMenu()!).getAllByRole('menuitem').map((m) => m.textContent)
const menuItem = (name: string) => within(openMenu()!).getByText(name)

describe('V-07 Product editor', () => {
  // The route lazy-loads the screen; load it once up front so the first test is not timing a cold import.
  beforeAll(async () => {
    await import('./ProductEditor')
    await import('./ProductList')
  }, 120_000)

  it('shows a sent-back product: reason, photo groups, details, sizes, price and what the seller receives', { timeout: LONG }, async () => {
    await renderApp({ route: '/products/p_001' })
    expect(await screen.findByRole('status', { name: 'Loading product' })).toBeInTheDocument()
    await findH1('Ajrakh Block-Print Kurta')
    expect(statusText()).toHaveTextContent('Needs changes')
    expect(screen.getByText(/^Code KS-AJR-014 ·/)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Products›Ajrakh Block-Print Kurta')

    const note = bannerWith(/^“Back photo is missing, and there are only 2 try-on photos/)
    expect(note).toHaveAttribute('role', 'alert')
    expect(note).toHaveTextContent(/Shazlo review team · (2 h ago|Yesterday)/)
    expect(button('Send for review again')).toHaveClass('MuiButton-contained')
    // One main button on the page.
    expect(document.querySelectorAll('main .MuiButton-contained')).toHaveLength(1)

    // Photos: 4 named slots and extras, then 5 try-on slots, with counts.
    const photos = part('Photos')
    expect(within(photos).getByText('5 of 9 added')).toBeInTheDocument()
    expect(within(photos).getByText('3 of 4 added')).toBeInTheDocument()
    expect(within(photos).getByText('2 of 5 added')).toBeInTheDocument()
    expect(within(photos).getByText('Real people wearing it, so shoppers see the true fit')).toBeInTheDocument()
    const productPhotos = list('Product photos')
    for (const name of ['Front photo', 'Detail photo', 'Worn photo', 'Extra photo 1']) expect(within(productPhotos).getByAltText(name)).toBeInTheDocument()
    expect(within(productPhotos).getByText(/Main photo/)).toBeInTheDocument()
    expect(within(productPhotos).getByLabelText('Add back photo')).toHaveAccessibleDescription('Back photo is missing.')
    expect(within(productPhotos).getByLabelText('Add extra photos')).toBeInTheDocument()
    const tryons = list('Try-on photos')
    expect(within(tryons).getAllByRole('img')).toHaveLength(2)
    expect(within(tryons).getByLabelText('Add try-on photo 3')).toBeInTheDocument()
    expect(within(tryons).getByLabelText('Add try-on photo 5')).toBeInTheDocument()
    expect(button('Choose photos', photos)).toBeInTheDocument()
    expect(button('Choose try-on photos', photos)).toBeInTheDocument()
    // Desktop: no camera button; the pickers keep the gallery.
    expect(queryButton('Take photo', photos)).toBeNull()

    // About the product: chips and swatches, in the PDF's order.
    const about = part('About the product')
    expect(within(about).getByLabelText('Name')).toHaveValue('Ajrakh Block-Print Kurta')
    expect(within(fieldset('Gender', about)).getByLabelText('Women')).toBeChecked()
    const types = fieldset('Product type', about)
    expect(within(types).getAllByRole('radio')).toHaveLength(17)
    expect(within(types).getByLabelText('Kurtas')).toBeChecked()
    const main = fieldset('Main colour', about)
    expect(within(main).getByLabelText('Indigo')).toBeChecked()
    expect(within(main).getByLabelText('Multicolour')).toBeInTheDocument()
    const others = fieldset('Other colours (optional)', about)
    expect(within(others).getByLabelText('Red')).toBeChecked()
    expect(within(others).getByLabelText('Black')).toBeChecked()
    expect(within(others).getByLabelText('White')).toBeDisabled()
    expect(within(others).queryByLabelText('Indigo')).toBeNull()
    expect(within(about).getByLabelText('Material')).toHaveValue('Cotton mul')
    expect(within(about).getByLabelText('Material')).toHaveAccessibleDescription('For example: 100% linen')

    const sizes = part('Sizes and stock')
    expect(within(sizes).getByText('28 in stock across 5 sizes')).toBeInTheDocument()
    expect(within(sizes).getByText('Code KS-AJR-014-XL · Sold out')).toBeInTheDocument()
    expect(button('Size chart (optional)', sizes)).toHaveAttribute('aria-expanded', 'false')

    const price = part('Price')
    expect(within(price).getByLabelText('Selling price')).toHaveValue('2,499')
    expect(within(price).getByLabelText('MRP (optional)')).toHaveValue('2,999')
    expect(within(price).getByLabelText('Selling price')).toHaveAttribute('inputmode', 'decimal')
    expect(await within(price).findByText('You receive ₹2,199 after 12% commission (₹300)')).toBeInTheDocument()
    expect(within(price).getByText('Price rule: your price on Shazlo is never higher than anywhere else.')).toBeInTheDocument()

    const returns = part('Returns and delivery')
    expect(returns).toHaveTextContent('Returns and delivery come from your store details.')
    expect(await within(returns).findByText(/This store takes returns within 7 days\./)).toBeInTheDocument()
    expect(within(returns).getByText('Store details')).toHaveAttribute('href', '/store/details/returns')

    const events = within(part('Review history')).getAllByRole('listitem')
    expect(events).toHaveLength(3)
    expect(events[0]).toHaveTextContent(/^Sent back/)
    expect(events[1]).toHaveTextContent(/^Sent for review/)
    expect(events[2]).toHaveTextContent(/^Created as draft/)

    // Plain words only, and no asterisks on required fields.
    // (Case matters: "KurtasKurtis" in the chips' text would otherwise read as "sKu".)
    expect(screen.getByRole('main')).not.toHaveTextContent(/SKU|[Vv]ariant|[Ll]isting|[Cc]atalogue|\*/)
    expect(screen.queryByText('What needs review again')).toBeNull()
    expect(screen.getByTestId('editor-columns')).toHaveAttribute('data-layout', 'two-column')
  })

  it('autosaves a second after typing stops', { timeout: LONG }, async () => {
    // The seed saved this product 2 hours before "now", and "2 h ago" is said only for earlier the
    // same day in IST: between midnight and 2 am it is "Yesterday". Pin the clock to midday (only
    // Date: timers, user-event and the autosave delay run as usual).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-20T12:00:00+05:30'))
    try {
      const { user, db } = await renderApp({ route: '/products/p_001' })
      const name = await screen.findByLabelText('Name')
      expect(screen.getByText(/^Saved · 2 h ago$/)).toBeInTheDocument()
      await user.clear(name)
      await user.type(name, 'Ajrakh Kurta — Indigo')
      await waitFor(() => expect(product(db, 'p_001').title).toBe('Ajrakh Kurta — Indigo'), SAVED)
      expect(await screen.findByText('Saved · just now')).toBeInTheDocument()
      expect(h1()).toHaveTextContent('Ajrakh Kurta — Indigo')
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves gender, colours and material from the chips and fields', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: '/products/p_008' })
    const about = await findPart('About the product')
    expect(within(fieldset('Product type', about)).getByLabelText('Shirts')).toBeChecked()
    expect(within(about).queryByText('Other colours (optional)')).toBeNull()

    await user.click(within(fieldset('Gender', about)).getByLabelText('Men'))
    await user.click(within(fieldset('Main colour', about)).getByLabelText('Indigo'))
    await user.click(button('Add another colour (up to 2)', about))
    const others = fieldset('Other colours (optional)', about)
    expect(within(others).queryByLabelText('Indigo')).toBeNull()
    await user.click(within(others).getByLabelText('White'))
    await user.click(within(others).getByLabelText('Black'))
    expect(within(others).getByLabelText('Red')).toBeDisabled()
    await user.type(within(about).getByLabelText('Material'), '100% kala cotton')
    await waitFor(() => expect(product(db, 'p_008')).toMatchObject({ gender: 'Men', main_colour: 'Indigo', other_colours: ['White', 'Black'], material: '100% kala cotton' }), SAVED)

    // A new main colour leaves the other colours.
    await user.click(within(fieldset('Main colour', about)).getByLabelText('White'))
    await waitFor(() => expect(product(db, 'p_008')).toMatchObject({ main_colour: 'White', other_colours: ['Black'] }), SAVED)
  })

  it('checks the price against the MRP when sending, not while typing, and only saves a valid price', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const selling = await screen.findByLabelText('Selling price')
    expect(selling).toHaveAccessibleDescription('What shoppers pay, in rupees.')

    await user.clear(selling)
    await user.type(selling, '3,500')
    await user.tab()
    expect(selling).toHaveValue('3,500')
    expect(selling).toHaveAttribute('aria-invalid', 'false')
    expect(within(part('Price')).getByText('Fix the selling price to see what you receive.')).toBeInTheDocument()

    await user.click(button('Send for review again'))
    await waitFor(() => expect(selling).toHaveAttribute('aria-invalid', 'true'))
    expect(selling).toHaveAccessibleDescription('Selling price cannot be above the MRP.')
    expect(selling).toHaveFocus()
    expect(product(db, 'p_001').status).toBe('rejected')

    // The error goes as soon as the price is fixed.
    await user.clear(selling)
    await user.type(selling, '1999')
    await waitFor(() => expect(selling).toHaveAttribute('aria-invalid', 'false'))
    expect(within(part('Price')).getByText('You receive ₹1,759 after 12% commission (₹240)')).toBeInTheDocument()
    await waitFor(() => expect(product(db, 'p_001').price_paise).toBe(199900), SAVED)
    expect(product(db, 'p_001').mrp_paise).toBe(299900)
  })

  it('says where to agree a commission while none is agreed', { timeout: LONG }, async () => {
    const { db, context } = await renderApp({ route: '/products/p_001' })
    const price = await findPart('Price')
    expect(await within(price).findByText(/^You receive ₹2,199/)).toBeInTheDocument()
    db.commission = { state: 'not_set', agreed_bps: null, proposed_bps: null, note: null, updated_at: null }
    await context.queryClient.invalidateQueries({ queryKey: ['me'] })
    expect(await within(price).findByText(/^You will see what you receive once your commission is agreed\./)).toBeInTheDocument()
    expect(within(price).getByText('Store details › Commission')).toHaveAttribute('href', '/store/details#commission')
    expect(price).not.toHaveTextContent(/You receive ₹|15%/)
  })

  it('adds sizes with chips and sets stock with typing and the − / + buttons', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const sizes = await findPart('Sizes and stock')
    // Kurtas: letter sizes and One size, no waist sizes.
    expect(queryButton('32', sizes)).toBeNull()
    expect(button('One size', sizes)).toBeInTheDocument()
    const xxl = button('XXL', sizes)
    expect(xxl).toHaveAttribute('aria-pressed', 'false')

    await user.click(xxl)
    expect(xxl).toHaveAttribute('aria-pressed', 'true')
    const xxlStock = within(sizes).getByLabelText('Stock for XXL')
    expect(xxlStock).toHaveValue('0')
    expect(xxlStock).toHaveAttribute('inputmode', 'numeric')
    expect(within(sizes).getByText('Code KS-AJR-014-XXL · Sold out')).toBeInTheDocument()
    expect(within(sizes).getByLabelText('One less in stock for XXL')).toBeDisabled()
    for (let i = 0; i < 3; i++) await user.click(within(sizes).getByLabelText('One more in stock for XXL'))
    await user.click(within(sizes).getByLabelText('One less in stock for XXL'))
    expect(xxlStock).toHaveValue('2')

    await user.click(button('XS', sizes))
    expect(within(sizes).queryByLabelText('Stock for XS')).toBeNull()

    const m = within(sizes).getByLabelText('Stock for M')
    await user.clear(m)
    await user.type(m, '15x')
    expect(m).toHaveValue('15')
    expect(within(sizes).getByText('31 in stock across 5 sizes')).toBeInTheDocument()

    await waitFor(
      () =>
        expect(product(db, 'p_001').variants).toEqual([
          { size: 'S', sku: 'KS-AJR-014-S', stock: 8 },
          { size: 'M', sku: 'KS-AJR-014-M', stock: 15 },
          { size: 'L', sku: 'KS-AJR-014-L', stock: 6 },
          { size: 'XL', sku: 'KS-AJR-014-XL', stock: 0 },
          { size: 'XXL', sku: 'KS-AJR-014-XXL', stock: 2 },
        ]),
      SAVED,
    )

    // Jeans and trousers offer waist sizes 26–40.
    await user.click(within(fieldset('Product type')).getByLabelText('Jeans'))
    expect(within(sizes).getByText('Waist sizes', { selector: 'p' })).toBeInTheDocument()
    expect(button('26', sizes)).toBeInTheDocument()
    expect(button('40', sizes)).toBeInTheDocument()
  })

  it('fills empty slots in order when several photos are picked at once', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const photos = await findPart('Photos')
    const productInput = within(photos).getByLabelText('Product photo files')
    expect(productInput).toHaveAttribute('accept', 'image/*')
    expect(productInput).toHaveAttribute('multiple')
    expect(productInput).not.toHaveAttribute('capture')

    // The empty Back slot first, then the next extra slot.
    await user.upload(productInput, pngs('a.png', 'b.png'))
    await waitFor(() => expect(count(db, 'p_001', 'extra')).toBe(2), SAVED)
    expect(count(db, 'p_001', 'back')).toBe(1)
    expect(await within(list('Product photos')).findByAltText('Back photo')).toBeInTheDocument()
    expect(within(list('Product photos')).getByAltText('Extra photo 2')).toBeInTheDocument()
    expect(within(photos).getByText('4 of 4 added')).toBeInTheDocument()

    // Five try-on slots: two taken, so one of four new photos does not fit.
    await user.upload(within(photos).getByLabelText('Try-on photo files'), pngs('t1.png', 't2.png', 't3.png', 't4.png'))
    expect(await within(photos).findByText('1 photo was not added. You can add up to 5 try-on photos.')).toBeInTheDocument()
    await waitFor(() => expect(count(db, 'p_001', 'tryon')).toBe(5), SAVED)
    await waitFor(() => expect(within(list('Try-on photos')).getAllByAltText(/^Try-on photo/)).toHaveLength(5))
    expect(within(photos).getByText('9 of 9 added')).toBeInTheDocument()
    expect(within(photos).queryByText(/is missing/)).toBeNull()
  })

  it('keeps a failed photo with its preview and the reason, and tries again', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const photos = await findPart('Photos')
    db.failNext = { path: '/uploads/presign', status: 415, code: 'unsupported_media_type', message: 'Use a JPG, PNG or WebP photo.' }
    await user.upload(within(photos).getByLabelText('Try-on photo files'), png('tryon.png'))

    const tryons = list('Try-on photos')
    const alert = await within(tryons).findByText('Not added. Use a JPG, PNG or WebP photo.')
    expect(alert.closest('[role="alert"]')).not.toBeNull()
    // The preview stays in the slot.
    expect(alert.closest('li')!.querySelector('img')).toHaveAttribute('src')
    expect(count(db, 'p_001', 'tryon')).toBe(2)

    await user.click(within(tryons).getByLabelText('Try again: try-on photo 3'))
    expect(await within(tryons).findByAltText('Try-on photo 3')).toBeInTheDocument()
    expect(within(tryons).queryByText(/^Not added/)).toBeNull()
    expect(count(db, 'p_001', 'tryon')).toBe(3)
  })

  it('makes another photo the main one, moves and removes photos without dragging', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    await findPart('Photos')
    const front = product(db, 'p_001').images.find((i) => i.angle === 'front')!.id
    const worn = product(db, 'p_001').images.find((i) => i.angle === 'worn')!.id
    const angleOf = (id: string) => product(db, 'p_001').images.find((i) => i.id === id)!.angle

    await user.click(within(list('Product photos')).getByLabelText('Options for worn photo'))
    await findMenu()
    expect(menuItems()).toEqual(['Make main photo', 'Move left', 'Move right', 'Replace photo', 'Remove photo'])
    await user.click(menuItem('Make main photo'))
    await waitFor(() => expect(angleOf(worn)).toBe('front'))
    expect(angleOf(front)).toBe('worn')
    await menuClosed()

    // The front photo has no "Make main photo"; the first extra moves left into Worn.
    await user.click(within(list('Product photos')).getByLabelText('Options for front photo'))
    await findMenu()
    expect(menuItems()).toEqual(['Move right', 'Replace photo', 'Remove photo'])
    await user.keyboard('{Escape}')
    await menuClosed()

    const extra = product(db, 'p_001').images.find((i) => i.angle === 'extra')!.id
    await user.click(within(list('Product photos')).getByLabelText('Options for extra photo 1'))
    await findMenu()
    expect(menuItems()).toEqual(['Make main photo', 'Move left', 'Remove photo'])
    await user.click(menuItem('Move left'))
    await waitFor(() => expect(angleOf(extra)).toBe('worn'))
    expect(angleOf(front)).toBe('extra')
    await menuClosed()

    await user.click(within(list('Try-on photos')).getByLabelText('Options for try-on photo 1'))
    await findMenu()
    expect(menuItems()).toEqual(['Remove photo'])
    await user.click(menuItem('Remove photo'))
    await waitFor(() => expect(count(db, 'p_001', 'tryon')).toBe(1))
    expect(await screen.findByText('Try-on photo 1 removed.')).toBeInTheDocument()
  })

  it('saves the size chart for the product type group, keeping sizes other products use', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const sizes = await findPart('Sizes and stock')
    const toggle = button('Size chart (optional)', sizes)
    expect(within(sizes).queryByLabelText('Bust for M, in cm')).toBeNull()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await within(sizes).findByText('Used for all your kurtas, kurtis, lehengas, dresses and co-ords')).toBeInTheDocument()
    expect(within(sizes).getByLabelText('Bust for M, in cm')).toHaveValue('91')
    expect(within(sizes).getByLabelText('Bust for M, in cm')).toHaveAttribute('inputmode', 'decimal')
    expect(within(sizes).getByLabelText('Bust for XL, in cm')).toHaveValue('')

    await user.type(within(sizes).getByLabelText('Bust for XL, in cm'), '101')
    await user.type(within(sizes).getByLabelText('Waist for XL, in cm'), '400')
    await user.click(button('Save size chart', sizes))
    expect(await within(sizes).findByText('Check the highlighted measurements. Enter centimetres above 0 and up to 300, like 96 or 96.5.')).toBeInTheDocument()
    expect(within(sizes).getByLabelText('Waist for XL, in cm')).toHaveAttribute('aria-invalid', 'true')
    expect(db.sizeCharts.dresses!.measurements.XL).toBeUndefined()

    await user.clear(within(sizes).getByLabelText('Waist for XL, in cm'))
    await user.type(within(sizes).getByLabelText('Waist for XL, in cm'), '87.5')
    await user.click(button('Save size chart', sizes))
    expect(await within(sizes).findByText('Size chart saved.')).toBeInTheDocument()
    expect(db.sizeCharts.dresses!.measurements.XL).toEqual({ bust: 101, waist: 87.5, hip: null, length: null })
    expect(db.sizeCharts.dresses!.measurements.S).toEqual({ bust: 86, waist: 72, hip: 94, length: 112 })
  })

  it('has no size chart for product types without one', { timeout: LONG }, async () => {
    await renderApp({ route: '/products/p_014' })
    const sizes = await findPart('Sizes and stock')
    expect(within(fieldset('Product type')).getByLabelText('Sarees')).toBeChecked()
    expect(queryButton('Size chart (optional)', sizes)).toBeNull()
  })

  it('lists every problem when a draft is sent too early, each linking to its field, and drops each once fixed', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: '/products/p_008' })
    await findH1('Kala Cotton Overshirt')
    expect(statusText()).toHaveTextContent('Draft')
    // Nothing is flagged before the seller tries to send it.
    expect(within(list('Product photos')).getByLabelText('Add front photo')).not.toHaveAccessibleDescription()
    await user.click(button('Send for review'))

    await screen.findByText('Fix these before sending for review.')
    const problems = bannerWith('Fix these before sending for review.')
    expect(problems).toHaveAttribute('role', 'alert')
    await waitFor(() => expect(problems.parentElement).toHaveFocus())
    expect(within(problems).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Gender: Choose who it is for: women, men or unisex.',
      'Main colour: Choose the main colour.',
      'Material: Add the material, like 100% linen.',
      'Description: Add a description.',
      '4 product photos: Add the front, back, detail and worn photos.',
      '5 try-on photos: Add 5 more try-on photos. We need 5 photos of real people wearing it.',
      'At least one size: Add at least one size.',
      'Selling price: Add a selling price.',
      'Store details: Finish your store details first.',
    ])
    expect(within(problems).getByText('Store details: Finish your store details first.')).toHaveAttribute('href', '/store/details')
    expect(product(db, 'p_008').status).toBe('draft')

    // Each problem also shows where it is fixed.
    expect(within(list('Product photos')).getByLabelText('Add front photo')).toHaveAccessibleDescription('Front photo is missing.')
    expect(screen.getByLabelText('Material')).toHaveAccessibleDescription('Add the material, like 100% linen.')
    expect(screen.getByLabelText('Selling price')).toHaveAccessibleDescription('Add a selling price.')
    expect(within(part('Sizes and stock')).getByText('Add at least one size.')).toBeInTheDocument()
    expect(within(fieldset('Gender')).getByText('Choose who it is for: women, men or unisex.')).toBeInTheDocument()

    await user.click(within(problems).getByText('4 product photos: Add the front, back, detail and worn photos.'))
    expect(within(list('Product photos')).getByLabelText('Add front photo')).toHaveFocus()
    await user.click(within(problems).getByText('Gender: Choose who it is for: women, men or unisex.'))
    expect(within(fieldset('Gender')).getByLabelText('Women')).toHaveFocus()
    await user.click(within(problems).getByText('Material: Add the material, like 100% linen.'))
    const material = screen.getByLabelText('Material')
    expect(material).toHaveFocus()

    await user.type(material, 'Kala cotton')
    expect(within(problems).queryByText(/^Material:/)).toBeNull()
    expect(material).toHaveAccessibleDescription('For example: 100% linen')
    await user.click(within(fieldset('Gender')).getByLabelText('Men'))
    expect(within(problems).queryByText(/^Gender:/)).toBeNull()
    expect(within(problems).getAllByRole('listitem')).toHaveLength(7)
  })

  it('creates a new product once the seller types a name and keeps editing it in place', { timeout: LONG }, async () => {
    const { user, router, db } = await renderApp({ route: '/products/new' })
    await findH1('New product')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Products›New product')
    const photos = part('Photos')
    expect(within(photos).getByText('Add a name first, then add photos.')).toBeInTheDocument()
    expect(within(list('Product photos')).getByLabelText('Add front photo')).toBeDisabled()
    expect(queryButton('Send for review')).toBeNull()
    expect(screen.queryByText('Review history')).toBeNull()

    // "Add a name" moves to the Name field.
    await user.click(button('Add a name', photos))
    const name = screen.getByLabelText('Name')
    expect(name).toHaveFocus()

    const before = db.products.length
    await user.type(name, 'Indigo Mul Kurta')
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/products\/p_\d+$/), SAVED)
    expect(router.state.historyAction).toBe('REPLACE')
    expect(db.products).toHaveLength(before + 1)
    const created = db.products[0]!
    expect(created.title).toBe('Indigo Mul Kurta')

    // Same form, same field: the seller keeps typing without losing focus.
    expect(name).toBeInTheDocument()
    expect(name).toHaveFocus()
    await findH1('Indigo Mul Kurta')
    expect(within(list('Product photos')).getByLabelText('Add front photo')).toBeEnabled()
    expect(button('Send for review')).toBeInTheDocument()
    expect(screen.getByText(`Code ${created.sku}`, { exact: false })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Description'), 'Hand block-printed mul.')
    await waitFor(() => expect(product(db, created.id).description).toBe('Hand block-printed mul.'), SAVED)
    expect(db.products).toHaveLength(before + 1)
  })

  it('keeps a product in review read-only with no main action', { timeout: LONG }, async () => {
    await renderApp({ route: '/products/p_007' })
    expect(await screen.findByText('This product is in review. You can edit it again once our team has decided.')).toBeInTheDocument()
    expect(statusText()).toHaveTextContent('In review')
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Selling price')).toHaveAttribute('readonly')
    expect(within(fieldset('Gender')).getByLabelText('Women')).toBeDisabled()
    expect(queryButton(/for review/)).toBeNull()
    expect(screen.getByLabelText('More actions')).toBeInTheDocument()
    expect(button('M', part('Sizes and stock'))).toBeDisabled()
    expect(within(part('Photos')).queryByLabelText(/^Options for/)).toBeNull()
    expect(queryButton('Choose photos', part('Photos'))).toBeNull()
  })

  it('tells a live product what goes back to review and sends the changes', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: '/products/p_003' })
    const note = await findPart('What needs review again')
    expect(within(note).getByText('Price and stock: live immediately')).toBeInTheDocument()
    expect(statusText()).toHaveTextContent('Live')
    expect(within(part('Sizes and stock')).getByText('Code KS-BDN-022-OS')).toBeInTheDocument()

    db.store.payout = { method: 'upi', upi_id: 'kalki@okhdfcbank' }
    await user.click(button('Send changes for review'))
    expect(await screen.findByText('Changes sent for review. The live version stays in the app until we approve them.')).toBeInTheDocument()
    expect(product(db, 'p_003').edit_in_review).toBe(true)
    expect(product(db, 'p_003').status).toBe('approved')
    expect(statusText()).toHaveTextContent('Live · Changes in review')
    expect(queryButton('Send changes for review')).toBeNull()
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly')
  })

  it('archives after a confirmation and says so on Products', { timeout: LONG }, async () => {
    const { user, db, router } = await renderApp({ route: '/products/p_001' })
    await user.click(await screen.findByLabelText('More actions'))
    await findMenu()
    await user.click(menuItem('Archive product'))
    let dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Archive this product?')
    expect(dialog).toHaveAccessibleDescription('It leaves the app and moves to Archived.')
    await user.click(button('Cancel', dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(product(db, 'p_001').status).toBe('rejected')

    await user.click(screen.getByLabelText('More actions'))
    await findMenu()
    await user.click(menuItem('Archive product'))
    dialog = await screen.findByRole('dialog')
    await user.click(button('Archive product', dialog))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    expect(product(db, 'p_001').status).toBe('archived')
    // The result shows on Products, in the page (no toast).
    expect(router.state.location.state).toEqual({ notice: 'Product archived. Find it under Archived.' })
    expect(await screen.findByText('Product archived. Find it under Archived.', {}, { timeout: 20_000 })).toBeInTheDocument()
  })

  it('says so when the product does not exist', { timeout: LONG }, async () => {
    await renderApp({ route: '/products/p_999' })
    expect(await screen.findByText('We could not find that product')).toBeInTheDocument()
    expect(screen.getByText('Back to products')).toHaveAttribute('href', '/products')
  })

  it('goes read-only when the product went into review elsewhere', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const name = await screen.findByLabelText('Name')
    db.failNext = { path: '/products/p_001', status: 409, code: 'product_not_editable', message: 'This product is in review. You can edit it again once we have decided.' }
    await user.type(name, ' — Indigo')
    expect(await screen.findByText('This product is in review, so your last change was not saved. You can edit it again once our team has decided.', {}, SAVED)).toBeInTheDocument()
    expect(name).toHaveAttribute('readonly')
    expect(queryButton('Send for review again')).toBeNull()
  })

  it('keeps the single-page editor in one column on tablets, with a camera button', { timeout: LONG }, async () => {
    await renderApp({ route: '/products/p_001', viewport: 'tablet' })
    await findH1('Ajrakh Block-Print Kurta')
    expect(screen.getByTestId('editor-columns')).toHaveAttribute('data-layout', 'single')
    expect(screen.queryByText(/^Step 1 of 4/)).toBeNull()
    const order = ['Photos', 'About the product', 'Sizes and stock', 'Price', 'Review history', 'Returns and delivery'].map(part)
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(within(part('Photos')).getByLabelText('Take photo of the product')).toBeInTheDocument()
    expect(within(part('Photos')).getByLabelText('Camera for product photos')).toHaveAttribute('capture', 'environment')
  })
})

describe('V-07 Product editor on phones', () => {
  const footer = () => document.querySelector<HTMLElement>('[data-sticky-footer]')!
  const footerButtons = () => within(footer()).getAllByRole('button').map((b) => b.textContent)

  it('walks through the four parts one per screen, then a check page that lists what is missing', { timeout: 90_000 }, async () => {
    const { user, db } = await renderApp({ route: '/products/p_008', viewport: 'mobile' })
    await findH1('Photos')
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    expect(screen.getByText(/^Kala Cotton Overshirt · Draft/)).toBeInTheDocument()
    // A full-screen task: no tab bar, and Back goes to Products.
    expect(document.querySelector('nav[aria-label="Main"]')).toBeNull()
    expect(screen.getByText('to Products').closest('a')).toHaveAttribute('href', '/products')
    expect(part('Photos')).toBeInTheDocument()
    expect(document.querySelector('section[aria-label="About the product"]')).toBeNull()
    expect(footerButtons()).toEqual(['Next'])
    expect(button('Next', footer())).toHaveClass('MuiButton-contained')

    await user.click(button('Next', footer()))
    await findH1('About the product')
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
    expect(footerButtons()).toEqual(['Back', 'Next'])
    // The top bar's Back now goes one step back.
    expect(screen.getByText('to Photos').closest('button')).toBeInTheDocument()

    // Autosave still works per field.
    await user.click(within(fieldset('Gender')).getByLabelText('Men'))
    await waitFor(() => expect(product(db, 'p_008').gender).toBe('Men'), SAVED)

    await user.click(button('Next', footer()))
    await findH1('Sizes and stock')
    await user.click(button('Next', footer()))
    await findH1('Price')
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument()
    expect(screen.getByText(/^Returns and delivery come from your store details\./)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Selling price'), '1499')
    await user.click(button('Check and send', footer()))

    await findH1('Check and send')
    const missing = document.querySelector<HTMLElement>('section[aria-label="Still to do"]')!
    expect(within(missing).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Main colour: Choose the main colour.',
      'Material: Add the material, like 100% linen.',
      'Description: Add a description.',
      '4 product photos: Add the front, back, detail and worn photos.',
      '5 try-on photos: Add 5 more try-on photos. We need 5 photos of real people wearing it.',
      'At least one size: Add at least one size.',
      'Store details: Finish your store details first.',
    ])
    expect(within(missing).getByText('Store details: Finish your store details first.')).toHaveAttribute('href', '/store/details')
    const summary = list('Your product')
    expect(within(summary).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Photos0 of 9 photos addedChange',
      'About the productKala Cotton Overshirt · Men · ShirtsChange',
      'Sizes and stockNot added yetChange',
      'Price₹1,499Change',
    ])
    expect(footerButtons()).toEqual(['Back', 'Send for review'])

    // A link goes to the step and the field.
    await user.click(within(missing).getByText('Material: Add the material, like 100% linen.'))
    await findH1('About the product')
    await waitFor(() => expect(screen.getByLabelText('Material')).toHaveFocus())

    // Sending still lists what is missing; Change goes back to that step.
    await user.click(button('Next', footer()))
    await user.click(button('Next', footer()))
    await user.click(button('Check and send', footer()))
    await findH1('Check and send')
    const send = button('Send for review', footer())
    await user.click(send)
    await waitFor(() => expect(send).toBeEnabled())
    expect(h1()).toHaveTextContent('Check and send')
    expect(document.querySelector('section[aria-label="Still to do"]')).not.toBeNull()
    expect(product(db, 'p_008').status).toBe('draft')
    await user.click(within(list('Your product')).getByLabelText('Change photos'))
    await findH1('Photos')
  })

  it('shows the reason a product was sent back on the first step, and checks the price on Next', { timeout: 60_000 }, async () => {
    const { user } = await renderApp({ route: '/products/p_001', viewport: 'mobile' })
    await findH1('Photos')
    expect(screen.getByText(/^“Back photo is missing/)).toBeInTheDocument()
    expect(screen.getByLabelText('Take photo of the product')).toBeInTheDocument()
    for (const next of ['About the product', 'Sizes and stock', 'Price']) {
      await user.click(button('Next', footer()))
      await findH1(next)
    }
    expect(screen.queryByText(/^“Back photo is missing/)).toBeNull()
    const selling = screen.getByLabelText('Selling price')
    await user.clear(selling)
    await user.type(selling, '5,000')
    await user.click(button('Check and send', footer()))
    await waitFor(() => expect(selling).toHaveAccessibleDescription('Selling price cannot be above the MRP.'))
    expect(selling).toHaveFocus()
    expect(h1()).toHaveTextContent('Price')
  })

  it('asks a new product for its name on the Photos step', { timeout: LONG }, async () => {
    await renderApp({ route: '/products/new', viewport: 'mobile' })
    await findH1('Photos')
    expect(within(part('Photos')).getByLabelText('Name')).toBeInTheDocument()
    expect(within(part('Photos')).getByText('Add a name first, then add photos.')).toBeInTheDocument()
  })
})
