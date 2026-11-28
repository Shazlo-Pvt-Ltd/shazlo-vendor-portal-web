// @vitest-environment node
import { getResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { mockApiEnabled } from './browser'
import { createDb, DEMO_BLOCKED, DEMO_LOGIN, uuidFrom } from './db'
import { createHandlers, decide } from './handlers'
import { checkCsv, IMPORT_TEMPLATE } from './imports'
import { swatch, swatchSvg } from './swatch'

type Body = { access_token: string; error: { code: string; request_id: string } } & Record<string, unknown>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/

function api(db = createDb()) {
  const handlers = createHandlers(() => db)
  let token = ''
  const send = async (method: string, path: string, body?: unknown) => {
    const headers = new Headers(body === undefined ? {} : { 'Content-Type': 'application/json' })
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = (await getResponse(handlers, new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })))!
    const text = await response.text()
    return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : null) as Body }
  }
  return { db, send, use: (next: string) => (token = next) }
}

describe('the demo database', () => {
  it('holds Kalki Studio\'s catalogue in vendor-api\'s records, with uuid ids', () => {
    const db = createDb()
    const kalki = db.vendors.find((v) => v.name === 'Kalki Studio')!
    expect(db.products.filter((p) => p.vendor_id === kalki.id)).toHaveLength(27)
    expect(db.products.every((p) => UUID.test(p.id))).toBe(true)
    expect([...db.assets.keys()].every((id) => UUID.test(id))).toBe(true)
    expect(uuidFrom(255)).toBe('00000000-0000-4000-8000-0000000000ff')
  })

  it('keeps no web storage and serves photos as blob: URLs, never data:', () => {
    const db = createDb()
    expect([...db.assets.values()].every((a) => a.url.startsWith('blob:'))).toBe(true)
    expect(swatch('KS-AJR-014', 'front')).toBe(swatch('KS-AJR-014', 'front'))
    expect(swatchSvg('KS-AJR-014', 'tryon', 3)).toMatch(/^<svg /)
    expect([...db.assets.values()].some((a) => a.url.startsWith('data:'))).toBe(false)
  })

  it('is on only when VITE_MOCK_API is "on"', () => {
    expect(mockApiEnabled({ VITE_MOCK_API: 'on' })).toBe(true)
    expect(mockApiEnabled({})).toBe(false)
    expect(mockApiEnabled({ VITE_MOCK_API: 'true' })).toBe(false)
  })
})

describe('mock auth behaves like vendor-api', () => {
  it('login answers a session and sets the refresh cookie; refresh rotates it; logout ends it', async () => {
    const { db, send, use } = api()
    const login = await send('POST', '/v1/auth/login', DEMO_LOGIN)
    expect(login.status).toBe(200)
    expect(login.body).toMatchObject({ token_type: 'Bearer', expires_in: 900, user: { email: DEMO_LOGIN.email, role: 'owner' }, vendor: { name: 'Kalki Studio' } })
    // As vendor-api (PR #281): the commission has its own route, not a place on the session.
    expect(login.body.vendor).not.toHaveProperty('commission')
    expect(login.body).not.toHaveProperty('refresh_token')
    const first = db.cookie.vendor_refresh
    expect(first).toBeTruthy()
    const refreshed = await send('POST', '/v1/auth/refresh')
    expect(refreshed.status).toBe(200)
    expect(db.cookie.vendor_refresh).not.toBe(first)
    expect(db.sessions.refresh.has(first!)).toBe(false)
    use(refreshed.body.access_token)
    expect((await send('GET', '/v1/vendor/me')).status).toBe(200)
    expect((await send('POST', '/v1/auth/logout')).status).toBe(204)
    expect(db.cookie.vendor_refresh).toBeNull()
    expect((await send('POST', '/v1/auth/refresh')).body).toMatchObject({ error: { code: 'invalid_refresh_token' } })
  })

  it('a bad or expired token is a 401 with WWW-Authenticate', async () => {
    let now = new Date('2026-11-21T10:00:00Z')
    const { send, use } = api(createDb({ now: () => now }))
    use((await send('POST', '/v1/auth/login', DEMO_LOGIN)).body.access_token)
    expect((await send('GET', '/v1/vendor/me')).status).toBe(200)
    now = new Date('2026-11-21T10:16:00Z')
    const expired = await send('GET', '/v1/vendor/me')
    expect(expired.status).toBe(401)
    expect(expired.headers.get('WWW-Authenticate')).toBe('Bearer')
    use('garbage')
    expect((await send('GET', '/v1/vendor/me')).body).toMatchObject({ error: { code: 'unauthorized' } })
  })

  it('a suspended vendor cannot sign in', async () => {
    const { send } = api()
    expect((await send('POST', '/v1/auth/login', DEMO_BLOCKED)).body).toMatchObject({ error: { code: 'vendor_not_allowed' } })
  })

  it('every error carries the X-Request-ID it names', async () => {
    const { send } = api()
    const failed = await send('POST', '/v1/auth/login', { email: DEMO_LOGIN.email, password: 'nope' })
    expect(failed.headers.get('X-Request-ID')).toBe(failed.body.error.request_id)
  })

  it('a queued fault answers once, then the route works again', async () => {
    const { db, send } = api()
    db.faults.push({ path: '/v1/auth/login', status: 429, code: 'rate_limited', message: 'Slow down.' })
    expect((await send('POST', '/v1/auth/login', DEMO_LOGIN)).status).toBe(429)
    expect((await send('POST', '/v1/auth/login', DEMO_LOGIN)).status).toBe(200)
  })

  it('asks for passwords of 12 to 128 characters, like vendor-api\'s default setting', async () => {
    const { send, use } = api()
    use((await send('POST', '/v1/auth/login', DEMO_LOGIN)).body.access_token)
    const change = (next: string) => send('POST', '/v1/auth/change-password', { current_password: DEMO_LOGIN.password, new_password: next })
    expect((await change('elevenchars')).body).toMatchObject({ error: { code: 'weak_password' } })
    expect((await change('x'.repeat(129))).body).toMatchObject({ error: { code: 'weak_password' } })
    expect((await change('twelve chars')).status).toBe(200)
  })
})

