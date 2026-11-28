import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import { addAsset, DEMO_STAFF, NOT_SET, type MockDb } from '../../mocks/db'
import { decide } from '../../mocks/handlers'
import { renderApp } from '../../test/render'
import { setupMockApi } from '../../test/server'

// V-07 Product editor against the mock vendor-api: main's client and session, the real routes, the
// sign → Cloudinary → register upload pipeline, autosave with the product's version, and submit's
// 422 with every missing requirement.

// The editor renders a large MUI tree, and on slow machines working out every element's
// accessible name (ByRole with a name) takes seconds. These tests find controls by their label or
// text inside a small part of the page, and keep ByRole for the semantics worth checking.
configure({ asyncUtilTimeout: 8000, defaultHidden: true })
const SAVED = { timeout: 8000 }
const LONG = 45_000

// jsdom's object URLs (src/test/setup.ts) have no origin, so SafeImage refuses them; a browser's
// look like blob:http://localhost/…. Set before the mock database makes its demo photos.
vi.hoisted(() => {
  let n = 0
  URL.createObjectURL = () => `blob:http://localhost/${(n += 1)}`
})

const { server, db: mockDb } = setupMockApi()

// ---- the mock database ------------------------------------------------------------------------
const record = (db: MockDb, sku: string) => db.products.find((p) => p.sku === sku)!
/** What the editor edits: the version being changed, else the live one. */
const content = (db: MockDb, sku: string) => {
  const p = record(db, sku)
  return (p.working ?? p.live)!.content
}
const angles = (db: MockDb, sku: string) => content(db, sku).images.map((i) => i.angle)
const count = (db: MockDb, sku: string, angle: string) => angles(db, sku).filter((a) => a === angle).length
const route = (sku: string) => `/products/${record(mockDb(), sku).id}`
const kalki = (db: MockDb) => db.vendors.find((v) => v.name === 'Kalki Studio')!.id
function completeStore(db: MockDb) {
  db.stores.get(kalki(db))!.payout = { method: 'upi', upi_id: 'kalki@okhdfcbank' }
}
/** The sent-back jacket, edited since: a complete draft (only the store details hold it back). */
function reworkJacket(db: MockDb) {
  const jacket = record(db, 'KS-KMJ-007')
  jacket.working!.state = 'editing'
  jacket.working!.version = 2
  jacket.status = 'draft'
}

// ---- the page ----------------------------------------------------------------------------------
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
// The swatch drawn inside a colour field, beside what is typed.
const swatchBeside = (input: HTMLElement) => input.closest('.MuiInputBase-root')!.querySelector('[data-swatch]')
const fieldset = (legend: string, root: HTMLElement = document.body) => within(root).getByText(legend, { selector: 'legend' }).closest('fieldset')!
const button = (name: string | RegExp, root: HTMLElement = document.body) => within(root).getByText(name, { selector: 'button' })
const queryButton = (name: string | RegExp, root: HTMLElement = document.body) => within(root).queryByText(name, { selector: 'button' })
const bannerWith = (text: string | RegExp) => screen.getByText(text).closest<HTMLElement>('[role="alert"], [role="status"]')!
const h1 = () => document.querySelector('h1')
const findH1 = (text: string) => waitFor(() => expect(h1()?.textContent).toBe(text))
// jsdom's File: the upload's FormData (XMLHttpRequest) takes only its own.
const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' })
const pngs = (...names: string[]) => names.map(png)
// The status word next to the page title.
const statusText = () => h1()!.parentElement!.querySelector('[data-status]')
const openMenu = () => document.querySelector<HTMLElement>('[role="menu"]')
const findMenu = () => waitFor(() => expect(openMenu()).not.toBeNull())
const menuClosed = () => waitFor(() => expect(openMenu()).toBeNull())
const menuItems = () => within(openMenu()!).getAllByRole('menuitem').map((m) => m.textContent)
const menuItem = (name: string) => within(openMenu()!).getByText(name)

/** Holds every request to `path` until released, then lets the mock API answer it. */
function hold(method: 'get' | 'post' | 'put', path: string) {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  server.use(http[method](path, async () => {
    await gate
  }))
  onTestFinished(() => release())
  return () => release()
}

/** Counts the requests that match, by method and the end of the path. */
function countRequests(method: string, pathEnd: RegExp) {
  let n = 0
  const listener = ({ request }: { request: Request }) => {
    if (request.method === method && pathEnd.test(new URL(request.url).pathname)) n += 1
  }
  server.events.on('request:start', listener)
  onTestFinished(() => {
    server.events.removeListener('request:start', listener)
  })
  return () => n
}

