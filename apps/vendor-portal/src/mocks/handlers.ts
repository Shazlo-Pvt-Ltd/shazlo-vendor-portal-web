import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import type { Schemas } from '../api/client'
import { catalogCopy } from '../copy/catalog'
import {
  isColour,
  isGender,
  isNamedAngle,
  isProductType,
  isSize,
  isSizeChartGroup,
  MAX_EXTRA_PHOTOS,
  MAX_OTHER_COLOURS,
  MAX_TRYON_PHOTOS,
  productProblems,
  sizeCode,
} from '../lib/catalog'
import { checkCommissionBps } from '../lib/commission'
import {
  checkApplication,
  checkBrand,
  checkBusiness,
  checkContact,
  checkDelivery,
  checkPayOnDelivery,
  checkPayout,
  checkReturns,
  checkSizeChart,
  maskPayout,
  normaliseBrand,
  normaliseBusiness,
  normaliseContact,
  normaliseDelivery,
  normalisePayOnDelivery,
  normalisePayout,
  normaliseReturns,
  normaliseSizeChart,
  storeDetailsMissing,
  type FieldErrors,
} from '../lib/storeDetails'
import { normalisePhone } from '../lib/validators'
import { nextId, type ImportRow, type MockDb, type ProductRecord, type StoreRecord } from './db'
import { lookupIfsc } from './ifsc'
import { checkCsv, exampleJob, IMPORT_TEMPLATE } from './imports'
import { swatch } from './swatch'

// Mock vendor-api routes, matching openapi/vendor-portal.yaml. `*` matches any origin, so the same
// handlers serve the browser worker and the Node test server. Validation comes from src/lib, so
// the mock answers exactly what the screens check.
const API = '*/api/v1'
const ACCESS_TTL_MS = 15 * 60_000
const MAX_UPLOAD = 10 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const CHECK_FIELDS = 'Check the highlighted fields.'
const pe = catalogCopy.errors.product

type GetDb = () => MockDb

function fail(status: number, code: string, message: string, fields?: Record<string, string>) {
  return HttpResponse.json({ message, extra: fields ? { code, fields } : { code } }, { status })
}

const invalid = (fields: FieldErrors, message = CHECK_FIELDS) => fail(422, 'validation_error', message, fields)
const hasErrors = (fields: FieldErrors) => Object.keys(fields).length > 0

