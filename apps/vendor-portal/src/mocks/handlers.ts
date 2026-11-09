import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import type { Schemas } from '../api/client'
import { CATEGORIES, nextId, SIZES, type ImportRecord, type ImportRow, type MockDb, type ProductRecord } from './db'
import { swatch } from './swatch'

// Mock vendor-api routes, matching openapi/vendor-portal.yaml. `*` matches any origin, so the same
// handlers serve the browser worker and the Node test server.
const API = '*/api/v1'
const ACCESS_TTL_MS = 15 * 60_000
const MAX_UPLOAD = 10 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

type GetDb = () => MockDb

function fail(status: number, code: string, message: string, fields?: Record<string, string>) {
  return HttpResponse.json({ message, extra: fields ? { code, fields } : { code } }, { status })
}

function summaryOf(p: ProductRecord): Schemas['ProductSummary'] {
  return {
    id: p.id,
    title: p.title,
    sku: p.sku,
    category: p.category,
    status: p.status,
    price_paise: p.price_paise,
    mrp_paise: p.mrp_paise,
    stock: p.variants.length ? p.variants.reduce((n, v) => n + v.stock, 0) : null,
    thumbnail_url: p.images.find((i) => i.angle === 'front')?.url ?? p.images[0]?.url ?? null,
    updated_at: p.updated_at,
    edit_in_review: p.edit_in_review,
    publishing: p.publishing,
  }
}

function productOut(p: ProductRecord): Schemas['Product'] {
  const { thumbnail_url: _t, submitted_at: _s, decided_at: _d, publishing: _p, edit_submitted_at: _e, ...product } = p
  return product
}

function counts(db: MockDb): Schemas['StatusCounts'] {
  const c = { all: 0, approved: 0, pending_review: 0, rejected: 0, draft: 0, archived: 0 }
  for (const p of db.products) {
    c[p.status] += 1
    if (p.status !== 'archived') c.all += 1
  }
  return c
}

function changedFields(db: MockDb): string[] {
  const { live, draft } = db.brand
  if (!draft) return []
  if (!live) return Object.keys(draft)
  return (Object.keys(draft) as (keyof typeof draft)[]).filter((k) => draft[k] !== live[k])
}

function brandPage(db: MockDb): Schemas['BrandPage'] {
  return { ...db.brand, changed_fields: changedFields(db) }
}

function reviewItems(db: MockDb): Schemas['ReviewItem'][] {
  const items: Schemas['ReviewItem'][] = []
  for (const p of db.products) {
    const subject = { type: 'product' as const, id: p.id, title: p.title, detail: p.sku, thumbnail_url: p.thumbnail_url }
    if (p.edit_in_review && p.edit_submitted_at) {
      items.push({ id: `r_${p.id}_edit`, subject, kind: 'edit', state: 'waiting', submitted_at: p.edit_submitted_at })
    }
    if (!p.submitted_at || p.status === 'draft' || p.status === 'archived') continue
    const state = p.status === 'pending_review' ? 'waiting' : p.status === 'rejected' ? 'rejected' : 'approved'
    items.push({
      id: `r_${p.id}`,
      subject,
      kind: 'new',
      state,
      submitted_at: p.submitted_at,
      ...(p.decided_at && state !== 'waiting' ? { decided_at: p.decided_at } : {}),
      ...(state === 'rejected' && p.review.reason ? { reason: p.review.reason } : {}),
      ...(state === 'approved' ? { publishing: p.publishing } : {}),
    })
  }
  const b = db.brand
  if (b.review.state !== 'none' && b.review.at) {
    const subject = { type: 'brand_page' as const, id: 'brand', title: 'Brand page', detail: b.review.state === 'waiting' ? changedFields(db).join(', ') : 'story and cover', thumbnail_url: b.live?.cover_url ?? null }
    items.push({
      id: 'r_brand',
      subject,
      kind: b.live ? 'edit' : 'new',
      state: b.review.state,
      submitted_at: b.submitted_at ?? b.review.at,
      ...(b.review.state !== 'waiting' ? { decided_at: b.review.at } : {}),
      ...(b.review.reason ? { reason: b.review.reason } : {}),
    })
  }
  const time = (r: Schemas['ReviewItem']) => Date.parse(r.decided_at ?? r.submitted_at)
  return items.sort((a, b) => time(b) - time(a))
}

