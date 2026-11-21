import { File as NodeFile, Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApi, type Api, type Schemas, type Tokens } from '../api/client'
import { IMPORT_COLUMNS, SUBMIT_REQUIREMENTS } from '../lib/catalog'
import { validApplication } from '../test/fixtures'
import { resetMockDb } from '../test/server'
import { DEMO_LOGIN, KALKI_GSTIN, type MockDb } from './db'
import { IFSC_BANKS } from './ifsc'

// The mock vendor-api over HTTP, as the screens use it: store details, commission, IFSC lookup,
// size charts, the product submit check, photos, the application and bulk import.

const BASE = 'http://localhost'
const NOW = new Date('2026-11-19T10:00:00+05:30')

let db: MockDb
let api: Api

function tokenStore() {
  let current: Tokens | null = null
  return { get: () => current, set: (t: Tokens | null) => { current = t } }
}

async function signIn(): Promise<Api> {
  const tokens = tokenStore()
  const client = createApi({ baseUrl: BASE, tokens })
  tokens.set(await client.call((c) => c.POST('/api/v1/vendor/auth/login', { body: DEMO_LOGIN })))
  return client
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('Expected the request to fail')
}

const me = () => api.call((c) => c.GET('/api/v1/vendor/me'))
const store = () => api.call((c) => c.GET('/api/v1/vendor/store-details'))
const product = (id: string) => api.call((c) => c.GET('/api/v1/vendor/products/{id}', { params: { path: { id } } }))
const submit = (id: string) => api.call((c) => c.POST('/api/v1/vendor/products/{id}/submit', { params: { path: { id } } }))
const patch = (id: string, body: Schemas['ProductInput']) => api.call((c) => c.PATCH('/api/v1/vendor/products/{id}', { params: { path: { id } }, body }))
const savePayout = (body: Schemas['PayoutInput']) => api.call((c) => c.PUT('/api/v1/vendor/store-details/payout', { body }))

// Presign, "upload" (the mock keeps a stand-in swatch when no file arrives), then attach.
async function attach(id: string, angle: Schemas['PhotoAngle']): Promise<Schemas['Product']> {
  const { key, upload_url } = await api.call((c) => c.POST('/api/v1/vendor/uploads/presign', { body: { purpose: 'product', content_type: 'image/jpeg', size_bytes: 1000 } }))
  await fetch(upload_url, { method: 'POST' })
  return api.call((c) => c.POST('/api/v1/vendor/products/{id}/images', { params: { path: { id } }, body: { key, angle } }))
}

beforeEach(async () => {
  db = resetMockDb({ now: () => NOW })
  api = await signIn()
})

describe('demo seed', () => {
  it('has store details complete except payouts, and commission agreed at 12%', async () => {
    const details = await store()
    expect(details).toMatchObject({
      brand_name: 'Kalki Studio',
      sells: 'women',
      payout: null,
      business: { legal_name: 'Kalki Studio LLP', gstin: KALKI_GSTIN },
      missing: ['payout'],
      complete: false,
    })
    const { vendor, setup } = await me()
    expect(setup.store_details).toBe(false)
    expect(vendor.commission).toEqual({ state: 'agreed', agreed_bps: 1200, proposed_bps: null, note: null, updated_at: expect.any(String) })
    expect(vendor.commission_bps).toBe(1200)
  })

  it('gives live and in-review products 4 named and 5 try-on photos, and leaves the sent-back kurta short', async () => {
    const angles = (p: { images: { angle: string }[] }) => p.images.map((i) => i.angle).sort()
    const full = ['back', 'detail', 'front', 'tryon', 'tryon', 'tryon', 'tryon', 'tryon', 'worn']
    for (const p of db.products.filter((p) => p.status === 'approved' || p.status === 'pending_review')) expect(angles(p)).toEqual(full)
    const kurta = await product('p_001')
    expect(kurta).toMatchObject({ title: 'Ajrakh Block-Print Kurta', status: 'rejected', main_colour: 'Indigo', other_colours: ['Red', 'Black'], material: 'Cotton mul' })
    expect(angles(kurta)).toEqual(['detail', 'extra', 'front', 'tryon', 'tryon', 'worn'])
    expect(kurta.review.reason).toContain('only 2 try-on photos')
  })

  it('gives every product the new fields with known colours', async () => {
    for (const p of db.products) {
      expect(p).not.toHaveProperty('fabric')
      expect(p).not.toHaveProperty('returns_use_default')
      expect(p.other_colours.length).toBeLessThanOrEqual(2)
    }
    const list = await api.call((c) => c.GET('/api/v1/vendor/products', { params: { query: { limit: 50 } } }))
    expect(list.items.find((p) => p.id === 'p_014')).toMatchObject({ title: 'Kalamkari Cotton Saree', category: 'Sarees', main_colour: 'Multicolour' })
  })
})