function summaryOf(p: ProductRecord): Schemas['ProductSummary'] {
  return {
    id: p.id,
    title: p.title,
    sku: p.sku,
    category: p.category,
    main_colour: p.main_colour,
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

// ---- store details and commission -----------------------------------------------------------

function storeComplete(db: MockDb): boolean {
  return storeDetailsMissing(db.store).length === 0
}

function storeOut(db: MockDb): Schemas['StoreDetails'] {
  const s = db.store
  const missing = storeDetailsMissing(s)
  const bank = s.payout?.method === 'bank' ? lookupIfsc(s.payout.ifsc) : null
  return {
    brand_name: db.vendor.brand_name,
    sells: s.sells,
    city: s.city,
    instagram_or_website: s.instagram_or_website,
    contact: s.contact,
    delivery: s.delivery,
    returns: s.returns,
    pay_on_delivery: s.pay_on_delivery,
    payout: s.payout ? maskPayout(s.payout, bank?.ok ? bank.bank.bank : 'Bank') : null,
    business: s.business,
    missing,
    complete: missing.length === 0,
    updated_at: s.updated_at,
  }
}

function setupOf(db: MockDb): Schemas['Me']['setup'] {
  return {
    password_set: db.passwordSet,
    brand_page: db.brand.live !== null,
    first_product: db.products.length > 0,
    store_details: storeComplete(db),
    live_products: db.products.filter((p) => p.status === 'approved').length,
    live_target: 10,
  }
}

function meOut(db: MockDb): Schemas['Me'] {
  const { password: _p, ...user } = db.user
  return {
    vendor: { ...db.vendor, commission_bps: db.commission.agreed_bps, commission: db.commission },
    user,
    role: 'vendor_owner',
    setup: setupOf(db),
  }
}

// ---- auth ---------------------------------------------------------------------------------

// As vendor-api: the access token goes in the body, the refresh token only into the cookie.
function startSession(db: MockDb): Schemas['Session'] {
  const access = nextId(db, 'access')
  const refresh = nextId(db, 'refresh')
  db.sessions.access.set(access, db.now().getTime() + ACCESS_TTL_MS)
  db.sessions.refresh.add(refresh)
  db.sessions.cookie = refresh
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000 }
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

// ---- products -----------------------------------------------------------------------------

function findProduct(db: MockDb, id: string | readonly string[] | undefined): ProductRecord | undefined {
  return db.products.find((p) => p.id === id)
}

function newProductCode(db: MockDb): string {
  return `KS-NEW-${String(db.products.length + 1).padStart(3, '0')}`
}

function blankProduct(db: MockDb, now: string): ProductRecord {
  return {
    id: nextId(db, 'p'),
    title: '',
    description: '',
    category: null,
    gender: null,
    material: '',
    main_colour: null,
    other_colours: [],
    sku: newProductCode(db),
    status: 'draft',
    price_paise: null,
    mrp_paise: null,
    images: [],
    variants: [],
    review: { state: 'none' },
    history: [{ at: now, event: 'created' }],
    updated_at: now,
    edit_in_review: false,
    thumbnail_url: null,
    submitted_at: null,
    decided_at: null,
    publishing: false,
    edit_submitted_at: null,
  }
}

// What a PATCH may not save. Missing fields are fine on a draft; submit lists those.
function inputProblems(p: ProductRecord, input: Schemas['ProductInput']): FieldErrors {
  const out: FieldErrors = {}
  if (input.category != null && !isProductType(input.category)) out.category = pe.categoryUnknown
  if (input.gender != null && !isGender(input.gender)) out.gender = pe.genderUnknown
  if (input.main_colour != null && !isColour(input.main_colour)) out.main_colour = pe.colourUnknown(String(input.main_colour))
  if (input.other_colours !== undefined) {
    const others = Array.isArray(input.other_colours) ? input.other_colours : []
    const main = input.main_colour !== undefined ? input.main_colour : p.main_colour
    const unknown = others.find((c) => !isColour(c))
    if (unknown !== undefined) out.other_colours = pe.colourUnknown(String(unknown))
    else if (others.length > MAX_OTHER_COLOURS) out.other_colours = pe.otherColoursMax
    else if (new Set(others).size < others.length || (main && others.includes(main))) out.other_colours = pe.otherColoursRepeat
  }
  if (input.material !== undefined && String(input.material).trim().length > 120) out.material = pe.materialLong
  if (input.price_paise != null && !(Number.isInteger(input.price_paise) && input.price_paise > 0)) out.price_paise = pe.priceZero
  if (input.mrp_paise != null && !(Number.isInteger(input.mrp_paise) && input.mrp_paise > 0)) out.mrp_paise = pe.priceZero
  const badSize = input.variants?.find((v) => !isSize(v.size))
  if (badSize) out.variants = pe.sizeUnknown(String(badSize.size))
  return out
}

function applyInput(p: ProductRecord, input: Schemas['ProductInput'], now: string): void {
  if (input.title !== undefined) p.title = input.title
  if (input.description !== undefined) p.description = input.description
  if (input.category !== undefined) p.category = input.category
  if (input.gender !== undefined) p.gender = input.gender
  if (input.material !== undefined) p.material = String(input.material ?? '').trim()
  if (input.price_paise !== undefined) p.price_paise = input.price_paise
  if (input.mrp_paise !== undefined) p.mrp_paise = input.mrp_paise
  if (input.main_colour !== undefined) {
    p.main_colour = input.main_colour
    // A new main colour drops out of the other colours rather than appearing twice.
    if (input.other_colours === undefined) p.other_colours = p.other_colours.filter((c) => c !== input.main_colour)
  }
  if (input.other_colours !== undefined) p.other_colours = [...input.other_colours]
  if (input.variants) {
    p.variants = input.variants.map((v) => ({ size: v.size, sku: v.sku || sizeCode(p.sku, v.size), stock: Math.max(0, Math.trunc(v.stock)) }))
  }
  p.updated_at = now
}

function sendForReview(p: ProductRecord, now: string): void {
  // An edit to a live product is reviewed while the live version stays up (V-06, V-07).
  if (p.status === 'approved') {
    p.edit_in_review = true
    p.edit_submitted_at = now
  } else {
    p.status = 'pending_review'
    p.submitted_at = now
    p.review = { state: 'waiting', at: now }
  }
  p.history.unshift({ at: now, event: 'submitted' })
}

const locked = () => fail(409, 'product_not_editable', 'This product is in review. You can edit it again once we have decided.')

// Room for one more photo in a slot that holds several (extra, tryon), not counting `except`.
function slotFull(p: ProductRecord, angle: Schemas['PhotoAngle'], except?: string): string | null {
  const used = p.images.filter((i) => i.angle === angle && i.id !== except).length
  if (angle === 'extra' && used >= MAX_EXTRA_PHOTOS) return pe.extraFull
  if (angle === 'tryon' && used >= MAX_TRYON_PHOTOS) return pe.tryonFull
  return null
}

const ANGLES: readonly Schemas['PhotoAngle'][] = ['front', 'back', 'detail', 'worn', 'extra', 'tryon']

// ---- handlers ------------------------------------------------------------------------------

export function createHandlers(getDb: GetDb) {
  const iso = () => getDb().now().toISOString()

  // PUT store-details/{section}: check, normalise, save, answer with the whole StoreDetails.
  function section<T>(path: string, check: (body: unknown) => FieldErrors, save: (store: StoreRecord, body: T) => FieldErrors | void) {
    return http.put(`${API}/vendor/store-details/${path}`, authed(getDb, async ({ request }) => {
      const db = getDb()
      const body = (await request.json()) as T
      const problems = check(body)
      if (hasErrors(problems)) return invalid(problems)
      const late = save(db.store, body)
      if (late && hasErrors(late)) return invalid(late)
      db.store.updated_at = iso()
      return HttpResponse.json(storeOut(db))
    }))
  }

  return [
    http.post(`${API}/public/vendor-applications`, async ({ request }) => {
      const db = getDb()
      const body = (await request.json()) as Schemas['VendorApplication']
      const fields = checkApplication(body)
      const payoutChecked = !Object.keys(fields).some((k) => k.startsWith('payout.'))
      if (payoutChecked && body.payout?.method === 'bank' && !lookupIfsc(body.payout.ifsc).ok) fields['payout.ifsc'] = catalogCopy.errors.payout.ifscUnknown
      if (hasErrors(fields)) return invalid(fields)
      const existing = db.applications.find((a) => a.email.toLowerCase() === body.email.trim().toLowerCase())
      if (existing) return HttpResponse.json({ id: existing.id, status: 'applied' }, { status: 201 })
      const id = nextId(db, 'app')
      const contact = normaliseContact({ name: body.owner_name, phone: body.phone, email: body.email })
      const business = normaliseBusiness({ legal_name: body.legal_name ?? null, gstin: body.gstin ?? null })
      const { legal_name: _legal, gstin: _gstin, instagram_or_website: link, ...rest } = body
      db.applications.push({
        ...rest,
        id,
        brand_name: body.brand_name.trim(),
        city: body.city.trim(),
        ...(link?.trim() ? { instagram_or_website: link.trim() } : {}),
        owner_name: contact.name,
        phone: normalisePhone(body.phone) ?? body.phone,
        email: contact.email,
        delivery: normaliseDelivery(body.delivery),
        returns: normaliseReturns(body.returns),
        pay_on_delivery: normalisePayOnDelivery(body.pay_on_delivery),
        payout: normalisePayout(body.payout),
        ...(business.legal_name ? { legal_name: business.legal_name } : {}),
        ...(business.gstin ? { gstin: business.gstin } : {}),
      })
      return HttpResponse.json({ id, status: 'applied' }, { status: 201 })
    }),

    http.get(`${API}/public/ifsc/:code`, ({ params }) => {
      const found = lookupIfsc(String(params.code))
      if (found.ok) return HttpResponse.json(found.bank satisfies Schemas['IfscBank'])
      return found.reason === 'format'
        ? invalid({ ifsc: catalogCopy.errors.payout.ifscFormat }, catalogCopy.errors.payout.ifscFormat)
        : fail(404, 'not_found', catalogCopy.errors.payout.ifscUnknown)
    }),

    http.post(`${API}/vendor/auth/login`, async ({ request }) => {
      const db = getDb()
      const { identifier, password } = (await request.json()) as { identifier: string; password: string }
      if (identifier.trim().toLowerCase() !== db.user.email || password !== db.user.password || !db.passwordSet) {
        return fail(401, 'unauthenticated', 'That email and password do not match. Check both and try again.')
      }
      return HttpResponse.json(startSession(db))
    }),

    // The cookie works once: each refresh replaces it. A rejected one is cleared, as vendor-api does.
    http.post(`${API}/vendor/auth/refresh`, () => {
      const db = getDb()
      const cookie = db.sessions.cookie
      if (!cookie || !db.sessions.refresh.delete(cookie)) {
        db.sessions.cookie = null
        return fail(401, 'unauthenticated', 'Your session has ended. Sign in again.')
      }
      return HttpResponse.json(startSession(db))
    }),

    http.post(`${API}/vendor/auth/logout`, () => {
      const db = getDb()
      if (db.sessions.cookie) db.sessions.refresh.delete(db.sessions.cookie)
      db.sessions.cookie = null
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
      return HttpResponse.json(startSession(db))
    }),

    http.post(`${API}/vendor/auth/password/forgot`, () => new HttpResponse(null, { status: 202 })),

    http.get(`${API}/vendor/me`, authed(getDb, () => HttpResponse.json(meOut(getDb())))),

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

    http.get(`${API}/vendor/store-details`, authed(getDb, () => HttpResponse.json(storeOut(getDb())))),

    section<Schemas['StoreBrandInput']>('brand', checkBrand, (store, body) => {
      const brand = normaliseBrand(body)
      store.sells = brand.sells
      store.city = brand.city
      store.instagram_or_website = brand.instagram_or_website
    }),
    section<Schemas['Contact']>('contact', checkContact, (store, body) => {
      store.contact = normaliseContact(body)
    }),
    section<Schemas['Delivery']>('delivery', checkDelivery, (store, body) => {
      store.delivery = normaliseDelivery(body)
    }),
    section<Schemas['Returns']>('returns', checkReturns, (store, body) => {
      store.returns = normaliseReturns(body)
    }),
    section<Schemas['PayOnDelivery']>('payment', checkPayOnDelivery, (store, body) => {
      store.pay_on_delivery = normalisePayOnDelivery(body)
    }),
    section<Schemas['PayoutInput']>('payout', checkPayout, (store, body) => {
      if (body.method === 'bank' && !lookupIfsc(body.ifsc).ok) return { ifsc: catalogCopy.errors.payout.ifscUnknown }
      store.payout = normalisePayout(body)
    }),
    section<Schemas['BusinessDetails']>('business', checkBusiness, (store, body) => {
      store.business = normaliseBusiness(body)
    }),

    http.post(`${API}/vendor/commission/proposal`, authed(getDb, async ({ request }) => {
      const db = getDb()
      const { rate_bps } = (await request.json()) as { rate_bps: number }
      const problem = checkCommissionBps(rate_bps)
      if (problem) return invalid({ rate_bps: problem })
      if (rate_bps === db.commission.agreed_bps) return invalid({ rate_bps: catalogCopy.errors.commission.sameAsAgreed })
      // The agreed rate stays in force until Shazlo approves the new one.
      db.commission = { state: 'proposed', agreed_bps: db.commission.agreed_bps, proposed_bps: rate_bps, note: null, updated_at: iso() }
      return HttpResponse.json(db.commission satisfies Schemas['Commission'])
    })),

    http.get(`${API}/vendor/size-charts/:group`, authed(getDb, ({ params }) => {
      const group = String(params.group)
      if (!isSizeChartGroup(group)) return fail(404, 'not_found', 'There is no size chart for that group.')
      const saved = getDb().sizeCharts[group]
      return HttpResponse.json({ group, ...(saved ?? { measurements: {}, photo_url: null, updated_at: null }) } satisfies Schemas['SizeChart'])
    })),

    http.put(`${API}/vendor/size-charts/:group`, authed(getDb, async ({ request, params }) => {
      const db = getDb()
      const group = String(params.group)
      if (!isSizeChartGroup(group)) return fail(404, 'not_found', 'There is no size chart for that group.')
      const body = (await request.json()) as Schemas['SizeChartInput']
      const problems = checkSizeChart(group, body)
      if (hasErrors(problems)) return invalid(problems)
      const measurements = normaliseSizeChart(group, body.measurements ?? {})
      const photo_url = body.photo_url ?? null
      // An empty chart is the same as none saved.
      if (Object.keys(measurements).length === 0 && !photo_url) delete db.sizeCharts[group]
      else db.sizeCharts[group] = { measurements, photo_url, updated_at: iso() }
      const saved = db.sizeCharts[group]
      return HttpResponse.json({ group, ...(saved ?? { measurements: {}, photo_url: null, updated_at: null }) } satisfies Schemas['SizeChart'])
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
      // Products without a price sort last in both price orders.
      const price = (p: ProductRecord, missing: number) => p.price_paise ?? missing
      list = [...list].sort((a, b) =>
        sort === 'price_asc' ? price(a, Number.MAX_SAFE_INTEGER) - price(b, Number.MAX_SAFE_INTEGER)
          : sort === 'price_desc' ? price(b, -1) - price(a, -1)
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
      if (!input.title?.trim()) return invalid({ title: pe.titleRequired })
      const product = blankProduct(db, iso())
      const problems = inputProblems(product, input)
      if (hasErrors(problems)) return invalid(problems)
      applyInput(product, input, iso())
      db.products.unshift(product)
      return HttpResponse.json(productOut(product), { status: 201 })
    })),

    http.post(`${API}/vendor/products/bulk`, authed(getDb, async ({ request }) => {
      const db = getDb()
      const { action, ids } = (await request.json()) as { action: 'submit' | 'archive'; ids: string[] }
      const complete = storeComplete(db)
      const results = ids.map((id) => {
        const p = findProduct(db, id)
        if (!p) return { id, ok: false, code: 'not_found', message: 'Not found.' }
        if (action === 'archive') {
          p.status = 'archived'
          p.history.unshift({ at: iso(), event: 'archived' })
          return { id, ok: true }
        }
        if (p.status === 'pending_review' || p.edit_in_review) return { id, ok: false, code: 'invalid_transition', message: `${p.title} is already in review.` }
        const problems = productProblems(p, { storeDetailsComplete: complete })
        if (hasErrors(problems)) return { id, ok: false, code: 'validation_error', message: `${p.title}: ${Object.values(problems)[0]}` }
        sendForReview(p, iso())
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
      if (p.status === 'pending_review') return locked()
      const input = (await request.json()) as Schemas['ProductInput']
      const problems = inputProblems(p, input)
      if (hasErrors(problems)) return invalid(problems)
      applyInput(p, input, iso())
      return HttpResponse.json(productOut(p))
    })),

    http.post(`${API}/vendor/products/:id/submit`, authed(getDb, ({ params }) => {
      const db = getDb()
      const p = findProduct(db, params.id)
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      if (p.status === 'pending_review' || p.edit_in_review) return fail(409, 'invalid_transition', 'This product is already in review.')
      const problems = productProblems(p, { storeDetailsComplete: storeComplete(db) })
      if (hasErrors(problems)) return invalid(problems, catalogCopy.errors.product.submitProblems)
      sendForReview(p, iso())
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
      if (p.status === 'pending_review') return locked()
      const { key, angle } = (await request.json()) as { key: string; angle: Schemas['PhotoAngle'] }
      if (!ANGLES.includes(angle)) return invalid({ angle: 'Choose where this photo goes.' })
      const url = db.uploads.get(key)
      if (!url) return fail(422, 'validation_error', 'That upload did not finish. Try adding the photo again.')
      // A named slot holds one photo, so a new one replaces it.
      if (isNamedAngle(angle)) p.images = p.images.filter((i) => i.angle !== angle)
      const full = slotFull(p, angle)
      if (full) return invalid({ [angle === 'tryon' ? 'tryon' : 'photos']: full }, full)
      p.images.push({ id: nextId(db, 'img'), url, angle })
      p.thumbnail_url = p.images.find((i) => i.angle === 'front')?.url ?? null
      p.updated_at = iso()
      return HttpResponse.json(productOut(p), { status: 201 })
    })),

    http.patch(`${API}/vendor/products/:id/images/:imageId`, authed(getDb, async ({ request, params }) => {
      const db = getDb()
      const p = findProduct(db, params.id)
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      if (p.status === 'pending_review') return locked()
      const image = p.images.find((i) => i.id === params.imageId)
      if (!image) return fail(404, 'not_found', 'We could not find that photo. It may have been removed.')
      const { angle } = (await request.json()) as { angle: Schemas['PhotoAngle'] }
      if (!ANGLES.includes(angle)) return invalid({ angle: 'Choose where this photo goes.' })
      if (angle !== image.angle) {
        const taken = isNamedAngle(angle) ? p.images.find((i) => i.angle === angle) : undefined
        if (taken) {
          // Swap: the photo in the target slot takes this photo's old place.
          taken.angle = image.angle
        } else {
          const full = slotFull(p, angle, image.id)
          if (full) return invalid({ [angle === 'tryon' ? 'tryon' : 'photos']: full }, full)
        }
        image.angle = angle
        p.thumbnail_url = p.images.find((i) => i.angle === 'front')?.url ?? null
        p.updated_at = iso()
      }
      return HttpResponse.json(productOut(p))
    })),

    http.delete(`${API}/vendor/products/:id/images/:imageId`, authed(getDb, ({ params }) => {
      const db = getDb()
      const p = findProduct(db, params.id)
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      if (p.status === 'pending_review') return locked()
      p.images = p.images.filter((i) => i.id !== params.imageId)
      p.thumbnail_url = p.images.find((i) => i.angle === 'front')?.url ?? null
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
      if (job.status !== 'ready') return fail(409, 'invalid_transition', 'This file could not be read. Fix it and upload it again.')
      const created = job.rows.map((row: ImportRow) => {
        const p = blankProduct(db, iso())
        Object.assign(p, {
          title: row.name,
          description: row.description,
          category: row.category,
          gender: row.gender,
          material: row.material,
          main_colour: row.main_colour,
          other_colours: row.other_colours,
          price_paise: row.price_paise,
          mrp_paise: row.mrp_paise,
          variants: row.variants.map((v) => ({ size: v.size, sku: sizeCode(p.sku, v.size), stock: v.stock })),
          history: [{ at: iso(), event: 'created', note: `Imported from ${job.file_name}` }],
        } satisfies Partial<ProductRecord>)
        db.products.unshift(p)
        return { id: p.id, title: p.title }
      })
      job.status = 'committed'
      return HttpResponse.json({ created: created.length, products: created } satisfies Schemas['ImportCommit'])
    })),
  ]
}