function setupOf(db: MockDb): Schemas['Me']['setup'] {
  return {
    password_set: db.passwordSet,
    brand_page: db.brand.live !== null,
    first_product: db.products.length > 0,
    return_policy: false,
    live_products: db.products.filter((p) => p.status === 'approved').length,
    live_target: 10,
  }
}

function issueTokens(db: MockDb): Schemas['TokenPair'] {
  const access = nextId(db, 'access')
  const refresh = nextId(db, 'refresh')
  db.sessions.access.set(access, db.now().getTime() + ACCESS_TTL_MS)
  db.sessions.refresh.add(refresh)
  return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL_MS / 1000 }
}

function authed(getDb: GetDb, resolver: HttpResponseResolver): HttpResponseResolver {
  return (info) => {
    const db = getDb()
    const token = info.request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
    const expires = db.sessions.access.get(token)
    if (!expires || expires < db.now().getTime()) return fail(401, 'unauthenticated', 'Your session has ended. Sign in again.')
    const path = new URL(info.request.url).pathname
    if (db.failNext && path.endsWith(db.failNext.path)) {
      const f = db.failNext
      db.failNext = null
      return fail(f.status, f.code, f.message)
    }
    return resolver(info)
  }
}

function findProduct(db: MockDb, id: string | readonly string[] | undefined): ProductRecord | undefined {
  return db.products.find((p) => p.id === id)
}

function applyInput(p: ProductRecord, input: Schemas['ProductInput'], now: string): void {
  const { variants, ...rest } = input
  Object.assign(p, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)))
  if (variants) {
    p.variants = variants.map((v) => ({ size: v.size, sku: v.sku || `${p.sku}-${v.size === 'One size' ? 'OS' : v.size}`, stock: Math.max(0, Math.trunc(v.stock)) }))
  }
  p.updated_at = now
}

function submitProblems(p: ProductRecord): Record<string, string> {
  const problems: Record<string, string> = {}
  if (!p.title.trim()) problems.title = 'Add a title.'
  if (!p.category) problems.category = 'Choose a product type.'
  if (!p.price_paise) problems.price_paise = 'Add a selling price.'
  if (p.price_paise && p.mrp_paise && p.price_paise > p.mrp_paise) problems.price_paise = 'Selling price cannot be above the MRP.'
  const angles = new Set(p.images.map((i) => i.angle))
  const missing = (['front', 'back', 'closeup'] as const).filter((a) => !angles.has(a))
  if (missing.length) problems.images = `Add the ${missing.map((a) => (a === 'closeup' ? 'fabric close-up' : a)).join(' and ')} photo${missing.length > 1 ? 's' : ''}.`
  if (!p.variants.some((v) => v.stock > 0)) problems.variants = 'Add at least one size with stock.'
  return problems
}

// ---- bulk import --------------------------------------------------------------------------

const TEMPLATE_COLUMNS = ['product_id', 'product_name', 'category', 'description', 'price', 'mrp', 'stock_qty', 'size', 'gender', 'material', 'image_1', 'image_2', 'image_3', 'returnable']

export const IMPORT_TEMPLATE = `${TEMPLATE_COLUMNS.join(',')}\nKS-NEW-001,Ajrakh Cotton Kurta,Kurtas,Hand block-printed mul cotton,2499,2999,6,M,Women,Cotton (mul),https://…/front.jpg,https://…/back.jpg,https://…/closeup.jpg,yes\n`

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"'
        i += 1
      } else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      out.push(cell)
      cell = ''
    } else cell += ch
  }
  out.push(cell)
  return out.map((c) => c.trim())
}

function closestCategory(value: string): string | null {
  const v = value.toLowerCase().replace(/s$/, '')
  return CATEGORIES.find((c) => c.toLowerCase().startsWith(v.slice(0, 3))) ?? null
}