describe('store details', () => {
  it('completes the store when a payout is saved, and only ever returns it masked', async () => {
    const details = await savePayout({ method: 'bank', holder_name: 'Kalki Studio LLP', account_number: '5010 0123 4567 4821', ifsc: 'hdfc0001234' })
    expect(details.payout).toEqual({ method: 'bank', holder_name: 'Kalki Studio LLP', bank_name: 'HDFC Bank', account_last4: '4821', ifsc: 'HDFC0001234' })
    expect(details).toMatchObject({ missing: [], complete: true })
    expect(JSON.stringify(await store())).not.toContain('50100123')
    expect((await me()).setup.store_details).toBe(true)

    const upi = await savePayout({ method: 'upi', upi_id: 'Kalki.Studio@okhdfcbank' })
    expect(upi.payout).toEqual({ method: 'upi', upi_id: 'ka•••@okhdfcbank' })
  })

  it('refuses an IFSC no bank has', async () => {
    const error = await failure(savePayout({ method: 'bank', holder_name: 'Kalki', account_number: '501001234567', ifsc: 'ABCD0123456' }))
    expect(error).toMatchObject({ status: 422, code: 'validation_error', fields: { ifsc: 'We could not find this IFSC code. Check it on your cheque book or bank app.' } })
    expect(db.store.payout).toBeNull()
  })

  it('answers 422 with field keys relative to the section', async () => {
    const delivery = await failure(api.call((c) => c.PUT('/api/v1/vendor/store-details/delivery', { body: { mode: 'shazlo', pickup_address: { line1: 'x', area: 'y', city: 'z', pin: '012345' } } })))
    expect(delivery.fields).toEqual({ 'pickup_address.pin': 'Enter a 6-digit PIN code, like 380015.' })
    const payment = await failure(api.call((c) => c.PUT('/api/v1/vendor/store-details/payment', { body: { cash: false, upi: false } })))
    expect(payment.fields).toEqual({ pay_on_delivery: 'Choose at least one: cash on delivery or UPI on delivery.' })
    const brand = await failure(api.call((c) => c.PUT('/api/v1/vendor/store-details/brand', { body: { sells: 'kids' as 'women', city: '', instagram_or_website: null } })))
    expect(Object.keys(brand.fields)).toEqual(['sells', 'city'])
    const business = await failure(api.call((c) => c.PUT('/api/v1/vendor/store-details/business', { body: { legal_name: null, gstin: '24AAKFK1234L1ZA' } })))
    expect(business.fields).toEqual({ gstin: 'Check your GST number. It has 15 characters, like 24ABCDE1234F1Z6.' })
    const contact = await failure(api.call((c) => c.PUT('/api/v1/vendor/store-details/contact', { body: { name: 'Kiran', phone: '12345', email: 'kiran@kalkistudio.in' } })))
    expect(contact.fields).toEqual({ phone: 'Enter a 10-digit Indian mobile number, like 98250 12345.' })
  })

  it('saves each section in its tidy form', async () => {
    const returns = await api.call((c) => c.PUT('/api/v1/vendor/store-details/returns', { body: { window_days: 0, condition: 'any_reason', refund_days: 7 } }))
    expect(returns.returns).toEqual({ window_days: 0, condition: null, refund_days: null })
    const delivery = await api.call((c) => c.PUT('/api/v1/vendor/store-details/delivery', { body: { mode: 'own', areas: { all_india: false, places: ['Ahmedabad', '380 015'] }, delivery_days: '1_2' } }))
    expect(delivery.delivery).toEqual({ mode: 'own', areas: { all_india: false, places: ['Ahmedabad', '380015'] }, delivery_days: '1_2' })
    const contact = await api.call((c) => c.PUT('/api/v1/vendor/store-details/contact', { body: { name: ' Kiran Shah ', phone: '+91 98250 54321', email: 'Kiran@KalkiStudio.in' } }))
    expect(contact.contact).toEqual({ name: 'Kiran Shah', phone: '9825054321', email: 'kiran@kalkistudio.in' })
    const business = await api.call((c) => c.PUT('/api/v1/vendor/store-details/business', { body: { legal_name: '', gstin: '' } }))
    expect(business.business).toEqual({ legal_name: null, gstin: null })
    const brand = await api.call((c) => c.PUT('/api/v1/vendor/store-details/brand', { body: { sells: 'both', city: 'Bhuj, Kutch', instagram_or_website: '' } }))
    expect(brand).toMatchObject({ sells: 'both', city: 'Bhuj, Kutch', instagram_or_website: null, brand_name: 'Kalki Studio' })
    expect(brand.updated_at).toBe(NOW.toISOString())
  })

  it('reports a topic missing again when its saved data is incomplete', async () => {
    db.store.pay_on_delivery = null
    db.store.contact = null
    expect((await store()).missing).toEqual(['contact', 'pay_on_delivery', 'payout'])
  })
})

