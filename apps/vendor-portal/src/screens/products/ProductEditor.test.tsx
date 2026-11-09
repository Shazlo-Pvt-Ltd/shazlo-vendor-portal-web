import { screen, waitFor, within } from '@testing-library/react'
import { File as NodeFile } from 'node:buffer'
import { beforeAll, describe, expect, it } from 'vitest'
import type { MockDb } from '../../mocks/db'
import { renderApp } from '../../test/render'

// Autosave waits a second after typing stops, so server-side checks need more than waitFor's 1 s default.
const SAVED = { timeout: 4000 }

const product = (db: MockDb, id: string) => db.products.find((p) => p.id === id)!
const region = (name: string) => screen.getByRole('region', { name })
const bannerWith = (text: string | RegExp) => screen.getByText(text).closest<HTMLElement>('[role="alert"], [role="status"]')!
// Node's File, not jsdom's: the upload goes through Node's fetch and FormData, which only accept their own.
const png = (name: string) => new NodeFile([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' }) as unknown as File
// Status pills sit next to the page title.
const pill = (status: string) => screen.getByRole('heading', { level: 1 }).parentElement!.querySelector(`[data-status="${status}"]`)

describe('V-07 Product editor', () => {
  // The route lazy-loads the screen; load it once up front so the first test is not timing a cold import.
  beforeAll(async () => {
    await import('./ProductEditor')
  })

  it('shows a sent-back product with the reviewer note, the missing photo, history and payout', async () => {
    await renderApp({ route: '/products/p_001' })
    expect(await screen.findByRole('status', { name: 'Loading product' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajrakh Block-Print Kurta' })).toBeInTheDocument()
    expect(pill('sentBack')).toHaveTextContent('Sent back')
    expect(screen.getByText('KS-AJR-014')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Products›Ajrakh Block-Print Kurta')

    const note = bannerWith('“Back photo is missing. Add front, back and a fabric close-up so shoppers can see the print.”')
    expect(note).toHaveAttribute('role', 'alert')
    expect(note).toHaveTextContent(/Shazlo review team · (2 h ago|Yesterday)/)
    expect(screen.getByRole('button', { name: 'Resubmit for review' })).toBeInTheDocument()

    const photos = region('Photos')
    expect(within(photos).getByText('3 required · up to 8')).toBeInTheDocument()
    expect(within(photos).getByRole('img', { name: 'Front photo' })).toBeInTheDocument()
    expect(within(photos).getByRole('img', { name: 'Fabric close-up photo' })).toBeInTheDocument()
    expect(within(photos).getByRole('button', { name: 'Upload back' })).toHaveAccessibleDescription('Back photo is missing.')
    expect(within(photos).getByRole('button', { name: 'Remove front photo' })).toBeInTheDocument()
    expect(within(photos).getByRole('button', { name: 'Replace front photo' })).toBeInTheDocument()
    expect(within(photos).getByRole('button', { name: 'Remove extra photo 1' })).toBeInTheDocument()
    expect(within(photos).getByRole('button', { name: 'Add photo' })).toBeInTheDocument()

    const history = region('Review history')
    const events = within(history).getAllByRole('listitem')
    expect(events).toHaveLength(3)
    expect(events[0]).toHaveTextContent(/^Sent back/)
    expect(events[1]).toHaveTextContent(/^Submitted for review/)
    expect(events[2]).toHaveTextContent(/^Created as draft/)
    expect(events[0]).toHaveTextContent(/(Today|Yesterday), \d\d:\d\d/)
    expect(events[0]).toHaveTextContent('Back photo is missing.')

    const price = region('Price')
    expect(within(price).getByLabelText('MRP (₹)')).toHaveValue('2,999')
    expect(within(price).getByLabelText('Selling price (₹)')).toHaveValue('2,499')
    expect(await within(price).findByText('₹2,124')).toBeInTheDocument()
    expect(within(price).getByText('after 15% commission (₹375)')).toBeInTheDocument()

    expect(within(region('Details')).getByLabelText('Title')).toHaveValue('Ajrakh Block-Print Kurta')
    expect(within(region('Sizes and stock')).getByText('28 in stock across 5 sizes')).toBeInTheDocument()
    expect(await within(region('Returns')).findByRole('checkbox', { name: 'Use store default: 7-day returns' })).toBeChecked()
    expect(screen.queryByRole('region', { name: 'What needs review again' })).toBeNull()
  })

  it('autosaves a second after typing stops', async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const title = await screen.findByLabelText('Title')
    expect(screen.getByText(/^Saved · 2 h ago$/)).toBeInTheDocument()
    await user.clear(title)
    await user.type(title, 'Ajrakh Kurta — Indigo')
    expect(product(db, 'p_001').title).toBe('Ajrakh Block-Print Kurta')
    await waitFor(() => expect(product(db, 'p_001').title).toBe('Ajrakh Kurta — Indigo'), SAVED)
    expect(await screen.findByText('Saved · just now')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ajrakh Kurta — Indigo')
  })

  it('saves a new product type, gender and fabric from the selects', async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const details = await screen.findByRole('region', { name: 'Details' })
    await user.click(within(details).getByRole('combobox', { name: /^Fabric/ }))
    await user.click(await screen.findByRole('option', { name: 'Linen' }))
    await user.click(within(details).getByRole('combobox', { name: /^Gender/ }))
    await user.click(await screen.findByRole('option', { name: 'Unisex' }))
    await waitFor(() => expect(product(db, 'p_001')).toMatchObject({ fabric: 'Linen', gender: 'Unisex', category: 'Kurtas' }), SAVED)
  })

  it('checks the price against the MRP and only saves a valid price', async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const selling = await screen.findByLabelText('Selling price (₹)')
    expect(selling).toHaveAccessibleDescription('What shoppers pay. It can match the MRP.')

    await user.clear(selling)
    await user.type(selling, '3,500')
    await user.tab()
    expect(selling).toHaveAttribute('aria-invalid', 'true')
    expect(selling).toHaveAccessibleDescription('Selling price cannot be above the MRP.')
    expect(within(region('Price')).getByText('Fix the selling price to see what you receive.')).toBeInTheDocument()

    await user.clear(selling)
    await user.type(selling, '0')
    expect(selling).toHaveAccessibleDescription('Enter a selling price above ₹0.')

    await user.clear(selling)
    await user.type(selling, '1999')
    expect(selling).toHaveAttribute('aria-invalid', 'false')
    expect(within(region('Price')).getByText('₹1,699')).toBeInTheDocument()
    expect(within(region('Price')).getByText('after 15% commission (₹300)')).toBeInTheDocument()
    await waitFor(() => expect(product(db, 'p_001').price_paise).toBe(199900), SAVED)
    expect(product(db, 'p_001').mrp_paise).toBe(299900)
  })

  it('adds and removes sizes with chips and sets stock with the steppers', async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const sizes = await screen.findByRole('region', { name: 'Sizes and stock' })
    const xxl = within(sizes).getByRole('button', { name: 'XXL' })
    expect(xxl).toHaveAttribute('aria-pressed', 'false')
    expect(within(sizes).getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(xxl)
    expect(xxl).toHaveAttribute('aria-pressed', 'true')
    expect(within(sizes).getByText('KS-AJR-014-XXL')).toBeInTheDocument()
    const xxlStock = within(sizes).getByLabelText('Stock for XXL')
    expect(xxlStock).toHaveValue('0')
    expect(within(sizes).getByRole('button', { name: 'Decrease stock for XXL' })).toBeDisabled()
    for (let i = 0; i < 3; i++) await user.click(within(sizes).getByRole('button', { name: 'Increase stock for XXL' }))
    await user.click(within(sizes).getByRole('button', { name: 'Decrease stock for XXL' }))
    expect(xxlStock).toHaveValue('2')

    await user.click(within(sizes).getByRole('button', { name: 'XS' }))
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
  })

  it('uploads the missing back photo, then resubmits and locks the page while in review', async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const photos = await screen.findByRole('region', { name: 'Photos' })
    await user.upload(within(photos).getByLabelText('Back photo file'), png('back.png'))
    expect(await within(photos).findByRole('img', { name: 'Back photo' })).toBeInTheDocument()
    expect(product(db, 'p_001').images.map((i) => i.angle)).toContain('back')
    expect(within(photos).queryByText('Back photo is missing.')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Resubmit for review' }))
    expect(await screen.findByText('Sent for review. We usually decide within 24 hours.')).toBeInTheDocument()
    expect(product(db, 'p_001').status).toBe('pending_review')
    expect(pill('pending')).toHaveTextContent('Pending review')
    expect(screen.queryByText(/^“Back photo is missing/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resubmit for review' })).toBeNull()
    expect(screen.getByLabelText('Title')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Remove back photo' })).toBeNull()
    expect(within(region('Sizes and stock')).getByRole('button', { name: 'M' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('replaces and removes photos, and adds extras', async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const photos = await screen.findByRole('region', { name: 'Photos' })
    const oldFront = product(db, 'p_001').images.find((i) => i.angle === 'front')!.id
    await user.upload(within(photos).getByLabelText('Front photo file'), png('front-new.png'))
    await waitFor(() => expect(product(db, 'p_001').images.find((i) => i.angle === 'front')!.id).not.toBe(oldFront))
    expect(product(db, 'p_001').images.filter((i) => i.angle === 'front')).toHaveLength(1)

    await user.click(within(photos).getByRole('button', { name: 'Remove extra photo 1' }))
    expect(await screen.findByText('Extra 1 photo removed.')).toBeInTheDocument()
    expect(product(db, 'p_001').images.map((i) => i.angle)).not.toContain('extra')

    await user.upload(within(photos).getByLabelText('Extra photo file'), [png('detail-1.png'), png('detail-2.png')])
    expect(await within(photos).findByRole('img', { name: 'Extra photo 2' })).toBeInTheDocument()
    expect(product(db, 'p_001').images.filter((i) => i.angle === 'extra')).toHaveLength(2)
  })

  it('lists what is missing when a draft is not ready and focuses the first problem', async () => {
    const { user } = await renderApp({ route: '/products/p_008' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Kala Cotton Overshirt' })).toBeInTheDocument()
    expect(within(region('Photos')).queryByText('Front photo is missing.')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))

    await screen.findByText('Fix these before sending for review.')
    const problems = bannerWith('Fix these before sending for review.')
    expect(problems).toHaveAttribute('role', 'alert')
    expect(within(problems).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Photos: Add the front and back and fabric close-up photos.',
      'Selling price: Add a selling price.',
      'Sizes and stock: Add at least one size with stock.',
    ])
    const photos = region('Photos')
    await waitFor(() => expect(within(photos).getByRole('button', { name: 'Upload front' })).toHaveFocus())
    expect(within(photos).getByRole('button', { name: 'Upload back' })).toHaveAccessibleDescription('Back photo is missing.')
    expect(screen.getByLabelText('Selling price (₹)')).toHaveAccessibleDescription('Add a selling price.')
    expect(within(region('Sizes and stock')).getByText('Add at least one size with stock.')).toBeInTheDocument()

    await user.click(within(problems).getByRole('button', { name: 'Selling price: Add a selling price.' }))
    expect(screen.getByLabelText('Selling price (₹)')).toHaveFocus()
  })

  it('creates a new product once the seller types a title and keeps editing it in place', async () => {
    const { user, router, db } = await renderApp({ route: '/products/new' })
    expect(await screen.findByRole('heading', { level: 1, name: 'New product' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Products›New product')
    expect(within(region('Photos')).getByText('Add a title first to upload photos.')).toBeInTheDocument()
    expect(within(region('Photos')).getByRole('button', { name: 'Upload front' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Review history' })).toBeNull()

    const before = db.products.length
    const title = screen.getByLabelText('Title')
    await user.type(title, 'Indigo Mul Kurta')
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/products\/p_\d+$/), SAVED)
    expect(router.state.historyAction).toBe('REPLACE')
    expect(db.products).toHaveLength(before + 1)
    const created = db.products[0]!
    expect(created.title).toBe('Indigo Mul Kurta')
    expect(router.state.location.pathname).toBe(`/products/${created.id}`)

    // Same form, same field: the seller keeps typing without losing focus.
    expect(title).toBeInTheDocument()
    expect(title).toHaveFocus()
    expect(await screen.findByRole('heading', { level: 1, name: 'Indigo Mul Kurta' })).toBeInTheDocument()
    expect(within(region('Photos')).getByRole('button', { name: 'Upload front' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument()
    expect(screen.getByText(created.sku)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Description'), 'Hand block-printed mul.')
    await waitFor(() => expect(product(db, created.id).description).toBe('Hand block-printed mul.'), SAVED)
    expect(db.products).toHaveLength(before + 1)
  })

  it('keeps a product in review read-only with no main action', async () => {
    await renderApp({ route: '/products/p_007' })
    expect(await screen.findByText('This product is in review. You can edit it again once our team has decided.')).toBeInTheDocument()
    expect(pill('pending')).toHaveTextContent('Pending review')
    expect(screen.getByLabelText('Title')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Selling price (₹)')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: /for review$/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
    expect(within(region('Sizes and stock')).getByRole('button', { name: 'M' })).toHaveAttribute('aria-disabled', 'true')
    expect(within(region('Sizes and stock')).getByRole('button', { name: 'Increase stock for M' })).toBeDisabled()
    expect(within(region('Photos')).queryByRole('button', { name: /^Remove/ })).toBeNull()
    expect(within(region('Photos')).queryByRole('button', { name: 'Add photo' })).toBeNull()
  })

  it('tells a live product what goes back to review and sends the changes', async () => {
    const { user, db } = await renderApp({ route: '/products/p_003' })
    const note = await screen.findByRole('region', { name: 'What needs review again' })
    expect(within(note).getByText('Price and stock: live immediately')).toBeInTheDocument()
    expect(within(note).getByText('Title, description, photos: reviewed first')).toBeInTheDocument()
    expect(pill('live')).toHaveTextContent('Live')
    expect(within(region('Sizes and stock')).getByText('KS-BDN-022-OS')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Submit changes for review' }))
    expect(await screen.findByText('Changes sent for review. The live version stays in the app until we approve them.')).toBeInTheDocument()
    expect(product(db, 'p_003').edit_in_review).toBe(true)
    expect(product(db, 'p_003').status).toBe('approved')
    expect(pill('editInReview')).toHaveTextContent('Edit in review')
    expect(screen.queryByRole('button', { name: 'Submit changes for review' })).toBeNull()
    expect(screen.getByLabelText('Title')).toHaveAttribute('readonly')
  })

  it('archives after a confirmation', async () => {
    const { user, db, router } = await renderApp({ route: '/products/p_001' })
    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive product' }))
    let dialog = await screen.findByRole('dialog', { name: 'Archive this product?' })
    expect(dialog).toHaveAccessibleDescription('It leaves the app and moves to Archived.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(product(db, 'p_001').status).toBe('rejected')

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive product' }))
    dialog = await screen.findByRole('dialog', { name: 'Archive this product?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive product' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    expect(product(db, 'p_001').status).toBe('archived')
    expect(await screen.findByText('Product archived. Find it under Archived in Products.')).toBeInTheDocument()
  })

  it('says so when the product does not exist', async () => {
    await renderApp({ route: '/products/p_999' })
    expect(await screen.findByRole('heading', { name: 'We could not find that product' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to products' })).toHaveAttribute('href', '/products')
  })

  it('shows why a photo was refused under the photos', async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const photos = await screen.findByRole('region', { name: 'Photos' })
    db.failNext = { path: '/uploads/presign', status: 415, code: 'unsupported_media_type', message: 'Use a JPG, PNG or WebP photo.' }
    await user.upload(within(photos).getByLabelText('Back photo file'), png('back.png'))
    expect(await within(photos).findByText('back.png was not added. Use a JPG, PNG or WebP photo.')).toBeInTheDocument()
    expect(within(photos).getByRole('button', { name: 'Upload back' })).toBeInTheDocument()
    expect(product(db, 'p_001').images.map((i) => i.angle)).not.toContain('back')
  })

  it('goes read-only when the product went into review elsewhere', async () => {
    const { user, db } = await renderApp({ route: '/products/p_001' })
    const title = await screen.findByLabelText('Title')
    db.failNext = { path: '/products/p_001', status: 409, code: 'product_not_editable', message: 'This product is in review. You can edit it again once we have decided.' }
    await user.type(title, ' — Indigo')
    expect(await screen.findByText('This product is in review, so your last change was not saved. You can edit it again once our team has decided.', {}, SAVED)).toBeInTheDocument()
    expect(title).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Resubmit for review' })).toBeNull()
  })

  it('stacks into one column on phones with the photo slots in a scrolling row', async () => {
    await renderApp({ route: '/products/p_001', viewport: 'mobile' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajrakh Block-Print Kurta' })).toBeInTheDocument()
    const order = ['Photos', 'Details', 'Price', 'Sizes and stock', 'Review history', 'Returns'].map(region)
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(screen.getByTestId('editor-columns')).toHaveAttribute('data-layout', 'single')
    expect(within(region('Photos')).getByRole('list', { name: 'Required photos' })).toHaveStyle({ overflowX: 'auto', flexWrap: 'nowrap' })
    expect(screen.getByRole('button', { name: 'Resubmit for review' })).toBeInTheDocument()
    expect(within(region('Sizes and stock')).getByRole('button', { name: 'Increase stock for M' })).toHaveStyle({ width: '44px', height: '44px' })
  })

  it('uses two columns on desktop', async () => {
    await renderApp({ route: '/products/p_001' })
    await screen.findByRole('heading', { level: 1, name: 'Ajrakh Block-Print Kurta' })
    expect(screen.getByTestId('editor-columns')).toHaveAttribute('data-layout', 'two-column')
    expect(within(region('Photos')).getByRole('list', { name: 'Required photos' })).toHaveStyle({ flexWrap: 'wrap' })
  })
})