function checkCsv(text: string, fileName: string, id: string): ImportRecord {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const header = splitCsvLine(lines[0] ?? '').map((h) => h.toLowerCase())
  const col = (cells: string[], name: string) => cells[header.indexOf(name)] ?? ''
  const errors: ImportRecord['errors'] = []
  const rows: ImportRow[] = []
  let imageErrors = 0
  lines.slice(1).forEach((line, i) => {
    const row = i + 2
    const cells = splitCsvLine(line)
    const name = col(cells, 'product_name')
    const product = name || null
    const before = errors.length
    const price = col(cells, 'price')
    const size = col(cells, 'size')
    const category = col(cells, 'category')
    if (!name) errors.push({ row, product, column: 'Product name', message: 'Required. Add a product name.' })
    if (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) <= 0) errors.push({ row, product, column: 'Price', message: `Must be a number above 0. Found "${price}"; use ${price.replace(/[^\d.]/g, '') || '1299'}.` })
    if (!SIZES.includes(size)) errors.push({ row, product, column: 'Size', message: `"${size}" is not supported. Use XS–XXL or One size.` })
    if (!CATEGORIES.includes(category)) {
      const match = closestCategory(category)
      errors.push({ row, product, column: 'Category', message: `"${category}" is not a category.${match ? ` Closest match: ${match}.` : ''}` })
    }
    const image = col(cells, 'image_1')
    if (image && !/^https:\/\//.test(image)) {
      imageErrors += 1
      errors.push({ row, product, column: 'Image 1', message: 'Link could not be opened. Use a public https link, or add the photo in the editor.' })
    }
    if (errors.length === before) {
      rows.push({
        product_id: col(cells, 'product_id'),
        name,
        category,
        description: col(cells, 'description'),
        price_paise: Math.round(Number(price) * 100),
        mrp_paise: Math.round(Number(col(cells, 'mrp') || price) * 100),
        stock: Number(col(cells, 'stock_qty')) || 0,
        size,
        gender: col(cells, 'gender') || 'Women',
        fabric: col(cells, 'material') || 'Cotton',
      })
    }
  })
  const total = lines.length - 1
  const errorRows = new Set(errors.map((e) => e.row)).size
  return { id, status: 'ready', file_name: fileName, total_rows: total, ok_rows: total - errorRows, error_rows: errorRows, image_errors: imageErrors, errors, rows }
}

// A spreadsheet the mock cannot read gets the wireframe's example result (V-08).
function exampleJob(fileName: string, id: string): ImportRecord {
  const rows: ImportRow[] = Array.from({ length: 47 }, (_, i) => ({
    product_id: `KS-IMP-${String(Math.floor(i / 2) + 1).padStart(3, '0')}`,
    name: ['Indigo Dabu Kurta', 'Bagru Print Palazzo', 'Kala Cotton Jacket', 'Mashru Silk Stole'][i % 4]!,
    category: ['Kurtas', 'Palazzos', 'Jackets', 'Stoles'][i % 4]!,
    description: '',
    price_paise: 149_900,
    mrp_paise: 169_900,
    stock: 4,
    size: ['S', 'M'][i % 2]!,
    gender: 'Women',
    fabric: 'Cotton',
  }))
  return {
    id,
    status: 'ready',
    file_name: fileName,
    total_rows: 52,
    ok_rows: 47,
    error_rows: 5,
    image_errors: 3,
    rows,
    errors: [
      { row: 12, product: 'Bagru Print Palazzo', column: 'Price', message: 'Must be a number above 0. Found "1,299/-"; use 1299.' },
      { row: 19, product: 'Indigo Dabu Kurta', column: 'Size', message: '"Free size" is not supported. Use XS–XXL or One size.' },
      { row: 27, product: 'Kala Cotton Jacket', column: 'Image 1', message: 'Link could not be opened (access denied). Make the file public or upload it in the editor.' },
      { row: 33, product: null, column: 'Product name', message: 'Required. Add a product name.' },
      { row: 41, product: 'Mashru Silk Stole', column: 'Category', message: '"Stoles" is not a category. Closest match: Dupattas.' },
    ],
  }
}

// ---- handlers ------------------------------------------------------------------------------