describe('the three later proposals, on or off', () => {
  async function signedIn(db = createDb()) {
    const a = api(db)
    a.use((await a.send('POST', '/v1/auth/login', DEMO_LOGIN)).body.access_token)
    return a
  }

  it('list rows carry their own fields, and the list filters and sorts', async () => {
    const { send } = await signedIn()
    const page = (await send('GET', '/v1/vendor/products?gender=unisex&in_stock=true&sort=price_desc&limit=10')).body as unknown as { items: Record<string, unknown>[]; total: number }
    expect(page.total).toBe(4)
    expect(page.items.map((i) => i.price_paise)).toEqual([399900, 349900, 219900, 119900])
    expect(page.items[0]).toMatchObject({ sku: 'KS-KMJ-007', gender: 'unisex', working_state: 'rejected', main_colour: 'Black', stock: 6 })
    expect(Object.keys(page.items[0]!)).toEqual(expect.arrayContaining(['price_paise', 'mrp_paise', 'stock', 'thumbnail_url', 'main_colour', 'gender', 'working_state']))
  })

  it('off, the list is today\'s: plain rows, and the new filters are ignored', async () => {
    const db = createDb()
    db.proposals.productSummaries = false
    const { send } = await signedIn(db)
    const page = (await send('GET', '/v1/vendor/products?gender=unisex&limit=100')).body as unknown as { items: Record<string, unknown>[]; total: number }
    expect(page.total).toBe(27)
    expect(Object.keys(page.items[0]!).sort()).toEqual(['category', 'has_pending_changes', 'id', 'sku', 'status', 'title', 'updated_at', 'version'])
  })

  it('submissions name their product, unless the proposal is off', async () => {
    const db = createDb()
    const { send } = await signedIn(db)
    const withIds = (await send('GET', '/v1/vendor/submissions?subject=product&limit=1')).body as unknown as { items: Record<string, unknown>[] }
    expect(withIds.items[0]!.product_id).toBe(db.products.find((p) => p.sku === withIds.items[0]!.sku)!.id)
    db.proposals.submissionProductIds = false
    const without = (await send('GET', '/v1/vendor/submissions?subject=product&limit=1')).body as unknown as { items: Record<string, unknown>[] }
    expect(without.items[0]).not.toHaveProperty('product_id')
  })

  it('a save with an old version is refused with 409 version_conflict; every change raises the version', async () => {
    const db = createDb()
    const { send } = await signedIn(db)
    const coord = db.products.find((p) => p.sku === 'KS-DAB-042')!
    const read = (await send('GET', `/v1/vendor/products/${coord.id}`)).body as unknown as { version: number; working: { title: string } }
    const saved = await send('PUT', `/v1/vendor/products/${coord.id}`, { title: 'New title', version: read.version })
    expect(saved.status).toBe(200)
    expect((saved.body as unknown as { version: number }).version).toBe(read.version + 1)
    const stale = await send('PUT', `/v1/vendor/products/${coord.id}`, { title: 'Stale title', version: read.version })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('version_conflict')
    expect(coord.working!.content.title).toBe('New title')
    expect((await send('PUT', `/v1/vendor/products/${coord.id}`, { title: 'No version sent' })).status).toBe(200)
    db.proposals.productVersions = false
    expect((await send('PUT', `/v1/vendor/products/${coord.id}`, { title: 'Old version, check off', version: 1 })).status).toBe(200)
  })
})