describe('IFSC lookup', () => {
  it('names the bank and branch for every known prefix, in any case', async () => {
    for (const prefix of Object.keys(IFSC_BANKS)) {
      const found = await api.call((c) => c.GET('/api/v1/public/ifsc/{code}', { params: { path: { code: `${prefix.toLowerCase()}0001234` } } }))
      expect(found).toEqual({ ifsc: `${prefix}0001234`, bank: IFSC_BANKS[prefix], branch: expect.any(String) })
    }
    expect(Object.keys(IFSC_BANKS)).toEqual(['SBIN', 'HDFC', 'ICIC', 'UTIB', 'KKBK', 'PUNB', 'BARB', 'CNRB', 'UBIN', 'IDIB', 'YESB', 'INDB', 'IDFB'])
  })

  it('answers 404 for an unknown bank and 422 for a code of the wrong shape, without signing in', async () => {
    const anonymous = createApi({ baseUrl: BASE, tokens: tokenStore() })
    expect(await failure(anonymous.call((c) => c.GET('/api/v1/public/ifsc/{code}', { params: { path: { code: 'ABCD0123456' } } })))).toMatchObject({ status: 404 })
    expect(await failure(anonymous.call((c) => c.GET('/api/v1/public/ifsc/{code}', { params: { path: { code: 'HDFC123' } } })))).toMatchObject({ status: 422, fields: { ifsc: expect.any(String) } })
  })
})

describe('commission proposals', () => {
  const propose = (rate_bps: number) => api.call((c) => c.POST('/api/v1/vendor/commission/proposal', { body: { rate_bps } }))

  it('keeps the agreed rate while a new proposal waits', async () => {
    const commission = await propose(1000)
    expect(commission).toEqual({ state: 'proposed', agreed_bps: 1200, proposed_bps: 1000, note: null, updated_at: NOW.toISOString() })
    const { vendor } = await me()
    expect(vendor.commission).toEqual(commission)
    expect(vendor.commission_bps).toBe(1200)
  })

  it('refuses rates outside 0–40%, fractions of a basis point, and the rate already agreed', async () => {
    for (const rate of [-1, 4001, 12.5]) {
      expect(await failure(propose(rate))).toMatchObject({ status: 422, fields: { rate_bps: 'Enter a rate from 0% to 40%.' } })
    }
    expect(await failure(propose(1200))).toMatchObject({ status: 422, fields: { rate_bps: 'That is already your agreed rate.' } })
    expect((await propose(0)).proposed_bps).toBe(0)
    expect((await propose(4000)).proposed_bps).toBe(4000)
  })

  it('moves a sent-back or unset commission to proposed and clears the note', async () => {
    db.commission = { state: 'sent_back', agreed_bps: null, proposed_bps: 800, note: 'We can do 12% for your first three months.', updated_at: NOW.toISOString() }
    expect((await me()).vendor.commission_bps).toBeNull()
    expect(await propose(1100)).toMatchObject({ state: 'proposed', agreed_bps: null, proposed_bps: 1100, note: null })

    db.commission = { state: 'not_set', agreed_bps: null, proposed_bps: null, note: null, updated_at: null }
    expect(await propose(1500)).toMatchObject({ state: 'proposed', agreed_bps: null, proposed_bps: 1500 })
  })
})