export function createHandlers(getDb: GetDb) {
  const iso = () => getDb().now().toISOString()

  return [
    http.post(`${API}/public/vendor-applications`, async ({ request }) => {
      const db = getDb()
      const body = (await request.json()) as Schemas['VendorApplication']
      const fields: Record<string, string> = {}
      if (!body.brand_name?.trim()) fields.brand_name = 'Add your brand name.'
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email ?? '')) fields.email = 'Enter an email like name@brand.in.'
      if (!/^[6-9]\d{9}$/.test((body.phone ?? '').replace(/\D/g, '').slice(-10))) fields.phone = 'Enter a 10-digit Indian mobile number.'
      if (Object.keys(fields).length) return fail(422, 'validation_error', 'Check the highlighted fields.', fields)
      const existing = db.applications.find((a) => a.email.toLowerCase() === body.email.toLowerCase())
      if (existing) return HttpResponse.json({ id: existing.id, status: 'applied' }, { status: 201 })
      const id = nextId(db, 'app')
      db.applications.push({ ...body, id })
      return HttpResponse.json({ id, status: 'applied' }, { status: 201 })
    }),

    http.post(`${API}/vendor/auth/login`, async ({ request }) => {
      const db = getDb()
      const { identifier, password } = (await request.json()) as { identifier: string; password: string }
      if (identifier.trim().toLowerCase() !== db.user.email || password !== db.user.password || !db.passwordSet) {
        return fail(401, 'unauthenticated', 'That email and password do not match. Check both and try again.')
      }
      return HttpResponse.json(issueTokens(db))
    }),

    http.post(`${API}/vendor/auth/refresh`, async ({ request }) => {
      const db = getDb()
      const { refresh_token } = (await request.json()) as { refresh_token: string }
      if (!db.sessions.refresh.delete(refresh_token)) return fail(401, 'unauthenticated', 'Your session has ended. Sign in again.')
      return HttpResponse.json(issueTokens(db))
    }),

    http.post(`${API}/vendor/auth/logout`, async ({ request }) => {
      const { refresh_token } = (await request.json()) as { refresh_token: string }
      getDb().sessions.refresh.delete(refresh_token)
      return new HttpResponse(null, { status: 204 })
    }),

    http.get(`${API}/vendor/auth/invites/:token`, ({ params }) => {
      const invite = getDb().invites.get(String(params.token))
      return invite ? HttpResponse.json(invite) : fail(404, 'not_found', 'This invite link has expired or was already used.')
    }),

    http.post(`${API}/vendor/auth/accept-invite`, async ({ request }) => {
      const db = getDb()
      const { token, password } = (await request.json()) as { token: string; password: string }
      if (!db.invites.has(token)) return fail(404, 'not_found', 'This invite link has expired or was already used.')
      if (password.length < 10) return fail(422, 'validation_error', 'Choose a longer password.', { password: 'Use at least 10 characters.' })
      db.invites.delete(token)
      db.user.password = password
      db.passwordSet = true
      return HttpResponse.json(issueTokens(db))
    }),

    http.post(`${API}/vendor/auth/password/forgot`, () => new HttpResponse(null, { status: 202 })),

    http.get(`${API}/vendor/me`, authed(getDb, () => {
      const db = getDb()
      const { password: _p, ...user } = db.user
      return HttpResponse.json({ vendor: db.vendor, user, role: 'vendor_owner', setup: setupOf(db) } satisfies Schemas['Me'])
    })),

    http.get(`${API}/vendor/summary`, authed(getDb, () => {
      const db = getDb()
      const waiting = reviewItems(db).filter((r) => r.state === 'waiting')
      const oldest = waiting.reduce<number | null>((min, r) => {
        const t = Date.parse(r.submitted_at)
        return min === null || t < min ? t : min
      }, null)
      return HttpResponse.json({
        products: counts(db),
        reviews_waiting: waiting.length,
        oldest_waiting_hours: oldest === null ? null : Math.floor((db.now().getTime() - oldest) / 3_600_000),
        sent_back: db.products.filter((p) => p.status === 'rejected').length,
      } satisfies Schemas['Summary'])
    })),

    http.get(`${API}/vendor/brand-page`, authed(getDb, () => HttpResponse.json(brandPage(getDb())))),

    http.put(`${API}/vendor/brand-page/draft`, authed(getDb, async ({ request }) => {
      const db = getDb()
      if (db.brand.review.state === 'waiting') return fail(409, 'invalid_transition', 'Your brand page is in review. You can edit it again once we have decided.')
      const body = (await request.json()) as Schemas['BrandProfile']
      const fields: Record<string, string> = {}
      if (body.tagline.length > 60) fields.tagline = 'Keep the tagline to 60 characters.'
      if (body.story.length > 600) fields.story = 'Keep the story to 600 characters.'
      if (Object.keys(fields).length) return fail(422, 'validation_error', 'Check the highlighted fields.', fields)
      db.brand.draft = { ...body, brand_name: db.brand.live?.brand_name ?? body.brand_name }
      db.brand.draft_saved_at = iso()
      return HttpResponse.json(brandPage(db))
    })),

    http.delete(`${API}/vendor/brand-page/draft`, authed(getDb, () => {
      const db = getDb()
      db.brand.draft = null
      db.brand.draft_saved_at = null
      return HttpResponse.json(brandPage(db))
    })),

    http.post(`${API}/vendor/brand-page/submit`, authed(getDb, () => {
      const db = getDb()
      if (!db.brand.draft || changedFields(db).length === 0) return fail(422, 'validation_error', 'There are no changes to send for review.')
      if (!db.brand.draft.story.trim()) return fail(422, 'validation_error', 'Check the highlighted fields.', { story: 'Tell shoppers your story before sending it for review.' })
      db.brand.review = { state: 'waiting', at: iso() }
      db.brand.submitted_at = iso()
      return HttpResponse.json(brandPage(db))
    })),

    http.post(`${API}/vendor/uploads/presign`, authed(getDb, async ({ request }) => {
      const db = getDb()
      const { content_type, size_bytes } = (await request.json()) as { purpose: string; content_type: string; size_bytes: number }
      if (!IMAGE_TYPES.includes(content_type)) return fail(415, 'unsupported_media_type', 'Use a JPG, PNG or WebP photo.')
      if (size_bytes > MAX_UPLOAD) return fail(413, 'file_too_large', 'Photos can be up to 10 MB. Export a smaller copy and try again.')
      const key = nextId(db, 'upload')
      return HttpResponse.json({ upload_url: `${new URL(request.url).origin}/mock-uploads/${key}`, key, fields: { key } })
    })),

    // Stands in for Cloudinary: keeps the photo as a data URL so previews show the real image.
    http.post('*/mock-uploads/:key', async ({ request, params }) => {
      let form: FormData | null = null
      try {
        form = await request.formData()
      } catch {
        // Node's fetch cannot parse a jsdom File in tests; the stand-in swatch is used instead.
      }
      const file = form?.get('file')
      let url = swatch(String(params.key))
      if (file instanceof Blob && typeof FileReader !== 'undefined') {
        url = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => resolve(swatch(String(params.key)))
          reader.readAsDataURL(file)
        })
      }
      getDb().uploads.set(String(params.key), url)
      return HttpResponse.json({ key: params.key, secure_url: url })
    }),

    http.get(`${API}/vendor/products`, authed(getDb, ({ request }) => {
      const db = getDb()
      const q = new URL(request.url).searchParams
      const status = q.get('status')
      const text = q.get('q')?.trim().toLowerCase()
      const limit = Math.min(Number(q.get('limit')) || 20, 50)
      const start = Number(q.get('cursor')) || 0
      let list = db.products.filter((p) => (status ? p.status === status : p.status !== 'archived'))
      if (text) list = list.filter((p) => p.title.toLowerCase().includes(text) || p.sku.toLowerCase().includes(text))
      if (q.get('category')) list = list.filter((p) => p.category === q.get('category'))
      if (q.get('gender')) list = list.filter((p) => p.gender === q.get('gender'))
      const stock = q.get('stock')
      const total = (p: ProductRecord) => p.variants.reduce((n, v) => n + v.stock, 0)
      if (stock === 'out') list = list.filter((p) => p.variants.length > 0 && total(p) === 0)
      if (stock === 'low') list = list.filter((p) => total(p) > 0 && total(p) <= 5)
      if (stock === 'in_stock') list = list.filter((p) => total(p) > 5)
      const sort = q.get('sort') ?? 'updated_desc'
      const price = (p: ProductRecord) => p.price_paise ?? Number.MAX_SAFE_INTEGER
      list = [...list].sort((a, b) =>
        sort === 'price_asc' ? price(a) - price(b)
          : sort === 'price_desc' ? price(b) - price(a)
            : sort === 'stock_asc' ? total(a) - total(b)
              : Date.parse(b.updated_at) - Date.parse(a.updated_at))
      const page = list.slice(start, start + limit)
      return HttpResponse.json({
        items: page.map(summaryOf),
        next_cursor: start + limit < list.length ? String(start + limit) : null,
        total: list.length,
        counts: counts(db),
      } satisfies Schemas['ProductPage'])
    })),

    http.post(`${API}/vendor/products`, authed(getDb, async ({ request }) => {
      const db = getDb()
      const input = (await request.json()) as Schemas['ProductInput']
      if (!input.title?.trim()) return fail(422, 'validation_error', 'Check the highlighted fields.', { title: 'Add a title.' })
      const n = db.products.length + 1
      const product: ProductRecord = {
        id: nextId(db, 'p'),
        title: '',
        description: '',
        category: '',
        gender: 'Women',
        fabric: '',
        sku: `KS-NEW-${String(n).padStart(3, '0')}`,
        status: 'draft',
        price_paise: null,
        mrp_paise: null,
        images: [],
        variants: [],
        returns_use_default: true,
        review: { state: 'none' },
        history: [{ at: iso(), event: 'created' }],
        updated_at: iso(),
        edit_in_review: false,
        thumbnail_url: null,
        submitted_at: null,
        decided_at: null,
        publishing: false,
        edit_submitted_at: null,
      }
      applyInput(product, input, iso())
      db.products.unshift(product)
      return HttpResponse.json(productOut(product), { status: 201 })
    })),

    http.post(`${API}/vendor/products/bulk`, authed(getDb, async ({ request }) => {
      const db = getDb()
      const { action, ids } = (await request.json()) as { action: 'submit' | 'archive'; ids: string[] }
      const results = ids.map((id) => {
        const p = findProduct(db, id)
        if (!p) return { id, ok: false, code: 'not_found', message: 'Not found.' }
        if (action === 'archive') {
          p.status = 'archived'
          p.history.unshift({ at: iso(), event: 'archived' })
          return { id, ok: true }
        }
        if (p.status === 'pending_review') return { id, ok: false, code: 'invalid_transition', message: `${p.title} is already in review.` }
        const problems = submitProblems(p)
        if (Object.keys(problems).length) return { id, ok: false, code: 'validation_error', message: `${p.title}: ${Object.values(problems)[0]}` }
        p.status = 'pending_review'
        p.submitted_at = iso()
        p.review = { state: 'waiting', at: iso() }
        p.history.unshift({ at: iso(), event: 'submitted' })
        return { id, ok: true }
      })
      return HttpResponse.json({ results })
    })),

    http.get(`${API}/vendor/products/:id`, authed(getDb, ({ params }) => {
      const p = findProduct(getDb(), params.id)
      return p ? HttpResponse.json(productOut(p)) : fail(404, 'not_found', 'We could not find that product. It may have been archived.')
    })),

    http.patch(`${API}/vendor/products/:id`, authed(getDb, async ({ request, params }) => {
      const db = getDb()
      const p = findProduct(db, params.id)
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      if (p.status === 'pending_review') return fail(409, 'product_not_editable', 'This product is in review. You can edit it again once we have decided.')
      const input = (await request.json()) as Schemas['ProductInput']
      if (input.price_paise != null && input.price_paise <= 0) return fail(422, 'validation_error', 'Check the highlighted fields.', { price_paise: 'Enter a price above ₹0.' })
      applyInput(p, input, iso())
      return HttpResponse.json(productOut(p))
    })),

    http.post(`${API}/vendor/products/:id/submit`, authed(getDb, ({ params }) => {
      const db = getDb()
      const p = findProduct(db, params.id)
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      if (p.status === 'pending_review' || p.edit_in_review) return fail(409, 'invalid_transition', 'This product is already in review.')
      const problems = submitProblems(p)
      if (Object.keys(problems).length) return fail(422, 'validation_error', 'Fix these before sending for review.', problems)
      // An edit to a live product is reviewed while the live version stays up (V-06, V-07).
      if (p.status === 'approved') {
        p.edit_in_review = true
        p.edit_submitted_at = iso()
      } else {
        p.status = 'pending_review'
        p.submitted_at = iso()
        p.review = { state: 'waiting', at: iso() }
      }
      p.history.unshift({ at: iso(), event: 'submitted' })
      p.updated_at = iso()
      return HttpResponse.json(productOut(p))
    })),

    http.post(`${API}/vendor/products/:id/archive`, authed(getDb, ({ params }) => {
      const db = getDb()
      const p = findProduct(db, params.id)
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      p.status = 'archived'
      p.history.unshift({ at: iso(), event: 'archived' })
      return HttpResponse.json(productOut(p))
    })),

    http.post(`${API}/vendor/products/:id/images`, authed(getDb, async ({ request, params }) => {
      const db = getDb()
      const p = findProduct(db, params.id)
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      const { key, angle } = (await request.json()) as { key: string; angle: Schemas['PhotoAngle'] }
      const url = db.uploads.get(key)
      if (!url) return fail(422, 'validation_error', 'That upload did not finish. Try adding the photo again.')
      if (angle !== 'extra') p.images = p.images.filter((i) => i.angle !== angle)
      if (p.images.length >= 8) return fail(422, 'validation_error', 'A product can have up to 8 photos.')
      p.images.push({ id: nextId(db, 'img'), url, angle })
      p.updated_at = iso()
      return HttpResponse.json(productOut(p), { status: 201 })
    })),

    http.delete(`${API}/vendor/products/:id/images/:imageId`, authed(getDb, ({ params }) => {
      const db = getDb()
      const p = findProduct(db, params.id)
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      p.images = p.images.filter((i) => i.id !== params.imageId)
      p.updated_at = iso()
      return HttpResponse.json(productOut(p))
    })),

    http.get(`${API}/vendor/reviews`, authed(getDb, ({ request }) => {
      const db = getDb()
      const q = new URL(request.url).searchParams
      const all = reviewItems(db)
      const state = q.get('state')
      const limit = Math.min(Number(q.get('limit')) || 50, 50)
      const items = (state ? all.filter((r) => r.state === state) : all).slice(0, limit)
      const c = { all: all.length, waiting: 0, rejected: 0, approved: 0 }
      for (const r of all) c[r.state] += 1
      return HttpResponse.json({ items, counts: c } satisfies Schemas['ReviewPage'])
    })),

    http.get(`${API}/vendor/imports/template.csv`, authed(getDb, () => new HttpResponse(IMPORT_TEMPLATE, { headers: { 'Content-Type': 'text/csv' } }))),

    http.post(`${API}/vendor/imports`, authed(getDb, async ({ request }) => {
      const db = getDb()
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof Blob)) return fail(422, 'validation_error', 'Choose a file to upload.')
      const name = 'name' in file ? String(file.name) : 'catalogue.csv'
      if (!/\.(csv|xlsx|xls)$/i.test(name)) return fail(415, 'unsupported_media_type', 'Upload the template as .xlsx or .csv.')
      if (file.size > MAX_UPLOAD) return fail(413, 'file_too_large', 'Files can be up to 10 MB. Split the sheet and upload it in parts.')
      const id = nextId(db, 'imp')
      const job = /\.csv$/i.test(name) ? checkCsv(await file.text(), name, id) : exampleJob(name, id)
      db.imports.set(id, job)
      return HttpResponse.json({ job_id: id }, { status: 202 })
    })),

    http.get(`${API}/vendor/imports/:jobId`, authed(getDb, ({ params }) => {
      const job = getDb().imports.get(String(params.jobId))
      if (!job) return fail(404, 'not_found', 'We could not find that import.')
      const { rows: _rows, ...out } = job
      return HttpResponse.json(out satisfies Schemas['ImportJob'])
    })),

    http.post(`${API}/vendor/imports/:jobId/commit`, authed(getDb, ({ params }) => {
      const db = getDb()
      const job = db.imports.get(String(params.jobId))
      if (!job) return fail(404, 'not_found', 'We could not find that import.')
      if (job.status === 'committed') return fail(409, 'invalid_transition', 'These drafts were already created.')
      const groups = new Map<string, ImportRow[]>()
      for (const row of job.rows) groups.set(row.product_id || row.name, [...(groups.get(row.product_id || row.name) ?? []), row])
      for (const [key, rows] of groups) {
        const first = rows[0]!
        const p: ProductRecord = {
          id: nextId(db, 'p'),
          title: first.name,
          description: first.description,
          category: first.category,
          gender: first.gender,
          fabric: first.fabric,
          sku: key,
          status: 'draft',
          price_paise: first.price_paise,
          mrp_paise: first.mrp_paise,
          images: [],
          variants: rows.map((r) => ({ size: r.size, sku: `${key}-${r.size === 'One size' ? 'OS' : r.size}`, stock: r.stock })),
          returns_use_default: true,
          review: { state: 'none' },
          history: [{ at: iso(), event: 'created', note: `Imported from ${job.file_name}` }],
          updated_at: iso(),
          edit_in_review: false,
          thumbnail_url: null,
          submitted_at: null,
          decided_at: null,
          publishing: false,
          edit_submitted_at: null,
        }
        db.products.unshift(p)
      }
      job.status = 'committed'
      return HttpResponse.json({ created: groups.size })
    })),
  ]
}