describe('decide (an admin\'s decision, for tests and the demo)', () => {
  it('approves a change to a live product: the change goes live and the version moves on', () => {
    const db = createDb()
    const shirt = db.products.find((p) => p.sku === 'KS-HCS-003')!
    decide(db, { productId: shirt.id }, { approve: true })
    expect(shirt).toMatchObject({ status: 'approved', working: null, version: 2 })
    expect(shirt.live!.content.variants[0]!.price_paise).toBe(119900)
  })

  it('sends a new product back with the reason', () => {
    const db = createDb()
    const skirt = db.products.find((p) => p.sku === 'KS-DAB-040')!
    decide(db, { productId: skirt.id }, { approve: false, reason: 'Plain background, please.' })
    expect(skirt.status).toBe('rejected')
    expect(db.submissions.find((s) => s.product_id === skirt.id)).toMatchObject({ status: 'rejected', reason: 'Plain background, please.' })
  })
})

describe('the bulk import keeps the limits of vendor-api', () => {
  it('refuses a file over 2 MB (413) and one over 1,000 rows (422 too_many_rows)', async () => {
    const db = createDb()
    const handlers = createHandlers(() => db)
    const login = await getResponse(handlers, new Request('https://api.test/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DEMO_LOGIN) }))
    const token = ((await login!.json()) as { access_token: string }).access_token
    const post = (body: string) =>
      getResponse(handlers, new Request('https://api.test/v1/vendor/products/import?mode=validate', { method: 'POST', headers: { 'Content-Type': 'text/csv', Authorization: `Bearer ${token}` }, body }))
    const [header, row] = IMPORT_TEMPLATE.split('\n')
    const big = await post(`${header}\n${'x'.repeat(2 * 1024 * 1024)}`)
    expect(big!.status).toBe(413)
    expect(((await big!.json()) as Body).error.code).toBe('file_too_large')
    const long = await post([header, ...Array.from({ length: 1001 }, () => row)].join('\n'))
    expect(long!.status).toBe(422)
    expect(((await long!.json()) as Body).error.code).toBe('too_many_rows')
    const fine = await post([header, ...Array.from({ length: 1000 }, (_, i) => row!.replace('Relaxed Linen Shirt', `Shirt ${i}`))].join('\n'))
    expect(fine!.status).toBe(200)
  })
})

describe('checkCsv', () => {
  it('reads the template\'s rows as ready products', () => {
    const sheet = checkCsv(IMPORT_TEMPLATE)
    expect(sheet.rowsRead).toBe(2)
    expect(sheet.problems).toEqual([])
    expect(sheet.rows[0]).toMatchObject({ name: 'Relaxed Linen Shirt', gender: 'Men', category: 'Shirts', price_paise: 189900, mrp_paise: 249900, variants: [{ size: 'S', stock: 4 }, { size: 'M', stock: 6 }, { size: 'L', stock: 3 }, { size: 'XL', stock: 0 }] })
  })

  it('names the row and the column of each problem', () => {
    const sheet = checkCsv('product_name,gender,product_type,main_colour,selling_price,sizes_stock,description,material\nShirt,Robot,Shirts,Beige,abc,"S:4",x,y')
    expect(sheet.problems.map((p) => [p.row, p.column])).toEqual([[2, 'gender'], [2, 'selling_price']])
    expect(sheet.rows).toEqual([])
  })

  it('takes any colour name or hex code, tidied, as the editor does', () => {
    const header = 'product_name,gender,product_type,main_colour,other_colours,selling_price,sizes_stock,description,material'
    const sheet = checkCsv(
      [
        header,
        'Rust Kurta,Women,Kurtas,#b7410e,"Kalamkari  indigo, ivory",1499,S:2,Block-printed.,Cotton',
        'Bad Hex Kurta,Women,Kurtas,#12,,1499,S:2,x,Cotton',
        'Odd Other Kurta,Women,Kurtas,Indigo,#GGGGGG,1499,S:2,x,Cotton',
        'Twice Kurta,Women,Kurtas,Rust orange,rust ORANGE,1499,S:2,x,Cotton',
        `Long Kurta,Women,Kurtas,${'A'.repeat(33)},,1499,S:2,x,Cotton`,
      ].join('\n'),
    )
    expect(sheet.rows).toHaveLength(1)
    expect(sheet.rows[0]).toMatchObject({ main_colour: '#B7410E', other_colours: ['Kalamkari indigo', 'Ivory'] })
    expect(sheet.problems.map((p) => [p.row, p.column, p.message])).toEqual([
      [3, 'main_colour', expect.stringMatching(/^Could not read "#12" as a colour\. Enter a hex code as # and 6 digits or letters A to F, like #[0-9A-F]{6}\.$/)],
      [4, 'other_colours', expect.stringMatching(/^Could not read "#GGGGGG" as a colour\. Enter a hex code/)],
      [5, 'other_colours', 'Other colours should be different from the main colour and from each other.'],
      [6, 'main_colour', `Could not read "${'A'.repeat(33)}" as a colour. Keep the colour name to 32 characters.`],
    ])
  })

  it('reports missing columns on the header row and reads nothing', () => {
    const sheet = checkCsv('name,price\nShirt,1')
    expect(sheet.rowsRead).toBe(0)
    expect(sheet.problems[0]).toMatchObject({ row: 1, column: 'product_name', code: 'missing_column' })
    expect(sheet.ignored).toEqual(['name', 'price'])
  })
})