describe('size charts', () => {
  const get = (group: Schemas['SizeChartGroup']) => api.call((c) => c.GET('/api/v1/vendor/size-charts/{group}', { params: { path: { group } } }))
  const put = (group: Schemas['SizeChartGroup'], body: Schemas['SizeChartInput']) => api.call((c) => c.PUT('/api/v1/vendor/size-charts/{group}', { params: { path: { group } }, body }))

  it('has the seeded dresses chart and an empty chart for the other groups', async () => {
    expect(await get('dresses')).toMatchObject({ group: 'dresses', measurements: { M: { bust: 91, waist: 77, hip: 99, length: 113 } }, photo_url: null, updated_at: expect.any(String) })
    expect(await get('tops')).toEqual({ group: 'tops', measurements: {}, photo_url: null, updated_at: null })
  })

  it('saves and reads back a chart, filling the group measurements with null', async () => {
    const saved = await put('tops', { measurements: { M: { chest: 100, sleeve: 60.5 }, L: { chest: null } }, photo_url: 'https://res.cloudinary.com/shazlo/size-chart.jpg' })
    const expected = { group: 'tops', measurements: { M: { chest: 100, shoulder: null, sleeve: 60.5, length: null } }, photo_url: 'https://res.cloudinary.com/shazlo/size-chart.jpg', updated_at: NOW.toISOString() }
    expect(saved).toEqual(expected)
    expect(await get('tops')).toEqual(expected)
    // Saving it empty is the same as having none.
    expect(await put('tops', { measurements: {}, photo_url: null })).toEqual({ group: 'tops', measurements: {}, photo_url: null, updated_at: null })
  })

  it('refuses unknown sizes and measurements, and values outside 0–300 cm', async () => {
    const error = await failure(put('bottoms', { measurements: { '30': { waist: 0, chest: 90 }, XXXL: { waist: 80 } }, photo_url: null }))
    expect(error.fields).toEqual({
      'measurements.30.waist': 'Enter centimetres above 0 and up to 300, like 96 or 96.5.',
      'measurements.30.chest': '"chest" is not measured for this size chart.',
      'measurements.XXXL': '"XXXL" is not a size we list.',
    })
    const unknown = await failure(api.call((c) => c.GET('/api/v1/vendor/size-charts/{group}', { params: { path: { group: 'shoes' as 'tops' } } })))
    expect(unknown.status).toBe(404)
  })
})