describe('V-07 Product editor', () => {
  // The route lazy-loads the screen; load it once up front so the first test is not timing a cold import.
  beforeAll(async () => {
    await import('./ProductEditor')
    await import('./ProductList')
  }, 120_000)

  it('shows a sent-back product: reason, photo groups, details, sizes, price and what the seller receives', { timeout: LONG }, async () => {
    await renderApp({ route: route('KS-AJR-014') })
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
    // The seller's photos go through SafeImage: no referrer.
    expect(within(productPhotos).getByAltText('Front photo')).toHaveAttribute('referrerpolicy', 'no-referrer')
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
    // Colours: any name or hex code, typed or picked, each shown with its swatch.
    const main = within(about).getByLabelText('Main colour')
    expect(main).toHaveValue('Indigo')
    expect(main).toHaveAccessibleDescription('Type a colour name or a hex code, choose one from the list, or pick a shade.')
    expect(swatchBeside(main)).toHaveAttribute('data-swatch', 'named')
    expect(within(about).getByLabelText('Pick a shade for main colour')).toHaveAttribute('type', 'color')
    const others = fieldset('Other colours (optional)', about)
    expect(within(others).getByLabelText('Other colour 1')).toHaveValue('Red')
    expect(within(others).getByLabelText('Other colour 2')).toHaveValue('Black')
    // Two other colours is the most: no room for another.
    expect(queryButton('Add another colour (up to 2)', about)).toBeNull()
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
    // Nothing is live yet, so there is no live version to compare with.
    expect(screen.queryByText('Live in the app')).toBeNull()
    expect(screen.getByTestId('editor-columns')).toHaveAttribute('data-layout', 'two-column')
  })

  it('shows the shape of the editor while the product loads', { timeout: LONG }, async () => {
    hold('get', '*/v1/vendor/products/:id')
    await renderApp({ route: route('KS-AJR-014') })
    expect(await screen.findByRole('status', { name: 'Loading product' })).toBeInTheDocument()
  })

  it('keeps the reason a product was sent back while it is fixed, and when it is opened again', { timeout: LONG }, async () => {
    const { user, db, router } = await renderApp({ route: route('KS-AJR-014') })
    const reason = /^“Back photo is missing, and there are only 2 try-on photos/
    await screen.findByText(reason)
    await user.type(screen.getByLabelText('Material'), ' — hand block-printed')
    // vendor-api makes a new version of a sent-back product on its first save: it is a draft again.
    await waitFor(() => expect(record(db, 'KS-AJR-014').status).toBe('draft'), SAVED)
    expect(screen.getByText(reason)).toBeInTheDocument()
    expect(button('Send for review again')).toBeInTheDocument()

    await router.navigate('/products')
    await router.navigate(route('KS-AJR-014'))
    expect(await screen.findByText(reason)).toBeInTheDocument()
    expect(button('Send for review again')).toBeInTheDocument()
  })

  it('autosaves a second after typing stops', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-AJR-014') })
    const name = await screen.findByLabelText('Name')
    // Two hours ago reads "Yesterday" just after midnight.
    expect(screen.getByText(/^Saved · (2 h ago|Yesterday)$/)).toBeInTheDocument()
    await user.clear(name)
    await user.type(name, 'Ajrakh Kurta — Indigo')
    await waitFor(() => expect(content(db, 'KS-AJR-014').title).toBe('Ajrakh Kurta — Indigo'), SAVED)
    expect(await screen.findByText('Saved · just now')).toBeInTheDocument()
    expect(h1()).toHaveTextContent('Ajrakh Kurta — Indigo')
  })

  it('saves gender, material and any colour: a name, a hex code or a picked shade', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-KAL-011') })
    const about = await findPart('About the product')
    expect(within(fieldset('Product type', about)).getByLabelText('Shirts')).toBeChecked()
    expect(within(about).queryByText('Other colours (optional)')).toBeNull()

    await user.click(within(fieldset('Gender', about)).getByLabelText('Men'))
    // The listed colours are suggestions, each with its swatch; any other name is fine too.
    const main = within(about).getByLabelText('Main colour')
    await user.type(main, 'indi')
    const suggestions = await screen.findByRole('listbox')
    expect(within(suggestions).getAllByRole('option').map((o) => o.textContent)).toEqual(['Indigo'])
    expect(within(suggestions).getByRole('option').querySelector('[data-swatch="named"]')).not.toBeNull()
    await user.clear(main)
    await user.type(main, '  Kalamkari   indigo ')
    await user.tab()
    expect(main).toHaveValue('Kalamkari indigo')
    expect(swatchBeside(main)).toHaveAttribute('data-swatch', 'unknown')

    // A hex code, tidied when the seller leaves the field.
    await user.click(button('Add another colour (up to 2)', about))
    const first = within(about).getByLabelText('Other colour 1')
    expect(first).toHaveFocus()
    await user.type(first, '#b7410e')
    await user.tab()
    expect(first).toHaveValue('#B7410E')
    expect(swatchBeside(first)).toHaveStyle({ background: 'rgb(183, 65, 14)' })

    // A shade from the colour picker fills in its hex code.
    await user.click(button('Add another colour (up to 2)', about))
    fireEvent.change(within(about).getByLabelText('Pick a shade for other colour 2'), { target: { value: '#2e3f6e' } })
    expect(within(about).getByLabelText('Other colour 2')).toHaveValue('#2E3F6E')
    expect(queryButton('Add another colour (up to 2)', about)).toBeNull()

    await user.type(within(about).getByLabelText('Material'), '100% kala cotton')
    await waitFor(() => expect(content(db, 'KS-KAL-011')).toMatchObject({ gender: 'men', main_colour: 'Kalamkari indigo', other_colours: ['#B7410E', '#2E3F6E'], fabric: '100% kala cotton' }), SAVED)

    await user.click(within(about).getByLabelText('Remove other colour 1'))
    expect(within(about).getByLabelText('Other colour 1')).toHaveValue('#2E3F6E')
    await waitFor(() => expect(content(db, 'KS-KAL-011')).toMatchObject({ other_colours: ['#2E3F6E'] }), SAVED)
  })

  it('refuses a hex code that is not one, and a colour given twice, with a clear message', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-AJR-014') })
    const about = await findPart('About the product')
    const main = within(about).getByLabelText('Main colour')
    await user.clear(main)
    await user.type(main, '#12')
    // Not while typing: once the seller leaves the field.
    expect(main).not.toHaveAttribute('aria-invalid', 'true')
    await user.tab()
    expect(main).toHaveAttribute('aria-invalid', 'true')
    expect(main).toHaveAccessibleDescription(/^Enter a hex code as # and 6 digits or letters A to F, like #[0-9A-F]{6}\.$/)
    await user.clear(main)
    await user.type(main, '#GGGGGG')
    await user.tab()
    expect(main).toHaveAccessibleDescription(/^Enter a hex code/)
    // A wrong code is never saved: the saved colour stays.
    await user.type(within(about).getByLabelText('Material'), '.')
    await waitFor(() => expect(content(db, 'KS-AJR-014').fabric).toBe('Cotton mul.'), SAVED)
    expect(content(db, 'KS-AJR-014').main_colour).toBe('Indigo')

    // Fixing it clears the message straight away.
    await user.clear(main)
    await user.type(main, 'Rust orange')
    expect(main).not.toHaveAttribute('aria-invalid', 'true')

    // The same colour twice, whatever the case.
    const first = within(about).getByLabelText('Other colour 1')
    await user.clear(first)
    await user.type(first, 'rust ORANGE')
    await user.tab()
    expect(first).toHaveAccessibleDescription('Other colours should be different from the main colour and from each other.')

    // Sending waits until the colours are right, and takes the seller to the one to fix.
    main.focus()
    await user.click(button('Send for review again'))
    await waitFor(() => expect(first).toHaveFocus())
    expect(record(db, 'KS-AJR-014').status).not.toBe('pending_review')
  })

  it('checks the price against the MRP when sending, not while typing, and only saves a valid price', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-AJR-014') })
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
    expect(record(db, 'KS-AJR-014').status).toBe('rejected')

    // The error goes as soon as the price is fixed.
    await user.clear(selling)
    await user.type(selling, '1999')
    await waitFor(() => expect(selling).toHaveAttribute('aria-invalid', 'false'))
    expect(within(part('Price')).getByText('You receive ₹1,759 after 12% commission (₹240)')).toBeInTheDocument()
    await waitFor(() => expect(content(db, 'KS-AJR-014').variants.every((v) => v.price_paise === 199900)).toBe(true), SAVED)
    expect(content(db, 'KS-AJR-014').variants[0]!.mrp_paise).toBe(299900)
  })

  it('refuses nonsense prices and huge stock without sending them', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-AJR-014') })
    const selling = await screen.findByLabelText('Selling price')
    const mrp = screen.getByLabelText('MRP (optional)')
    for (const [typed, problem] of [
      ['-5', 'Enter an amount in rupees, like 2,499.'],
      ['0', 'Enter a selling price above ₹0.'],
      ['12345678', 'Enter an amount in rupees, like 2,499.'],
      ['2.999', 'Enter an amount in rupees, like 2,499.'],
    ] as const) {
      // Typed over the whole value, so the field is never empty (an empty price is a real save).
      await user.tripleClick(selling)
      await user.keyboard(typed)
      await user.click(button('Send for review again'))
      await waitFor(() => expect(selling).toHaveAccessibleDescription(problem))
    }
    await user.tripleClick(selling)
    await user.keyboard('2,000')
    await user.tripleClick(mrp)
    await user.keyboard('0')
    await user.click(button('Send for review again'))
    await waitFor(() => expect(mrp).toHaveAccessibleDescription('Enter an MRP above ₹0.'))
    // None of it reached the server: the saved price is still the last good one.
    expect(content(db, 'KS-AJR-014').variants[0]!.price_paise).toBe(249900)

    // Stock is whole numbers up to 99,999; letters and a sixth digit do not go in.
    const m = within(part('Sizes and stock')).getByLabelText('Stock for M')
    await user.clear(m)
    await user.type(m, '-12a3456')
    expect(m).toHaveValue('12345')
    expect(within(part('Sizes and stock')).getByLabelText('One more in stock for M')).toBeEnabled()
    await user.clear(m)
    await user.type(m, '99999')
    expect(within(part('Sizes and stock')).getByLabelText('One more in stock for M')).toBeDisabled()
  })

  it('says where to agree a commission while none is agreed', { timeout: LONG }, async () => {
    const { db, queryClient } = await renderApp({ route: route('KS-AJR-014') })
    const price = await findPart('Price')
    expect(await within(price).findByText(/^You receive ₹2,199/)).toBeInTheDocument()
    db.commissions.set(kalki(db), NOT_SET)
    await queryClient.invalidateQueries({ queryKey: ['me'] })
    expect(await within(price).findByText(/^You will see what you receive once your commission is agreed\./)).toBeInTheDocument()
    expect(within(price).getByText('Store details › Commission')).toHaveAttribute('href', '/store/details#commission')
    expect(price).not.toHaveTextContent(/You receive ₹|15%/)
  })

  it('adds sizes with chips and sets stock with typing and the − / + buttons', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-AJR-014') })
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
        expect(content(db, 'KS-AJR-014').variants.map((v) => ({ size: v.size, sku: v.sku, stock: v.stock }))).toEqual([
          { size: 'S', sku: 'KS-AJR-014-S', stock: 8 },
          { size: 'M', sku: 'KS-AJR-014-M', stock: 15 },
          { size: 'L', sku: 'KS-AJR-014-L', stock: 6 },
          { size: 'XL', sku: 'KS-AJR-014-XL', stock: 0 },
          { size: 'XXL', sku: 'KS-AJR-014-XXL', stock: 2 },
        ]),
      SAVED,
    )
    // Every size has the one price.
    expect(content(db, 'KS-AJR-014').variants.every((v) => v.price_paise === 249900)).toBe(true)

    // Jeans and trousers offer waist sizes 26–40.
    await user.click(within(fieldset('Product type')).getByLabelText('Jeans'))
    expect(within(sizes).getByText('Waist sizes', { selector: 'p' })).toBeInTheDocument()
    expect(button('26', sizes)).toBeInTheDocument()
    expect(button('40', sizes)).toBeInTheDocument()
  })

  it('keeps a price typed before any size, says so, and saves it with the first size', { timeout: LONG }, async () => {
    const { user, db, router } = await renderApp({ route: route('KS-KAL-011') })
    const selling = await screen.findByLabelText('Selling price')
    await user.type(selling, '1,499')
    const price = part('Price')
    expect(await within(price).findByText('Add a size to save this price. It stays here until then.')).toBeInTheDocument()

    // Leaving now would lose it: the editor asks first.
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Products'))
    const ask = await screen.findByRole('dialog', { name: 'Leave this product?' })
    expect(ask).toHaveTextContent('The price is not saved yet: add a size first.')
    await user.click(within(ask).getByRole('button', { name: 'Stay' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(router.state.location.pathname).toBe(route('KS-KAL-011'))

    await user.click(button('M', part('Sizes and stock')))
    await waitFor(() => expect(content(db, 'KS-KAL-011').variants).toMatchObject([{ size: 'M', price_paise: 149900 }]), SAVED)
    expect(within(price).queryByText(/Add a size to save this price/)).toBeNull()
    expect(selling).toHaveValue('1,499')

    // Nothing is left unsaved, so leaving is quiet.
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Products'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
  })

  it('fills empty slots in order when several photos are picked at once', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-AJR-014') })
    const photos = await findPart('Photos')
    const productInput = within(photos).getByLabelText('Product photo files')
    expect(productInput).toHaveAttribute('accept', 'image/*')
    expect(productInput).toHaveAttribute('multiple')
    expect(productInput).not.toHaveAttribute('capture')

    // The empty Back slot first, then the next extra slot.
    await user.upload(productInput, pngs('a.png', 'b.png'))
    await waitFor(() => expect(count(db, 'KS-AJR-014', 'extra')).toBe(2), SAVED)
    expect(count(db, 'KS-AJR-014', 'back')).toBe(1)
    expect(await within(list('Product photos')).findByAltText('Back photo')).toBeInTheDocument()
    expect(within(list('Product photos')).getByAltText('Extra photo 2')).toBeInTheDocument()
    expect(within(photos).getByText('4 of 4 added')).toBeInTheDocument()

    // Five try-on slots: two taken, so one of four new photos does not fit.
    await user.upload(within(photos).getByLabelText('Try-on photo files'), pngs('t1.png', 't2.png', 't3.png', 't4.png'))
    expect(await within(photos).findByText('1 photo was not added. You can add up to 5 try-on photos.')).toBeInTheDocument()
    await waitFor(() => expect(count(db, 'KS-AJR-014', 'tryon')).toBe(5), SAVED)
    await waitFor(() => expect(within(list('Try-on photos')).getAllByAltText(/^Try-on photo/)).toHaveLength(5))
    expect(within(photos).getByText('9 of 9 added')).toBeInTheDocument()
    expect(within(photos).queryByText(/is missing/)).toBeNull()
  })

  it('takes 13 photos and no more', { timeout: LONG }, async () => {
    const db = mockDb()
    const kurta = record(db, 'KS-AJR-014')
    const add = (angle: 'back' | 'extra' | 'tryon') =>
      kurta.working!.content.images.push({ asset_id: addAsset(db, kalki(db), 'product_image', `https://res.cloudinary.com/shazlo-demo/image/upload/${angle}.jpg`, new Date().toISOString()).id, alt_text: null, angle })
    add('back')
    for (let i = 0; i < 3; i++) add('extra')
    for (let i = 0; i < 3; i++) add('tryon')
    expect(kurta.working!.content.images).toHaveLength(13)

    const { user } = await renderApp({ route: route('KS-AJR-014') })
    const photos = await findPart('Photos')
    expect(within(photos).getByText('9 of 9 added')).toBeInTheDocument()
    expect(within(list('Product photos')).queryByLabelText('Add extra photos')).toBeNull()
    await user.upload(within(photos).getByLabelText('Product photo files'), png('fourteenth.png'))
    expect(await within(photos).findByText('1 photo was not added. You can add up to 4 extra photos.')).toBeInTheDocument()
    expect(kurta.working!.content.images).toHaveLength(13)
  })

  it('shows each photo\'s progress, and a cancelled upload leaves nothing behind', { timeout: LONG }, async () => {
    const release = hold('post', '*/v1/vendor/assets/sign')
    const { user, db } = await renderApp({ route: route('KS-AJR-014') })
    const photos = await findPart('Photos')
    await user.upload(within(photos).getByLabelText('Try-on photo files'), png('tryon.png'))
    const tryons = list('Try-on photos')
    expect(await within(tryons).findByText('Uploading…')).toBeInTheDocument()
    expect(within(tryons).getByRole('progressbar', { name: 'Uploading try-on photo 3' })).toBeInTheDocument()
    await user.click(within(tryons).getByLabelText('Cancel try-on photo 3'))
    await waitFor(() => expect(within(tryons).queryByText('Uploading…')).toBeNull())
    expect(within(tryons).getByLabelText('Add try-on photo 3')).toBeInTheDocument()
    release()
    // The cancelled photo never reaches the product.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(count(db, 'KS-AJR-014', 'tryon')).toBe(2)
  })

  it('keeps a failed photo with its preview and the reason, and tries again', { timeout: LONG }, async () => {
    mockDb().faults.push({ path: '/v1/vendor/assets/sign', method: 'POST', network: true })
    const { user, db } = await renderApp({ route: route('KS-AJR-014') })
    const photos = await findPart('Photos')
    await user.upload(within(photos).getByLabelText('Try-on photo files'), png('tryon.png'))

    const tryons = list('Try-on photos')
    const alert = await within(tryons).findByText('Not added. Could not reach the server. Check your connection and try again.')
    expect(alert.closest('[role="alert"]')).not.toBeNull()
    // The preview stays in the slot.
    expect(alert.closest('li')!.querySelector('img')).toHaveAttribute('src')
    expect(count(db, 'KS-AJR-014', 'tryon')).toBe(2)

    await user.click(within(tryons).getByLabelText('Try again: try-on photo 3'))
    expect(await within(tryons).findByAltText('Try-on photo 3')).toBeInTheDocument()
    expect(within(tryons).queryByText(/^Not added/)).toBeNull()
    expect(count(db, 'KS-AJR-014', 'tryon')).toBe(3)
  })

  it('does not offer to try again a file that can never upload', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-AJR-014') })
    const photos = await findPart('Photos')
    const gif = new File([new Uint8Array([71, 73, 70, 56, 57, 97])], 'spin.gif', { type: 'image/gif' })
    await user.upload(within(photos).getByLabelText('Try-on photo files'), gif)
    const tryons = list('Try-on photos')
    expect(await within(tryons).findByText(/^Not added\. That file type is not accepted\. Use a JPG, PNG or WebP under 10 MB\./)).toBeInTheDocument()
    expect(within(tryons).queryByLabelText('Try again: try-on photo 3')).toBeNull()
    await user.click(within(tryons).getByLabelText('Cancel try-on photo 3'))
    await waitFor(() => expect(within(tryons).queryByText(/^Not added/)).toBeNull())
    expect(count(db, 'KS-AJR-014', 'tryon')).toBe(2)
  })

  it('makes another photo the main one, moves and removes photos without dragging', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-AJR-014') })
    await findPart('Photos')
    const idOf = (angle: string) => content(db, 'KS-AJR-014').images.find((i) => i.angle === angle)!.asset_id
    const front = idOf('front')
    const worn = idOf('worn')
    const angleOf = (id: string) => content(db, 'KS-AJR-014').images.find((i) => i.asset_id === id)!.angle

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

    const extra = idOf('extra')
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
    await waitFor(() => expect(count(db, 'KS-AJR-014', 'tryon')).toBe(1))
    expect(await screen.findByText('Try-on photo 1 removed.')).toBeInTheDocument()
  })

  it('saves the size chart for the product type group, keeping sizes other products use', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-AJR-014') })
    const chart = () => db.sizeCharts.get(kalki(db))!.dresses!
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
    expect(chart().measurements.XL).toBeUndefined()

    await user.clear(within(sizes).getByLabelText('Waist for XL, in cm'))
    await user.type(within(sizes).getByLabelText('Waist for XL, in cm'), '87.5')
    await user.click(button('Save size chart', sizes))
    expect(await within(sizes).findByText('Size chart saved.')).toBeInTheDocument()
    expect(chart().measurements.XL).toEqual({ bust: 101, waist: 87.5, hip: null, length: null })
    expect(chart().measurements.S).toEqual({ bust: 86, waist: 72, hip: 94, length: 112 })
  })

  it('has no size chart for product types without one', { timeout: LONG }, async () => {
    await renderApp({ route: route('KS-KLM-002') })
    const sizes = await findPart('Sizes and stock')
    expect(within(fieldset('Product type')).getByLabelText('Sarees')).toBeChecked()
    expect(queryButton('Size chart (optional)', sizes)).toBeNull()
  })

  it('lists every problem when a draft is sent too early, each linking to its field, and drops each once fixed', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-KAL-011') })
    await findH1('Kala Cotton Overshirt')
    expect(statusText()).toHaveTextContent('Draft')
    // Nothing is flagged before the seller tries to send it.
    expect(within(list('Product photos')).getByLabelText('Add front photo')).not.toHaveAccessibleDescription()
    await user.click(button('Send for review'))

    await screen.findByText('Fix these before sending for review')
    const problems = bannerWith('Fix these before sending for review')
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
    expect(record(db, 'KS-KAL-011').status).toBe('draft')

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

  it('sends a finished product once, however fast the button is pressed', { timeout: LONG }, async () => {
    completeStore(mockDb())
    reworkJacket(mockDb())
    const submits = countRequests('POST', /\/submit$/)
    const { user, db } = await renderApp({ route: route('KS-KMJ-007') })
    await findH1('Kutch Mirror-Work Jacket')
    // Reworked after being sent back: the reason stays, and so does the wording.
    expect(await screen.findByText(/^“Price ₹3,999 does not match the MRP on the tag/)).toBeInTheDocument()
    await user.dblClick(button('Send for review again'))
    expect(await screen.findByText('Sent for review. We usually decide within 24 hours.')).toBeInTheDocument()
    expect(submits()).toBe(1)
    expect(record(db, 'KS-KMJ-007').status).toBe('pending_review')
    expect(statusText()).toHaveTextContent('In review')
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly')
  })

  it('says plainly why a sent-back product cannot go again unchanged', { timeout: LONG }, async () => {
    completeStore(mockDb())
    const { user } = await renderApp({ route: route('KS-KMJ-007') })
    await findH1('Kutch Mirror-Work Jacket')
    await user.click(button('Send for review again'))
    expect(await screen.findByText('Nothing has changed since it was sent back. Change what our team asked for, then send it again.')).toBeInTheDocument()
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
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/products\/[0-9a-f-]{36}$/), SAVED)
    expect(router.state.historyAction).toBe('REPLACE')
    expect(db.products).toHaveLength(before + 1)
    const created = db.products.at(-1)!
    expect(created.working!.content.title).toBe('Indigo Mul Kurta')
    // The code is made for the seller and never called a SKU.
    expect(created.sku).toMatch(/^P-[0-9A-Z]{8}$/)

    // Same form, same field: the seller keeps typing without losing focus.
    expect(name).toBeInTheDocument()
    expect(name).toHaveFocus()
    await findH1('Indigo Mul Kurta')
    expect(within(list('Product photos')).getByLabelText('Add front photo')).toBeEnabled()
    expect(button('Send for review')).toBeInTheDocument()
    expect(screen.getByText(`Code ${created.sku}`, { exact: false })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Description'), 'Hand block-printed mul.')
    await waitFor(() => expect(content(db, created.sku).description).toBe('Hand block-printed mul.'), SAVED)
    expect(db.products).toHaveLength(before + 1)
  })

  it('keeps long and unicode text as typed', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-KAL-011') })
    const name = await screen.findByLabelText('Name')
    const hindi = 'कला कॉटन ओवरशर्ट — नील 👕'
    await user.clear(name)
    await user.paste(hindi)
    await waitFor(() => expect(content(db, 'KS-KAL-011').title).toBe(hindi), SAVED)
    await findH1(hindi)
    // vendor-api takes at most 200 characters of name, 80 of material and 4,000 of description:
    // the fields stop there, so nothing typed is refused later.
    await user.clear(name)
    await user.paste('x'.repeat(250))
    expect(name).toHaveValue('x'.repeat(200))
    const material = screen.getByLabelText('Material')
    await user.click(material)
    await user.paste('m'.repeat(120))
    expect(material).toHaveValue('m'.repeat(80))
    await waitFor(() => expect(content(db, 'KS-KAL-011')).toMatchObject({ title: 'x'.repeat(200), fabric: 'm'.repeat(80) }), SAVED)
    expect(screen.queryByText(/Not saved/)).toBeNull()

    // An emptied name is not sent (vendor-api needs one); the saved name stays until a new one is typed.
    await user.clear(name)
    await user.type(screen.getByLabelText('Description'), 'Soft.')
    await waitFor(() => expect(content(db, 'KS-KAL-011').description).toBe('Soft.'), SAVED)
    expect(content(db, 'KS-KAL-011').title).toBe('x'.repeat(200))
    expect(screen.queryByText(/Not saved/)).toBeNull()
  })

  it('keeps a product in review read-only with no main action and nothing to delete', { timeout: LONG }, async () => {
    await renderApp({ route: route('KS-DAB-040') })
    expect(await screen.findByText('This product is in review. You can edit it again once our team has decided.')).toBeInTheDocument()
    expect(statusText()).toHaveTextContent('In review')
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Selling price')).toHaveAttribute('readonly')
    expect(within(fieldset('Gender')).getByLabelText('Women')).toBeDisabled()
    expect(queryButton(/for review/)).toBeNull()
    // vendor-api refuses to archive anything in review, so it is not offered.
    expect(screen.queryByLabelText('More actions')).toBeNull()
    expect(button('M', part('Sizes and stock'))).toBeDisabled()
    expect(within(part('Photos')).queryByLabelText(/^Options for/)).toBeNull()
    expect(queryButton('Choose photos', part('Photos'))).toBeNull()
  })

  it('opens again for changes when our team sends it back while the seller looks at it', { timeout: LONG }, async () => {
    const { db, queryClient } = await renderApp({ route: route('KS-DAB-040') })
    await screen.findByText('This product is in review. You can edit it again once our team has decided.')
    decide(db, { productId: record(db, 'KS-DAB-040').id }, { approve: false, reason: 'The detail photo is blurred.' })
    await queryClient.invalidateQueries({ queryKey: ['product'] })
    expect(await screen.findByText('“The detail photo is blurred.”')).toBeInTheDocument()
    expect(statusText()).toHaveTextContent('Needs changes')
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('readonly')
    expect(button('Send for review again')).toBeInTheDocument()
  })

  it('shows what is live beside the seller\'s changes, and sends the changes', { timeout: LONG }, async () => {
    completeStore(mockDb())
    const { user, db } = await renderApp({ route: route('KS-BDN-022') })
    const card = await findPart('Live in the app')
    expect(card).toHaveTextContent('Shoppers see this version. Changes you make here are checked by our team first; this version stays in the app until then.')
    expect(statusText()).toHaveTextContent('Live')
    expect(within(part('Sizes and stock')).getByText('Code KS-BDN-022-OS')).toBeInTheDocument()
    // Nothing to send until something changes.
    expect(queryButton('Send changes for review')).toBeNull()

    const selling = screen.getByLabelText('Selling price')
    await user.clear(selling)
    await user.type(selling, '1,750')
    await waitFor(() => expect(within(card).getByText('Your changes, not sent yet')).toBeInTheDocument(), SAVED)
    const row = within(card).getByText('Selling price').closest('li')!
    expect(row).toHaveTextContent('Live₹1,850')
    expect(row).toHaveTextContent('Yours₹1,750')
    // The live version did not change.
    expect(record(db, 'KS-BDN-022').live!.content.variants[0]!.price_paise).toBe(185000)

    await user.click(button('Send changes for review'))
    expect(await screen.findByText('Changes sent for review. The live version stays in the app until we approve them.')).toBeInTheDocument()
    expect(record(db, 'KS-BDN-022').working!.state).toBe('in_review')
    expect(record(db, 'KS-BDN-022').status).toBe('approved')
    expect(statusText()).toHaveTextContent('Live · Changes in review')
    expect(within(card).getByText('Your changes, in review')).toBeInTheDocument()
    expect(queryButton('Send changes for review')).toBeNull()
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly')
  })

  it('shows a live product\'s changes in review against the live version', { timeout: LONG }, async () => {
    await renderApp({ route: route('KS-HCS-003') })
    const card = await findPart('Live in the app')
    expect(within(card).getByText('Your changes, in review')).toBeInTheDocument()
    const row = within(card).getByText('Selling price').closest('li')!
    expect(row).toHaveTextContent('Live₹1,299')
    expect(row).toHaveTextContent('Yours₹1,199')
    expect(screen.queryByLabelText('More actions')).toBeNull()
  })

  it('deletes a draft that was never sent for good, and says so on Products', { timeout: LONG }, async () => {
    const { user, db, router } = await renderApp({ route: route('KS-DAB-042') })
    await user.click(await screen.findByLabelText('More actions'))
    await findMenu()
    expect(menuItems()).toEqual(['Delete product'])
    await user.click(menuItem('Delete product'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Delete Indigo Dabu Co-ord?')
    expect(dialog).toHaveAccessibleDescription('It has never been sent for review, so it will be deleted for good. This cannot be undone.')
    await user.dblClick(button('Delete product', dialog))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    expect(db.products.some((p) => p.sku === 'KS-DAB-042')).toBe(false)
    expect(await screen.findByText('Indigo Dabu Co-ord was deleted.', {}, { timeout: 20_000 })).toBeInTheDocument()
  })

  it('archives a sent-back product after a confirmation and says so on Products', { timeout: LONG }, async () => {
    const { user, db, router } = await renderApp({ route: route('KS-AJR-014') })
    await user.click(await screen.findByLabelText('More actions'))
    await findMenu()
    await user.click(menuItem('Archive product'))
    let dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Archive Ajrakh Block-Print Kurta?')
    expect(dialog).toHaveAccessibleDescription('It has been sent for review before, so it is archived, not deleted, and moves to Archived.')
    await user.click(button('Cancel', dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(record(db, 'KS-AJR-014').status).toBe('rejected')

    await user.click(screen.getByLabelText('More actions'))
    await findMenu()
    await user.click(menuItem('Archive product'))
    dialog = await screen.findByRole('dialog')
    await user.click(button('Archive product', dialog))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    expect(record(db, 'KS-AJR-014').status).toBe('archived')
    // The result shows on Products, in the page (no toast).
    expect(await screen.findByText('Ajrakh Block-Print Kurta was archived. Find it under Archived.', {}, { timeout: 20_000 })).toBeInTheDocument()
  })

  it('says so when the product does not exist, or the link is not a product at all', { timeout: LONG }, async () => {
    await renderApp({ route: '/products/00000000-0000-4000-8000-00000000ffff' })
    expect(await screen.findByText('We could not find that product')).toBeInTheDocument()
    expect(screen.getByText('Back to products')).toHaveAttribute('href', '/products')
  })

  it('treats vendor-api\'s 422 for a malformed id as not found', { timeout: LONG }, async () => {
    mockDb().faults.push({ path: '/v1/vendor/products/not-a-product', method: 'GET', status: 422, code: 'validation_error', message: 'Input should be a valid UUID' })
    await renderApp({ route: '/products/not-a-product' })
    expect(await screen.findByText('We could not find that product')).toBeInTheDocument()
  })

  it('goes read-only when the product was sent for review in another tab', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-KAL-011') })
    const name = await screen.findByLabelText('Name')
    // Another tab sent it meanwhile.
    record(db, 'KS-KAL-011').working!.state = 'in_review'
    record(db, 'KS-KAL-011').status = 'pending_review'
    await user.type(name, ' — Indigo')
    expect(await screen.findByText('This product is in review, so your last change was not saved. You can edit it again once our team has decided.', {}, SAVED)).toBeInTheDocument()
    expect(name).toHaveAttribute('readonly')
    expect(queryButton('Send for review')).toBeNull()
    expect(content(db, 'KS-KAL-011').title).toBe('Kala Cotton Overshirt')
  })

  it('keeps another tab\'s changes: a save sends only what changed here', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-KAL-011') })
    const description = await screen.findByLabelText('Description')
    // Another tab renamed it (and so moved the version on).
    content(db, 'KS-KAL-011').title = 'Kala Cotton Overshirt — Natural'
    record(db, 'KS-KAL-011').version += 1
    await user.type(description, 'Hand-spun kala cotton.')
    await waitFor(() => expect(content(db, 'KS-KAL-011').description).toBe('Hand-spun kala cotton.'), SAVED)
    expect(content(db, 'KS-KAL-011').title).toBe('Kala Cotton Overshirt — Natural')
  })

  it('says so plainly when the product keeps changing elsewhere, and loads the latest', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-KAL-011') })
    const material = await screen.findByLabelText('Material')
    const conflict = { path: `/v1/vendor/products/${record(db, 'KS-KAL-011').id}`, method: 'PUT', status: 409, code: 'version_conflict', message: 'This product changed after you opened it.' }
    db.faults.push({ ...conflict }, { ...conflict })
    content(db, 'KS-KAL-011').title = 'Renamed elsewhere'
    await user.type(material, 'Kala cotton')
    const banner = await screen.findByText('This product was changed somewhere else (another tab or someone on your team), so your last change was not saved', {}, SAVED)
    await user.click(within(banner.closest('[role="alert"]')!).getByRole('button', { name: 'Load the latest' }))
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Renamed elsewhere'))
    expect(screen.getByLabelText('Material')).toHaveValue('')
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('readonly')
  })

  it('never shows a photo from an address that is not safe', { timeout: LONG }, async () => {
    const db = mockDb()
    const front = content(db, 'KS-AJR-014').images.find((i) => i.angle === 'front')!
    db.assets.get(front.asset_id)!.url = 'javascript:alert(1)'
    const detail = content(db, 'KS-AJR-014').images.find((i) => i.angle === 'detail')!
    db.assets.get(detail.asset_id)!.url = 'data:image/svg+xml,<svg onload=alert(1)>'
    await renderApp({ route: route('KS-AJR-014') })
    await findPart('Photos')
    const photos = list('Product photos')
    expect(within(photos).getByAltText('Worn photo')).toBeInTheDocument()
    expect(within(photos).queryByAltText('Front photo')).toBeNull()
    expect(within(photos).queryByAltText('Detail photo')).toBeNull()
    expect(document.querySelector('img[src^="javascript:"], img[src^="data:"]')).toBeNull()
  })

  it('stops saving, and says so, when the product was deleted in another tab', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-DAB-042') })
    const material = await screen.findByLabelText('Material')
    db.products = db.products.filter((p) => p.sku !== 'KS-DAB-042')
    await user.type(material, ' blend')
    expect(await screen.findByText('This product is no longer in your products (deleted somewhere else), so your last change was not saved', {}, SAVED)).toBeInTheDocument()
    expect(material).toHaveAttribute('readonly')
    expect(screen.queryByLabelText('More actions')).toBeNull()
  })

  it('says a change did not save when the connection drops, and asks before leaving', { timeout: LONG }, async () => {
    const { user, db, router } = await renderApp({ route: route('KS-KAL-011') })
    const material = await screen.findByLabelText('Material')
    db.faults.push({ path: `/v1/vendor/products/${record(db, 'KS-KAL-011').id}`, method: 'GET', network: true })
    await user.type(material, 'Kala cotton')
    expect(await screen.findByText(/^Not saved\./, {}, SAVED)).toBeInTheDocument()
    expect(content(db, 'KS-KAL-011').fabric).toBeNull()
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Products'))
    const ask = await screen.findByRole('dialog', { name: 'Leave this product?' })
    expect(ask).toHaveTextContent('Your last change did not save.')
    await user.click(within(ask).getByRole('button', { name: 'Stay' }))
    // The next edit tries again, and then leaving is quiet.
    await user.type(material, '.')
    await waitFor(() => expect(content(db, 'KS-KAL-011').fabric).toBe('Kala cotton.'), SAVED)
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Products'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
  })

  it('saves on vendor-api as it is today, without the version check', { timeout: LONG }, async () => {
    mockDb().proposals.productVersions = false
    const { user, db } = await renderApp({ route: route('KS-KAL-011') })
    const material = await screen.findByLabelText('Material')
    await user.type(material, 'Kala cotton')
    await waitFor(() => expect(content(db, 'KS-KAL-011').fabric).toBe('Kala cotton'), SAVED)
  })

  it('works the same for staff', { timeout: LONG }, async () => {
    const { user, db } = await renderApp({ route: route('KS-KAL-011'), credentials: DEMO_STAFF })
    const material = await screen.findByLabelText('Material')
    await user.type(material, 'Kala cotton')
    await waitFor(() => expect(content(db, 'KS-KAL-011').fabric).toBe('Kala cotton'), SAVED)
  })

  it('keeps the single-page editor in one column on tablets, with a camera button', { timeout: LONG }, async () => {
    await renderApp({ route: route('KS-AJR-014'), viewport: 'tablet' })
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
    const { user, db } = await renderApp({ route: route('KS-KAL-011'), viewport: 'mobile' })
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
    await waitFor(() => expect(content(db, 'KS-KAL-011').gender).toBe('men'), SAVED)

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
    expect(record(db, 'KS-KAL-011').status).toBe('draft')
    await user.click(within(list('Your product')).getByLabelText('Change photos'))
    await findH1('Photos')
  })

  it('shows the reason a product was sent back on the first step, and checks the price on Next', { timeout: 60_000 }, async () => {
    const { user } = await renderApp({ route: route('KS-AJR-014'), viewport: 'mobile' })
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

  it('shows a live product\'s changes on the check page', { timeout: 60_000 }, async () => {
    const { user } = await renderApp({ route: route('KS-HCS-003'), viewport: 'mobile' })
    await findH1('Photos')
    for (let i = 0; i < 4; i++) await user.click(button(i === 3 ? 'Check and send' : 'Next', footer()))
    await findH1('Check and send')
    const card = part('Live in the app')
    expect(within(card).getByText('Your changes, in review')).toBeInTheDocument()
    expect(within(card).getByText('Selling price').closest('li')).toHaveTextContent('Yours₹1,199')
  })

  it('asks a new product for its name on the Photos step', { timeout: LONG }, async () => {
    await renderApp({ route: '/products/new', viewport: 'mobile' })
    await findH1('Photos')
    expect(within(part('Photos')).getByLabelText('Name')).toBeInTheDocument()
    expect(within(part('Photos')).getByText('Add a name first, then add photos.')).toBeInTheDocument()
  })
})