describe('submitting a product', () => {
  it('lists every missing requirement under stable keys, including store details', async () => {
    const overshirt = await failure(submit('p_008'))
    expect(overshirt).toMatchObject({ status: 422, code: 'validation_error', message: 'Fix these before sending for review.' })
    expect(Object.keys(overshirt.fields)).toEqual(SUBMIT_REQUIREMENTS.filter((k) => k !== 'title' && k !== 'category'))

    const kurta = await failure(submit('p_001'))
    expect(kurta.fields).toEqual({
      photos: 'Add the back photo.',
      tryon: 'Add 3 more try-on photos. We need 5 photos of real people wearing it.',
      store_details: 'Finish your store details first.',
    })
  })

  it('sends a product once it and the store details are complete', async () => {
    expect(Object.keys((await failure(submit('p_027'))).fields)).toEqual(['tryon', 'store_details'])
    await savePayout({ method: 'upi', upi_id: 'kalki.studio@okhdfcbank' })
    for (let i = 0; i < 5; i++) await attach('p_027', 'tryon')
    const sent = await submit('p_027')
    expect(sent).toMatchObject({ status: 'pending_review', review: { state: 'waiting' } })
  })

  it('keeps refusing a selling price above the MRP, but MRP is optional', async () => {
    await savePayout({ method: 'upi', upi_id: 'kalki.studio@okhdfcbank' })
    await patch('p_002', { mrp_paise: 349_900 })
    expect((await failure(submit('p_002'))).fields).toEqual({ price_paise: 'Selling price cannot be above the MRP.' })
    await patch('p_002', { mrp_paise: null })
    expect((await submit('p_002')).status).toBe('pending_review')
  })

  it('names store details in the bulk result too', async () => {
    const { results } = await api.call((c) => c.POST('/api/v1/vendor/products/bulk', { body: { action: 'submit', ids: ['p_002'] } }))
    expect(results).toEqual([{ id: 'p_002', ok: false, code: 'validation_error', message: 'Kutch Mirror-Work Jacket: Finish your store details first.' }])
  })
})

describe('product fields and photos', () => {
  it('saves material and colours, and refuses unknown or repeated colours', async () => {
    expect(await patch('p_008', { material: ' Kala cotton ', main_colour: 'Brown', other_colours: ['Ivory'], gender: 'Men' })).toMatchObject({ material: 'Kala cotton', main_colour: 'Brown', other_colours: ['Ivory'], gender: 'Men' })
    expect((await failure(patch('p_008', { other_colours: ['Red', 'Blue', 'Green'] }))).fields).toEqual({ other_colours: 'Choose up to 2 other colours.' })
    expect((await failure(patch('p_008', { other_colours: ['Brown'] }))).fields).toEqual({ other_colours: 'Other colours should be different from the main colour and from each other.' })
    expect((await failure(patch('p_008', { main_colour: 'Sky' }))).fields).toEqual({ main_colour: '"Sky" is not one of our colours. Choose one from the list.' })
    // A new main colour leaves the other colours.
    expect(await patch('p_008', { main_colour: 'Ivory' })).toMatchObject({ main_colour: 'Ivory', other_colours: [] })
  })

  it('refuses unknown product types, genders and sizes', async () => {
    const error = await failure(patch('p_008', { category: 'Shoes' as 'Kurtas', gender: 'Kids' as 'Men', variants: [{ size: 'Free', sku: '', stock: 1 }] }))
    expect(Object.keys(error.fields)).toEqual(['category', 'gender', 'variants'])
  })

  it('starts new drafts without a gender or product type, and with waist sizes allowed', async () => {
    const created = await api.call((c) => c.POST('/api/v1/vendor/products', { body: { title: 'Indigo Jeans', category: 'Jeans', variants: [{ size: '30', sku: '', stock: 2 }] } }))
    expect(created).toMatchObject({ gender: null, category: 'Jeans', material: '', main_colour: null, other_colours: [], variants: [{ size: '30', sku: `${created.sku}-30`, stock: 2 }] })
  })

  it('holds 5 try-on and 4 extra photos at most, and swaps a photo into a taken slot', async () => {
    const tryonFull = await failure(attach('p_003', 'tryon'))
    expect(tryonFull).toMatchObject({ status: 422, fields: { tryon: 'You can add up to 5 try-on photos.' } })
    for (let i = 0; i < 4; i++) await attach('p_003', 'extra')
    expect((await failure(attach('p_003', 'extra'))).fields).toEqual({ photos: 'You can add up to 4 extra photos.' })

    const before = await product('p_003')
    const worn = before.images.find((i) => i.angle === 'worn')!
    const front = before.images.find((i) => i.angle === 'front')!
    const moved = await api.call((c) => c.PATCH('/api/v1/vendor/products/{id}/images/{image_id}', { params: { path: { id: 'p_003', image_id: worn.id } }, body: { angle: 'front' } }))
    expect(moved.images.find((i) => i.id === worn.id)?.angle).toBe('front')
    expect(moved.images.find((i) => i.id === front.id)?.angle).toBe('worn')
  })

  it('locks photos while a product is in review', async () => {
    expect(await failure(attach('p_007', 'extra'))).toMatchObject({ status: 409, code: 'product_not_editable' })
  })
})

describe('vendor application', () => {
  const apply = (body: Schemas['VendorApplication']) => api.call((c) => c.POST('/api/v1/public/vendor-applications', { body }))

  it('accepts a complete application and stores it tidily', async () => {
    expect(await apply(validApplication)).toEqual({ id: expect.any(String), status: 'applied' })
    expect(db.applications[0]).toMatchObject({
      phone: '9876543210',
      returns: { window_days: 0, condition: null, refund_days: null },
      payout: { method: 'bank', account_number: '5010012345674821', ifsc: 'HDFC0001234' },
    })
  })

  it('answers 422 with dot-path keys for every problem', async () => {
    const error = await failure(apply({
      ...validApplication,
      sells: 'kids' as 'both',
      delivery: { mode: 'shazlo', pickup_address: { line1: '1 Main Road', area: 'Athwa', city: 'Surat', pin: '39500' } },
      returns: { window_days: 7, condition: null, refund_days: 5 },
      pay_on_delivery: { cash: false, upi: false },
      payout: { method: 'bank', holder_name: 'Neel', account_number: '501001234567', ifsc: 'ABCD0123456' },
      gstin: '24ABCDE1234F1Z7',
      proposed_commission_bps: 4500,
      agreed_price_rule: false as true,
    }))
    expect(error.status).toBe(422)
    expect(error.fields).toEqual({
      sells: 'Choose who you sell for: women, men or both.',
      'delivery.pickup_address.pin': 'Enter a 6-digit PIN code, like 380015.',
      'returns.condition': 'Choose which returns you accept.',
      pay_on_delivery: 'Choose at least one: cash on delivery or UPI on delivery.',
      gstin: 'Check your GST number. It has 15 characters, like 24ABCDE1234F1Z6.',
      proposed_commission_bps: 'Enter a rate from 0% to 40%.',
      agreed_price_rule: 'Agree to the price rule to send your application.',
      'payout.ifsc': 'We could not find this IFSC code. Check it on your cheque book or bank app.',
    })
  })
})

describe('bulk import', () => {
  // jsdom's FormData and File cannot pass through Node's fetch, which MSW intercepts; use Node's
  // own classes, as BulkImportDialog.test.tsx does.
  beforeEach(async () => {
    const probe = await new Response('a=1', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).formData()
    vi.stubGlobal('FormData', probe.constructor)
    vi.stubGlobal('File', NodeFile)
    vi.stubGlobal('Blob', NodeBlob)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const upload = async (csv: string) => {
    const { job_id } = await api.call((c) =>
      c.POST('/api/v1/vendor/imports', {
        body: { file: '' },
        bodySerializer: () => {
          const form = new FormData()
          form.append('file', new File([csv], 'catalogue.csv', { type: 'text/csv' }))
          return form
        },
      }),
    )
    return api.call((c) => c.GET('/api/v1/vendor/imports/{job_id}', { params: { path: { job_id } } }))
  }

  it('offers a template with exactly the PDF columns', async () => {
    const template = await api.call((c) => c.GET('/api/v1/vendor/imports/template.csv', { parseAs: 'text' }))
    expect(template.split('\n')[0]).toBe('product_name,gender,product_type,main_colour,other_colours,selling_price,sizes_stock,description,material,mrp')
    expect(template.split('\n')[0]).toBe(IMPORT_COLUMNS.join(','))
    const job = await upload(template)
    expect(job).toMatchObject({ status: 'ready', total_rows: 2, ok_rows: 2, ok_products: 2, error_rows: 0, errors: [] })
  })

  it('names the column and what to fix for each bad row', async () => {
    const csv = [
      IMPORT_COLUMNS.join(','),
      'Ajrakh Kurta,Women,Kurta,Indigo,"Red, Black",2499,"S:4, M:6",Hand block-printed.,Cotton mul,2999',
      'Ajrakh Kurta,Women,Kurtas,Indigo,,2499,S:4,Again.,Cotton,',
      ',Kids,Ethnic kurta,Navy blue shade,"Red, Red",1299/-,M 6,,,999',
      'Linen Shirt,Men,Shirts,White,,1899,"M:2, 2XL:1",Easy linen shirt.,100% linen,1499',
    ].join('\n')
    const job = await upload(csv)
    expect(job).toMatchObject({ status: 'ready', total_rows: 4, ok_rows: 1, ok_products: 1, error_rows: 3 })
    expect(job.errors).toEqual([
      { row: 3, product: 'Ajrakh Kurta', column: 'Product name', field: 'product_name', message: 'This product name is also on row 2. Use one row per product, with all its sizes in Sizes and stock.' },
      { row: 4, product: null, column: 'Product name', field: 'product_name', message: 'Required. Add a product name.' },
      { row: 4, product: null, column: 'Gender', field: 'gender', message: '"Kids" is not a gender we list. Use Women, Men or Unisex.' },
      { row: 4, product: null, column: 'Product type', field: 'product_type', message: '"Ethnic kurta" is not a product type we list. Closest match: Kurtas.' },
      { row: 4, product: null, column: 'Main colour', field: 'main_colour', message: '"Navy blue shade" is not one of our colours. Closest match: Navy.' },
      { row: 4, product: null, column: 'Other colours', field: 'other_colours', message: 'Other colours should be different from the main colour and from each other.' },
      { row: 4, product: null, column: 'Selling price', field: 'selling_price', message: 'Must be a number above 0, like 1299. Found "1299/-".' },
      { row: 4, product: null, column: 'Sizes and stock', field: 'sizes_stock', message: 'Could not read "M 6". Write each size and its stock, like S:4, M:6, L:3.' },
      { row: 4, product: null, column: 'Description', field: 'description', message: 'Required. Add the description.' },
      { row: 4, product: null, column: 'Material', field: 'material', message: 'Required. Add the material.' },
      { row: 5, product: 'Linen Shirt', column: 'MRP', field: 'mrp', message: 'The MRP must be at least the selling price.' },
    ])
  })

  it('fails a file without the template columns', async () => {
    const job = await upload('name,price\nKurta,999')
    expect(job.status).toBe('failed')
    expect(job.errors.map((e) => e.field)).toEqual(['product_name', 'gender', 'product_type', 'main_colour', 'selling_price', 'sizes_stock', 'description', 'material'])
  })

  it('creates drafts with every column and lists them for photo matching', async () => {
    const template = await api.call((c) => c.GET('/api/v1/vendor/imports/template.csv', { parseAs: 'text' }))
    const { job_id } = await api.call((c) =>
      c.POST('/api/v1/vendor/imports', {
        body: { file: '' },
        bodySerializer: () => {
          const form = new FormData()
          form.append('file', new File([template], 'catalogue.csv', { type: 'text/csv' }))
          return form
        },
      }),
    )
    const result = await api.call((c) => c.POST('/api/v1/vendor/imports/{job_id}/commit', { params: { path: { job_id } } }))
    expect(result.created).toBe(2)
    expect(result.products.map((p) => p.title)).toEqual(['Relaxed Linen Shirt', 'Linen Wide-Leg Trousers'])
    const shirt = await product(result.products[0]!.id)
    expect(shirt).toMatchObject({
      status: 'draft',
      gender: 'Men',
      category: 'Shirts',
      main_colour: 'Beige',
      other_colours: ['White'],
      material: '100% linen',
      price_paise: 189_900,
      mrp_paise: 249_900,
      variants: [{ size: 'S', stock: 4 }, { size: 'M', stock: 6 }, { size: 'L', stock: 3 }, { size: 'XL', stock: 0 }].map((v) => expect.objectContaining(v)),
    })
    const trousers = await product(result.products[1]!.id)
    expect(trousers).toMatchObject({ category: 'Trousers', mrp_paise: null, variants: [{ size: '28' }, { size: '30' }, { size: '32' }].map((v) => expect.objectContaining(v)) })
    // Photos then attach to the new draft by id.
    expect((await attach(shirt.id, 'front')).images.map((i) => i.angle)).toEqual(['front'])
  })
})
