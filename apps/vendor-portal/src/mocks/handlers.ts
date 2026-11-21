import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import type {
  ApiPhotoAngle,
  ApiSizeChartGroup,
  AssetOut,
  BrandProfileOut,
  CommissionOut,
  DraftOut,
  ImportReportOut,
  MeOut,
  ProductOut,
  ProductPageOut,
  RevisionOut,
  SessionOut,
  SignResponse,
  SizeChartOut,
  StoreDetailsOut,
  SubmissionPageOut,
  UserOut,
  VendorSummaryOut,
} from '../api/wire'
import { catalogCopy } from '../copy/catalog'
import {
  isColour,
  isSize,
  isSizeChartGroup,
  MAX_EXTRA_PHOTOS,
  MAX_OTHER_COLOURS,
  MAX_TRYON_PHOTOS,
  NAMED_PHOTO_ANGLES,
  productProblems,
  sizeCode,
  type SubmitRequirement,
} from '../lib/catalog'
import { checkCommissionBps } from '../lib/commission'
import {
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
import {
  ACCESS_TTL_SECONDS,
  CLOUD_NAME,
  emptyStore,
  nextId,
  nextToken,
  NOT_SET,
  type BrandContent,
  type BrandVersion,
  type ContentRecord,
  type MockDb,
  type ProductRecord,
  type RevisionRecord,
  type StoreRecord,
  type UserRecord,
  type VendorRecord,
} from './db'
import { lookupIfsc } from './ifsc'
import { checkCsv, IMPORT_TEMPLATE } from './imports'
import { swatch } from './swatch'

// Mock vendor-api: the real `/v1` routes (services/vendor-api/openapi.json) and the proposed ones
// (openapi/proposed.yaml), answering as vendor-api does: `{error: {code, message, request_id,
// details}}` with an `X-Request-ID`, pydantic-style 422 details, a 15-minute access token and a
// refresh token in an emulated HttpOnly cookie. `*` matches any origin, so the same handlers serve
// the browser demo and the Node tests. Checks come from src/lib, so the mock answers exactly what
// the screens check.

type GetDb = () => MockDb
type Params = Record<string, string | readonly string[] | undefined>

const UPLOAD_ORIGIN = 'https://api.cloudinary.com'
const CLOUDINARY_CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }
const MAX_UPLOAD = 10 * 1024 * 1024
// vendor-api's defaults (settings.import_max_bytes, import_max_rows).
const MAX_IMPORT_BYTES = 2 * 1024 * 1024
const MAX_IMPORT_ROWS = 1000
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[0-9][0-9 ()-]{5,29}[0-9]$/
const pe = catalogCopy.errors.product

// ---- answers -------------------------------------------------------------------------------------

function requestId(db: MockDb): string {
  return nextToken(db, 'req')
}

function json(db: MockDb, body: unknown, status = 200): Response {
  return HttpResponse.json(body as never, { status, headers: { 'X-Request-ID': requestId(db) } })
}

function fail(db: MockDb, status: number, code: string, message: string, details?: unknown, headers: Record<string, string> = {}): Response {
  const id = requestId(db)
  return HttpResponse.json(
    { error: { code, message, request_id: id, ...(details !== undefined ? { details } : {}) } },
    { status, headers: { 'X-Request-ID': id, ...headers } },
  )
}

/** A 422 as FastAPI words it: one `details` item per field, `loc` starting with where it was sent. */
function invalid(db: MockDb, fields: FieldErrors, options: { code?: string; message?: string; prefix?: string[]; type?: string } = {}): Response {
  const prefix = options.prefix ?? ['body']
  const details = Object.entries(fields).map(([key, msg]) => ({ loc: [...prefix, ...(key ? key.split('.') : [])], msg, type: options.type ?? 'value_error' }))
  return fail(db, 422, options.code ?? 'validation_error', options.message ?? 'Request validation failed', details)
}

const noContent = (db: MockDb) => new HttpResponse(null, { status: 204, headers: { 'X-Request-ID': requestId(db) } })
const hasErrors = (fields: FieldErrors) => Object.keys(fields).length > 0
const param = (params: Params, name: string) => String(params[name] ?? '')

async function readJson(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
  try {
    const body: unknown = JSON.parse(await request.text())
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? { ok: true, body: body as Record<string, unknown> } : { ok: false }
  } catch {
    return { ok: false }
  }
}

const badJson = (db: MockDb) => invalid(db, { '': 'Input should be a valid dictionary or object' }, { type: 'model_attributes_type' })

/** Fields a model with `additionalProperties: false` does not take. */
function extraFields(body: Record<string, unknown>, allowed: readonly string[]): FieldErrors {
  const out: FieldErrors = {}
  for (const key of Object.keys(body)) if (!allowed.includes(key)) out[key] = 'Extra inputs are not permitted'
  return out
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const isIntIn = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max

// ---- shapes --------------------------------------------------------------------------------------

function vendorOf(db: MockDb, user: UserRecord): VendorRecord {
  return db.vendors.find((v) => v.id === user.vendor_id)!
}

function commissionOf(db: MockDb, vendorId: string): CommissionOut {
  return db.commissions.get(vendorId) ?? NOT_SET
}

function vendorSummary(db: MockDb, vendor: VendorRecord): VendorSummaryOut {
  return { id: vendor.id, name: vendor.name, slug: vendor.slug, status: vendor.status, commission: commissionOf(db, vendor.id) }
}

const profileOf = (user: UserRecord) => ({ id: user.id, email: user.email, role: user.role, last_login_at: user.last_login_at })

function userOut(user: UserRecord): UserOut {
  return { id: user.id, email: user.email, role: user.role, status: user.status, last_login_at: user.last_login_at, created_at: user.created_at }
}

function storeOf(db: MockDb, vendorId: string): StoreRecord {
  let store = db.stores.get(vendorId)
  if (!store) {
    store = emptyStore()
    db.stores.set(vendorId, store)
  }
  return store
}

const SECTION_OF_TOPIC = { brand: 'brand', contact: 'contact', delivery: 'delivery', returns: 'returns', pay_on_delivery: 'payment', payout: 'payout' } as const

function storeMissing(store: StoreRecord) {
  return storeDetailsMissing({
    sells: store.sells,
    city: store.city,
    instagram_or_website: store.instagram_or_website,
    contact: store.contact,
    delivery: store.delivery,
    returns: store.returns,
    pay_on_delivery: store.payment,
    payout: store.payout,
  }).map((topic) => SECTION_OF_TOPIC[topic])
}

function storeOut(db: MockDb, vendor: VendorRecord): StoreDetailsOut {
  const s = storeOf(db, vendor.id)
  const missing = storeMissing(s)
  const bank = s.payout?.method === 'bank' ? lookupIfsc(s.payout.ifsc) : null
  return {
    brand: { brand_name: vendor.name, sells: s.sells, city: s.city, instagram_or_website: s.instagram_or_website },
    contact: s.contact,
    delivery: s.delivery,
    returns: s.returns,
    payment: s.payment,
    payout: s.payout ? maskPayout(s.payout, bank?.ok ? bank.bank.bank : 'Bank') : null,
    business: s.business,
    missing,
    complete: missing.length === 0,
    version: s.version,
    updated_at: s.updated_at,
  }
}

function assetUrl(db: MockDb, assetId: string | null): string | null {
  return assetId ? (db.assets.get(assetId)?.url ?? null) : null
}

function revisionOut(db: MockDb, r: RevisionRecord | null): RevisionOut | null {
  if (!r) return null
  const c = r.content
  return {
    id: r.id,
    version: r.version,
    state: r.state,
    title: c.title,
    description: c.description,
    category: c.category,
    subcategory: c.subcategory,
    gender: c.gender,
    fabric: c.fabric,
    weight_grams: c.weight_grams,
    returnable: c.returnable,
    return_window_days: c.return_window_days,
    main_colour: c.main_colour,
    other_colours: c.other_colours,
    variants: c.variants.map((v) => ({ ...v })),
    images: c.images.map((i, index) => ({ asset_id: i.asset_id, url: assetUrl(db, i.asset_id) ?? '', position: index + 1, alt_text: i.alt_text, angle: i.angle })),
    submitted_at: r.submitted_at,
    review: r.review,
    updated_at: r.updated_at,
  }
}

function productOut(db: MockDb, p: ProductRecord): ProductOut {
  return { id: p.id, sku: p.sku, status: p.status, version: p.version, created_at: p.created_at, updated_at: p.updated_at, live: revisionOut(db, p.live), working: revisionOut(db, p.working) }
}

function brandVersions(db: MockDb, vendorId: string): BrandVersion[] {
  let versions = db.brands.get(vendorId)
  if (!versions) {
    versions = []
    db.brands.set(vendorId, versions)
  }
  return versions
}

function brandOut(db: MockDb, vendorId: string, v: BrandVersion): BrandProfileOut {
  const review = db.submissions
    .filter((s) => s.vendor_id === vendorId && s.subject === 'brand_profile' && s.version === v.version)
    .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at))[0]
  return {
    id: v.id,
    version: v.version,
    state: v.state,
    ...v.content,
    logo_url: assetUrl(db, v.content.logo_asset_id),
    banner_url: assetUrl(db, v.content.banner_asset_id),
    submitted_at: v.submitted_at,
    published_at: v.published_at,
    review: review ? { status: review.status, reason: review.reason, decided_at: review.decided_at, submitted_at: review.submitted_at } : null,
    updated_at: v.updated_at,
  }
}

function sizeChartOut(db: MockDb, vendorId: string, group: ApiSizeChartGroup): SizeChartOut {
  const saved = db.sizeCharts.get(vendorId)?.[group]
  return {
    group,
    measurements: saved?.measurements ?? {},
    photo_asset_id: saved?.photo_asset_id ?? null,
    photo_url: assetUrl(db, saved?.photo_asset_id ?? null),
    version: saved?.version ?? 0,
    updated_at: saved?.updated_at ?? null,
  }
}

// ---- sessions ------------------------------------------------------------------------------------

function startSession(db: MockDb, user: UserRecord, { login }: { login: boolean }): SessionOut {
  const now = db.now()
  const access = nextToken(db, 'at')
  db.sessions.access.set(access, { userId: user.id, expires: now.getTime() + ACCESS_TTL_SECONDS * 1000 })
  const refresh = nextToken(db, 'rt')
  db.sessions.refresh.set(refresh, user.id)
  db.cookie.vendor_refresh = refresh
  if (login) user.last_login_at = now.toISOString()
  return { access_token: access, expires_in: ACCESS_TTL_SECONDS, token_type: 'Bearer', user: profileOf(user), vendor: vendorSummary(db, vendorOf(db, user)) }
}

const SIGN_IN_STATUSES = new Set(['pending', 'approved'])

interface AuthInfo {
  db: MockDb
  request: Request
  params: Params
  user: UserRecord
  vendor: VendorRecord
}

type Fault = MockDb['faults'][number]

function takeFault(db: MockDb, request: Request): Fault | undefined {
  const path = new URL(request.url).pathname
  const index = db.faults.findIndex((f) => path.endsWith(f.path) && (!f.method || f.method.toUpperCase() === request.method))
  if (index === -1) return undefined
  return db.faults.splice(index, 1)[0]
}

function faultResponse(db: MockDb, fault: Fault): Response {
  if (fault.network) return HttpResponse.error()
  return fail(db, fault.status ?? 500, fault.code ?? 'internal_error', fault.message ?? 'Something went wrong on our side.', fault.details)
}

// ---- products ------------------------------------------------------------------------------------

const CONTENT_FIELDS = ['title', 'category', 'gender', 'subcategory', 'description', 'fabric', 'weight_grams', 'returnable', 'return_window_days', 'main_colour', 'other_colours', 'variants', 'images'] as const
const VARIANT_FIELDS = ['sku', 'size', 'color', 'is_active', 'price_paise', 'mrp_paise', 'stock']
const PHOTO_ANGLES: readonly ApiPhotoAngle[] = ['front', 'back', 'detail', 'worn', 'extra', 'tryon']

/** Checks a content body as pydantic and the service would; on success, the record to save. */
function readContent(db: MockDb, vendor: VendorRecord, body: Record<string, unknown>, product: { sku: string; existing: ContentRecord['variants'] }, extra: readonly string[] = []): { ok: true; content: ContentRecord } | { ok: false; fields: FieldErrors; code?: string; message?: string } {
  const fields = extraFields(body, [...CONTENT_FIELDS, ...extra])
  const title = str(body.title)
  if (typeof body.title !== 'string') fields.title = 'Field required'
  else if (title.length < 1) fields.title = 'String should have at least 1 character'
  else if (title.length > 200) fields.title = 'String should have at most 200 characters'
  const nullableText = (key: string, max: number) => {
    const value = body[key]
    if (value === undefined || value === null) return null
    if (typeof value !== 'string') {
      fields[key] = 'Input should be a valid string'
      return null
    }
    if (value.length > max) fields[key] = `String should have at most ${max} characters`
    return value.trim() === '' ? null : value.trim()
  }
  const category = nullableText('category', 100)
  const subcategory = nullableText('subcategory', 100)
  const description = nullableText('description', 4000)
  const fabric = nullableText('fabric', 80)
  let gender: ContentRecord['gender'] = null
  if (body.gender !== undefined && body.gender !== null) {
    if (body.gender === 'women' || body.gender === 'men' || body.gender === 'unisex') gender = body.gender
    else fields.gender = "Input should be 'women', 'men' or 'unisex'"
  }
  let main: string | null = null
  if (body.main_colour !== undefined && body.main_colour !== null) {
    if (isColour(body.main_colour)) main = body.main_colour
    else fields.main_colour = pe.colourUnknown(String(body.main_colour))
  }
  let others: string[] = []
  if (body.other_colours !== undefined) {
    const list = Array.isArray(body.other_colours) ? body.other_colours : []
    const unknown = list.find((c) => !isColour(c))
    if (!Array.isArray(body.other_colours)) fields.other_colours = 'Input should be a valid list'
    else if (unknown !== undefined) fields.other_colours = pe.colourUnknown(String(unknown))
    else if (list.length > MAX_OTHER_COLOURS) fields.other_colours = pe.otherColoursMax
    else if (new Set(list).size < list.length || (main !== null && list.includes(main))) fields.other_colours = pe.otherColoursRepeat
    else others = list as string[]
  }
  const weight = body.weight_grams
  if (weight !== undefined && weight !== null && !isIntIn(weight, 1, 1_000_000)) fields.weight_grams = 'Input should be greater than 0'
  const window = body.return_window_days
  if (window !== undefined && window !== null && !isIntIn(window, 0, 30)) fields.return_window_days = 'Input should be less than or equal to 30'

  const variants: ContentRecord['variants'] = []
  const rawVariants = body.variants === undefined ? [] : body.variants
  if (!Array.isArray(rawVariants)) fields.variants = 'Input should be a valid list'
  else if (rawVariants.length > 100) fields.variants = 'List should have at most 100 items'
  else {
    const seenSizes = new Set<string>()
    rawVariants.forEach((raw, i) => {
      const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
      Object.assign(fields, Object.fromEntries(Object.entries(extraFields(v, VARIANT_FIELDS)).map(([k, m]) => [`variants.${i}.${k}`, m])))
      const size = typeof v.size === 'string' ? v.size : ''
      if (!isSize(size)) fields[`variants.${i}.size`] = pe.sizeUnknown(size)
      else if (seenSizes.has(size)) fields[`variants.${i}.size`] = `${size} is listed twice.`
      seenSizes.add(size)
      if (v.stock !== undefined && !isIntIn(v.stock, 0, 1_000_000)) fields[`variants.${i}.stock`] = 'Input should be a whole number of 0 or more'
      for (const key of ['price_paise', 'mrp_paise'] as const) {
        if (v[key] !== undefined && v[key] !== null && !isIntIn(v[key], 1, 1_000_000_000_000)) fields[`variants.${i}.${key}`] = pe.priceZero
      }
      const sku = typeof v.sku === 'string' && v.sku.trim() ? v.sku.trim() : sizeCode(product.sku, size)
      const same = product.existing.find((e) => e.sku.toLowerCase() === sku.toLowerCase())
      if (same && same.size !== size) fields[`variants.${i}.sku`] = `Variant ${same.sku} is ${same.size}; a size cannot change. Use a new code for a different size`
      variants.push({
        id: same?.id ?? nextId(db),
        sku,
        size,
        color: typeof v.color === 'string' ? v.color : '',
        price_paise: (v.price_paise as number | null | undefined) ?? null,
        mrp_paise: (v.mrp_paise as number | null | undefined) ?? null,
        is_active: v.is_active !== false,
        stock: Number(v.stock) || 0,
      })
    })
  }

  const images: ContentRecord['images'] = []
  const rawImages = body.images === undefined ? [] : body.images
  if (!Array.isArray(rawImages)) fields.images = 'Input should be a valid list'
  else if (rawImages.length > 13) fields.images = 'List should have at most 13 items'
  else {
    let assetProblem = false
    for (const [i, raw] of rawImages.entries()) {
      const image = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
      const angle = image.angle === undefined ? 'extra' : image.angle
      if (!PHOTO_ANGLES.includes(angle as ApiPhotoAngle)) {
        fields[`images.${i}.angle`] = "Input should be 'front', 'back', 'detail', 'worn', 'extra' or 'tryon'"
        continue
      }
      const asset = typeof image.asset_id === 'string' ? db.assets.get(image.asset_id) : undefined
      if (!asset || asset.vendor_id !== vendor.id || asset.kind !== 'product_image' || asset.status !== 'ready') assetProblem = true
      images.push({ asset_id: String(image.asset_id), alt_text: typeof image.alt_text === 'string' ? image.alt_text : null, angle: angle as ApiPhotoAngle })
    }
    if (assetProblem) return { ok: false, fields: {}, code: 'invalid_asset', message: 'Every image must be one of your uploaded product images' }
    for (const named of NAMED_PHOTO_ANGLES) if (images.filter((i) => i.angle === named).length > 1) fields.images = `Only one ${named} photo.`
    if (images.filter((i) => i.angle === 'extra').length > MAX_EXTRA_PHOTOS) fields.images = pe.extraFull
    if (images.filter((i) => i.angle === 'tryon').length > MAX_TRYON_PHOTOS) fields.images = pe.tryonFull
  }

  if (hasErrors(fields)) return { ok: false, fields }
  return {
    ok: true,
    content: {
      title,
      description,
      category,
      subcategory,
      gender,
      fabric,
      weight_grams: (weight as number | null | undefined) ?? null,
      returnable: body.returnable === true,
      return_window_days: (window as number | null | undefined) ?? null,
      main_colour: main,
      other_colours: others,
      variants,
      images,
    },
  }
}

/** Every missing requirement, as the proposal's `422 product_incomplete` lists them. */
function submitProblems(content: ContentRecord, storeComplete: boolean): [string, string][] {
  const active = content.variants.filter((v) => v.is_active)
  // The portal's own submit check (src/lib/catalog.ts), so the mock refuses exactly what the editor
  // warns about. It only asks whether gender and product type are there, not which they are.
  const problems = productProblems(
    {
      title: content.title,
      gender: content.gender === null ? null : 'Women',
      category: content.category === null ? null : 'Kurtas',
      main_colour: content.main_colour,
      material: content.fabric ?? '',
      description: content.description ?? '',
      images: content.images.map((i) => ({ id: i.asset_id, url: '', angle: i.angle })),
      variants: active.map((v) => ({ size: v.size, sku: v.sku, stock: v.stock })),
      price_paise: active.find((v) => v.price_paise)?.price_paise ?? null,
      mrp_paise: active.find((v) => v.price_paise)?.mrp_paise ?? null,
    },
    { storeDetailsComplete: storeComplete },
  )
  const API_KEY: Record<SubmitRequirement, string> = {
    title: 'title', gender: 'gender', category: 'category', main_colour: 'main_colour', material: 'fabric', description: 'description',
    photos: 'photos', tryon: 'tryon_photos', variants: 'variants', price_paise: 'price_paise', store_details: 'store_details',
  }
  return Object.entries(problems).map(([key, message]) => [API_KEY[key as SubmitRequirement], message])
}

/** A list row from the revision being edited or reviewed, else the live one (as vendor-api does). */
function productSummary(db: MockDb, p: ProductRecord) {
  const latest = p.working ?? p.live
  const row = {
    id: p.id,
    sku: p.sku,
    status: p.status,
    version: p.version,
    title: latest?.content.title ?? '',
    category: latest?.content.category ?? '',
    has_pending_changes: p.live !== null && p.working !== null,
    updated_at: p.updated_at,
  }
  const active = latest?.content.variants.filter((v) => v.is_active) ?? []
  const priced = active.find((v) => v.price_paise !== null)
  const images = latest?.content.images ?? []
  const front = images.find((i) => i.angle === 'front') ?? images[0]
  return {
    ...row,
    price_paise: priced?.price_paise ?? null,
    mrp_paise: priced?.mrp_paise ?? null,
    stock: active.length > 0 ? active.reduce((sum, v) => sum + v.stock, 0) : null,
    thumbnail_url: front ? assetUrl(db, front.asset_id) : null,
    main_colour: latest?.content.main_colour ?? null,
    gender: latest?.content.gender ?? null,
    working_state: p.working?.state ?? null,
  }
}

const PRODUCT_SORTS = ['updated_desc', 'price_asc', 'price_desc', 'stock_asc'] as const

// ---- brand page ----------------------------------------------------------------------------------

const BRAND_FIELDS = ['brand_name', 'tagline', 'about', 'logo_asset_id', 'banner_asset_id', 'website_url', 'instagram_handle', 'categories', 'price_min_paise', 'price_max_paise', 'based_in']
const HANDLE = /^[A-Za-z0-9._]{1,30}$/

function readBrand(db: MockDb, vendor: VendorRecord, body: Record<string, unknown>, current: BrandContent): { ok: true; content: BrandContent } | { ok: false; fields: FieldErrors; code?: string; message?: string } {
  const fields = extraFields(body, BRAND_FIELDS)
  const name = str(body.brand_name)
  if (!name) fields.brand_name = 'String should have at least 1 character'
  else if (name.length > 120) fields.brand_name = 'String should have at most 120 characters'
  const text = (key: string, max: number): string | null => {
    const v = body[key]
    if (v === undefined || v === null) return null
    if (typeof v !== 'string') {
      fields[key] = 'Input should be a valid string'
      return null
    }
    if (v.length > max) fields[key] = `String should have at most ${max} characters`
    return v.trim() || null
  }
  const tagline = text('tagline', 160)
  const about = text('about', 4000)
  const basedIn = text('based_in', 120)
  const website = text('website_url', 500)
  if (website && !/^https:\/\/\S+$/.test(website)) fields.website_url = 'Value error, must be an https:// address without spaces'
  const handle = text('instagram_handle', 31)
  if (handle && !HANDLE.test(handle)) fields.instagram_handle = 'Value error, use 1 to 30 letters, digits, dots or underscores'
  const categories = Array.isArray(body.categories) ? body.categories.filter((c): c is string => typeof c === 'string').map((c) => c.trim()) : []
  if (body.categories !== undefined && !Array.isArray(body.categories)) fields.categories = 'Input should be a valid list'
  else if (categories.length > 20) fields.categories = 'List should have at most 20 items'
  const price = (key: 'price_min_paise' | 'price_max_paise') => {
    const v = body[key]
    if (v === undefined) return current[key]
    if (!isIntIn(v, 0, 1_000_000_000_000)) fields[key] = 'Input should be a whole number of 0 or more'
    return Number(v) || 0
  }
  const min = price('price_min_paise')
  const max = price('price_max_paise')
  if (max < min) fields.price_max_paise = 'Value error, price_max_paise must not be below price_min_paise'
  for (const [key, kind] of [['logo_asset_id', 'brand_logo'], ['banner_asset_id', 'brand_banner']] as const) {
    const id = body[key]
    if (id === undefined || id === null) continue
    const asset = typeof id === 'string' ? db.assets.get(id) : undefined
    if (!asset || asset.vendor_id !== vendor.id || asset.kind !== kind || asset.status !== 'ready') {
      return { ok: false, fields: {}, code: 'invalid_asset', message: `${key} must be one of your uploaded ${kind} images` }
    }
  }
  if (hasErrors(fields)) return { ok: false, fields }
  return {
    ok: true,
    content: {
      brand_name: name,
      based_in: basedIn,
      tagline,
      about,
      logo_asset_id: (body.logo_asset_id as string | null | undefined) ?? null,
      banner_asset_id: (body.banner_asset_id as string | null | undefined) ?? null,
      website_url: website,
      instagram_handle: handle,
      categories,
      price_min_paise: min,
      price_max_paise: max,
    },
  }
}

function ensureDraft(db: MockDb, vendor: VendorRecord): BrandVersion {
  const versions = brandVersions(db, vendor.id)
  const draft = versions.find((v) => v.state === 'draft')
  if (draft) return draft
  const latest = [...versions].sort((a, b) => b.version - a.version)[0]
  const store = storeOf(db, vendor.id)
  const content: BrandContent = latest
    ? structuredClone(latest.content)
    : { brand_name: vendor.name, based_in: store.city, tagline: null, about: null, logo_asset_id: null, banner_asset_id: null, website_url: null, instagram_handle: null, categories: [], price_min_paise: 0, price_max_paise: 0 }
  const made: BrandVersion = { id: nextId(db), version: (latest?.version ?? 0) + 1, state: 'draft', content, submitted_at: null, published_at: null, updated_at: db.now().toISOString() }
  versions.push(made)
  return made
}

function draftOut(db: MockDb, vendor: VendorRecord, draft: BrandVersion): DraftOut {
  const inReview = brandVersions(db, vendor.id).find((v) => v.state === 'pending_review')
  return { ...brandOut(db, vendor.id, draft), in_review_version: inReview?.version ?? null }
}

// ---- passwords -----------------------------------------------------------------------------------

/** vendor-api's password rule, in short: 12 (its `password_min_length` default) to 128 characters. */
function weakPassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 12) return 'Use at least 12 characters.'
  if (password.length > 128) return 'Use at most 128 characters.'
  return null
}

// ---- handlers ------------------------------------------------------------------------------------

export function createHandlers(getDb: GetDb, { base = '*' }: { base?: string } = {}) {
  const at = (path: string) => `${base}${path}`
  const iso = () => getDb().now().toISOString()

  /** Any route: forced faults first. */
  const open = (resolver: (info: { db: MockDb; request: Request; params: Params; cookies: Record<string, string> }) => Response | Promise<Response>): HttpResponseResolver =>
    async ({ request, params, cookies }) => {
      const db = getDb()
      const fault = takeFault(db, request)
      if (fault) return faultResponse(db, fault)
      return resolver({ db, request, params: params as Params, cookies })
    }

  /** A route that needs the access token, like vendor-api's `Current` dependency. */
  const authed = (resolver: (info: AuthInfo) => Response | Promise<Response>, { owner = false }: { owner?: boolean } = {}): HttpResponseResolver =>
    open(({ db, request, params }) => {
      const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1]
      const session = token ? db.sessions.access.get(token) : undefined
      const user = session ? db.users.find((u) => u.id === session.userId) : undefined
      if (!session || session.expires <= db.now().getTime() || !user || user.status !== 'active') {
        return fail(db, 401, 'unauthorized', 'Missing or invalid access token', undefined, { 'WWW-Authenticate': 'Bearer' })
      }
      const vendor = vendorOf(db, user)
      if (!SIGN_IN_STATUSES.has(vendor.status)) return fail(db, 403, 'vendor_not_allowed', 'This vendor account cannot use the API. Contact support')
      if (owner && user.role !== 'owner') return fail(db, 403, 'forbidden', 'Your role does not allow this')
      return resolver({ db, request, params, user, vendor })
    })

  /** One `PUT /v1/vendor/store-details/{section}`: check, normalise, save, answer with every section. */
  const section = (name: string, check: (body: unknown) => FieldErrors, save: (store: StoreRecord, body: never) => FieldErrors | void) =>
    http.put(at(`/v1/vendor/store-details/${name}`), authed(async ({ db, request, vendor }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const problems = check(read.body)
      if (hasErrors(problems)) return invalid(db, problems)
      const store = storeOf(db, vendor.id)
      const late = save(store, read.body as never)
      if (late && hasErrors(late)) return invalid(db, late)
      store.version += 1
      store.updated_at = iso()
      return json(db, storeOut(db, vendor))
    }))

  function findProduct(db: MockDb, vendor: VendorRecord, id: string): ProductRecord | undefined {
    return db.products.find((p) => p.id === id && p.vendor_id === vendor.id)
  }

  return [
    // ---- auth ----------------------------------------------------------------------------------
    http.post(at('/v1/auth/login'), open(async ({ db, request }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const fields: FieldErrors = { ...extraFields(read.body, ['email', 'password']) }
      if (typeof read.body.email !== 'string' || read.body.email.length < 3) fields.email = 'String should have at least 3 characters'
      if (typeof read.body.password !== 'string' || read.body.password.length < 1) fields.password = 'String should have at least 1 character'
      if (hasErrors(fields)) return invalid(db, fields)
      const email = str(read.body.email).toLowerCase()
      const user = db.users.find((u) => u.email.toLowerCase() === email)
      if (!user || user.password === null || user.password !== read.body.password || user.status !== 'active' || !user.verified) {
        return fail(db, 401, 'invalid_credentials', 'Invalid email or password')
      }
      if (!SIGN_IN_STATUSES.has(vendorOf(db, user).status)) return fail(db, 403, 'vendor_not_allowed', 'This vendor account cannot sign in. Contact support')
      return json(db, startSession(db, user, { login: true }))
    })),

    http.post(at('/v1/auth/refresh'), open(({ db, cookies }) => {
      const token = cookies.vendor_refresh || db.cookie.vendor_refresh
      const userId = token ? db.sessions.refresh.get(token) : undefined
      const user = userId ? db.users.find((u) => u.id === userId) : undefined
      if (!token || !user || user.status !== 'active') {
        db.cookie.vendor_refresh = null
        return fail(db, 401, 'invalid_refresh_token', 'Invalid or expired refresh token')
      }
      if (!SIGN_IN_STATUSES.has(vendorOf(db, user).status)) return fail(db, 403, 'vendor_not_allowed', 'This vendor account cannot sign in. Contact support')
      db.sessions.refresh.delete(token)
      return json(db, startSession(db, user, { login: false }))
    })),

    http.post(at('/v1/auth/logout'), open(({ db, cookies }) => {
      const token = cookies.vendor_refresh || db.cookie.vendor_refresh
      if (token) db.sessions.refresh.delete(token)
      db.cookie.vendor_refresh = null
      return noContent(db)
    })),

    http.post(at('/v1/auth/signup'), open(async ({ db, request }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const b = read.body
      const fields = extraFields(b, ['brand_name', 'contact_name', 'email', 'phone', 'password', 'terms_accepted', 'website_or_instagram', 'product_type', 'price_min_paise', 'price_max_paise', 'sells', 'city', 'store_details', 'proposed_commission_bps', 'price_rule_accepted'])
      if (!str(b.brand_name) || str(b.brand_name).length > 200) fields.brand_name = catalogCopy.errors.brand.storeNameRequired
      if (!str(b.contact_name)) fields.contact_name = catalogCopy.errors.contact.nameRequired
      if (!EMAIL.test(str(b.email))) fields.email = catalogCopy.errors.contact.emailFormat
      if (!PHONE.test(str(b.phone))) fields.phone = catalogCopy.errors.contact.phoneFormat
      if (typeof b.password !== 'string' || b.password.length < 1) fields.password = 'String should have at least 1 character'
      if (typeof b.terms_accepted !== 'boolean') fields.terms_accepted = 'Input should be a valid boolean'
      if (typeof b.price_rule_accepted !== 'boolean') fields.price_rule_accepted = 'Input should be a valid boolean'
      Object.assign(fields, checkBrand({ sells: b.sells, city: b.city, instagram_or_website: b.website_or_instagram }))
      if (b.proposed_commission_bps !== undefined && b.proposed_commission_bps !== null) {
        const problem = checkCommissionBps(b.proposed_commission_bps)
        if (problem) fields.proposed_commission_bps = problem
      }
      const details = (typeof b.store_details === 'object' && b.store_details !== null ? b.store_details : {}) as Record<string, unknown>
      const sectionChecks: [string, (v: unknown) => FieldErrors][] = [['delivery', checkDelivery], ['returns', checkReturns], ['payment', checkPayOnDelivery], ['payout', checkPayout], ['business', checkBusiness]]
      for (const [name, check] of sectionChecks) {
        if (details[name] === undefined) continue
        for (const [key, message] of Object.entries(check(details[name]))) fields[`store_details.${name}.${key === 'pay_on_delivery' ? '' : key}`.replace(/\.$/, '')] = message
      }
      if (details.payout && typeof details.payout === 'object' && (details.payout as { method?: unknown }).method === 'bank' && !fields['store_details.payout.ifsc'] && !lookupIfsc(String((details.payout as { ifsc?: unknown }).ifsc ?? '')).ok) {
        fields['store_details.payout.ifsc'] = catalogCopy.errors.payout.ifscUnknown
      }
      if (hasErrors(fields)) return invalid(db, fields)
      if (b.terms_accepted !== true) return fail(db, 422, 'terms_not_accepted', 'Accept the terms to sign up')
      if (b.price_rule_accepted !== true) return fail(db, 422, 'price_rule_not_accepted', 'Agree to the price rule to sign up')
      const weak = weakPassword(b.password)
      if (weak) return fail(db, 422, 'weak_password', weak)

      const message = { message: 'Check your email for a link to verify your address.', status: 'accepted' }
      const email = str(b.email).toLowerCase()
      if (db.users.some((u) => u.email.toLowerCase() === email)) {
        db.emails.push({ to: email, kind: 'exists', token: null })
        return json(db, message, 202)
      }
      const now = iso()
      const name = str(b.brand_name)
      const vendor: VendorRecord = { id: nextId(db), name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), status: 'pending', created_at: now }
      const owner: UserRecord = { id: nextId(db), vendor_id: vendor.id, email, password: String(b.password), role: 'owner', status: 'active', verified: false, last_login_at: null, created_at: now }
      db.vendors.push(vendor)
      db.users.push(owner)
      const store = emptyStore()
      const brand = normaliseBrand({ sells: b.sells as never, city: String(b.city), instagram_or_website: (b.website_or_instagram as string | null | undefined) ?? null })
      Object.assign(store, { sells: brand.sells, city: brand.city, instagram_or_website: brand.instagram_or_website })
      store.contact = normaliseContact({ name: String(b.contact_name), phone: String(b.phone), email })
      if (details.delivery) store.delivery = normaliseDelivery(details.delivery as never)
      if (details.returns) store.returns = normaliseReturns(details.returns as never)
      if (details.payment) store.payment = normalisePayOnDelivery(details.payment as never)
      if (details.payout) store.payout = normalisePayout(details.payout as never)
      if (details.business) store.business = normaliseBusiness(details.business as never)
      store.version = 1
      store.updated_at = now
      db.stores.set(vendor.id, store)
      const bps = b.proposed_commission_bps
      db.commissions.set(vendor.id, typeof bps === 'number' ? { state: 'proposed', agreed_bps: null, proposed_bps: bps, note: null } : NOT_SET)
      const token = nextToken(db, 'verify')
      db.tokens.set(token, { kind: 'verify', userId: owner.id })
      db.emails.push({ to: email, kind: 'verify', token })
      return json(db, message, 202)
    })),

    http.post(at('/v1/auth/verify-email'), open(async ({ db, request }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const token = typeof read.body.token === 'string' ? read.body.token : ''
      const found = db.tokens.get(token)
      if (!found || found.kind !== 'verify') return fail(db, 400, 'invalid_token', 'This link is not valid any more. Ask for a new one.')
      db.tokens.delete(token)
      const user = db.users.find((u) => u.id === found.userId)
      if (user) user.verified = true
      return noContent(db)
    })),

    http.post(at('/v1/auth/resend-verification'), open(async ({ db, request }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const email = str(read.body.email).toLowerCase()
      if (!EMAIL.test(email)) return invalid(db, { email: 'value is not a valid email address' })
      const user = db.users.find((u) => u.email.toLowerCase() === email && !u.verified && u.status === 'active')
      if (user) {
        const token = nextToken(db, 'verify')
        db.tokens.set(token, { kind: 'verify', userId: user.id })
        db.emails.push({ to: email, kind: 'verify', token })
      }
      return json(db, { message: 'If that address needs verifying, a new link is on its way.', status: 'accepted' }, 202)
    })),

    http.post(at('/v1/auth/forgot-password'), open(async ({ db, request }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const email = str(read.body.email).toLowerCase()
      if (!EMAIL.test(email)) return invalid(db, { email: 'value is not a valid email address' })
      const user = db.users.find((u) => u.email.toLowerCase() === email && u.status === 'active')
      if (user) {
        const token = nextToken(db, 'reset')
        db.tokens.set(token, { kind: 'reset', userId: user.id })
        db.emails.push({ to: email, kind: 'reset', token })
      }
      return json(db, { message: 'If that address has an account, a reset link is on its way.', status: 'accepted' }, 202)
    })),

    http.post(at('/v1/auth/set-password'), open(async ({ db, request }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const token = typeof read.body.token === 'string' ? read.body.token : ''
      const found = db.tokens.get(token)
      if (!found || found.kind === 'verify') return fail(db, 400, 'invalid_token', 'This link is not valid any more. Ask for a new one.')
      const weak = weakPassword(read.body.password)
      if (weak) return fail(db, 422, 'weak_password', weak)
      const user = db.users.find((u) => u.id === found.userId)
      if (!user) return fail(db, 400, 'invalid_token', 'This link is not valid any more. Ask for a new one.')
      db.tokens.delete(token)
      user.password = String(read.body.password)
      user.verified = true
      if (user.status === 'invited') user.status = 'active'
      // A new password ends every session of the user.
      for (const [refresh, id] of db.sessions.refresh) if (id === user.id) db.sessions.refresh.delete(refresh)
      return noContent(db)
    })),

    http.post(at('/v1/auth/change-password'), authed(async ({ db, request, user }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      if (read.body.current_password !== user.password) return fail(db, 400, 'invalid_current_password', 'The current password is wrong')
      const weak = weakPassword(read.body.new_password)
      if (weak) return fail(db, 422, 'weak_password', weak)
      user.password = String(read.body.new_password)
      for (const [refresh, id] of db.sessions.refresh) if (id === user.id) db.sessions.refresh.delete(refresh)
      return json(db, startSession(db, user, { login: false }))
    })),

    // ---- me, commission, store details ---------------------------------------------------------
    http.get(at('/v1/vendor/me'), authed(({ db, user, vendor }) => json(db, { user: profileOf(user), vendor: vendorSummary(db, vendor) } satisfies MeOut))),

    http.post(at('/v1/vendor/commission/proposal'), authed(async ({ db, request, vendor }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const rate = read.body.rate_bps
      const problem = checkCommissionBps(rate)
      if (problem) return invalid(db, { rate_bps: problem })
      const current = commissionOf(db, vendor.id)
      if (rate === current.agreed_bps) return invalid(db, { rate_bps: catalogCopy.errors.commission.sameAsAgreed })
      // The agreed rate stays in force until Shazlo approves the new one.
      const next: CommissionOut = { state: 'proposed', agreed_bps: current.agreed_bps, proposed_bps: rate as number, note: null }
      db.commissions.set(vendor.id, next)
      return json(db, next)
    })),

    http.get(at('/v1/vendor/store-details'), authed(({ db, vendor }) => json(db, storeOut(db, vendor)))),
    section('brand', checkBrand, (store, body: { sells: 'women'; city: string; instagram_or_website: string | null }) => {
      const brand = normaliseBrand(body)
      Object.assign(store, { sells: brand.sells, city: brand.city, instagram_or_website: brand.instagram_or_website })
    }),
    section('contact', checkContact, (store, body: never) => {
      store.contact = normaliseContact(body)
    }),
    section('delivery', checkDelivery, (store, body: never) => {
      store.delivery = normaliseDelivery(body)
    }),
    section('returns', checkReturns, (store, body: never) => {
      store.returns = normaliseReturns(body)
    }),
    section('payment', checkPayOnDelivery, (store, body: never) => {
      store.payment = normalisePayOnDelivery(body)
    }),
    section('payout', checkPayout, (store, body: { method: 'bank'; ifsc: string } | { method: 'upi' }) => {
      if (body.method === 'bank' && !lookupIfsc(body.ifsc).ok) return { ifsc: catalogCopy.errors.payout.ifscUnknown }
      store.payout = normalisePayout(body as never)
    }),
    section('business', checkBusiness, (store, body: never) => {
      store.business = normaliseBusiness(body)
    }),

    http.get(at('/v1/public/ifsc/:code'), open(({ db, params }) => {
      const found = lookupIfsc(param(params, 'code'))
      if (found.ok) return json(db, found.bank)
      return found.reason === 'format'
        ? invalid(db, { code: catalogCopy.errors.payout.ifscFormat }, { prefix: ['path'] })
        : fail(db, 404, 'ifsc_not_found', catalogCopy.errors.payout.ifscUnknown)
    })),

    // ---- size charts ---------------------------------------------------------------------------
    http.get(at('/v1/vendor/size-charts/:group'), authed(({ db, params, vendor }) => {
      const group = param(params, 'group')
      if (!isSizeChartGroup(group)) return fail(db, 404, 'not_found', 'There is no size chart for that group.')
      return json(db, sizeChartOut(db, vendor.id, group))
    })),
    http.put(at('/v1/vendor/size-charts/:group'), authed(async ({ db, request, params, vendor }) => {
      const group = param(params, 'group')
      if (!isSizeChartGroup(group)) return fail(db, 404, 'not_found', 'There is no size chart for that group.')
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const fields = { ...extraFields(read.body, ['measurements', 'photo_asset_id']), ...checkSizeChart(group, { measurements: read.body.measurements }) }
      const photo = read.body.photo_asset_id ?? null
      if (photo !== null) {
        const asset = typeof photo === 'string' ? db.assets.get(photo) : undefined
        if (!asset || asset.vendor_id !== vendor.id || asset.status !== 'ready') fields.photo_asset_id = 'Use a photo you uploaded.'
      }
      if (hasErrors(fields)) return invalid(db, fields)
      const charts = db.sizeCharts.get(vendor.id) ?? {}
      db.sizeCharts.set(vendor.id, charts)
      const measurements = normaliseSizeChart(group, (read.body.measurements ?? {}) as never)
      const previous = charts[group]
      // An empty chart is the same as none saved.
      if (Object.keys(measurements).length === 0 && photo === null) delete charts[group]
      else charts[group] = { measurements, photo_asset_id: photo as string | null, version: (previous?.version ?? 0) + 1, updated_at: iso() }
      return json(db, sizeChartOut(db, vendor.id, group))
    })),

    // ---- brand page ----------------------------------------------------------------------------
    http.get(at('/v1/vendor/brand-profile'), authed(({ db, vendor }) => json(db, draftOut(db, vendor, ensureDraft(db, vendor))))),
    http.put(at('/v1/vendor/brand-profile'), authed(async ({ db, request, vendor }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const draft = ensureDraft(db, vendor)
      const checked = readBrand(db, vendor, read.body, draft.content)
      if (!checked.ok) return checked.code ? fail(db, 422, checked.code, checked.message ?? '') : invalid(db, checked.fields)
      draft.content = checked.content
      draft.updated_at = iso()
      return json(db, draftOut(db, vendor, draft))
    })),
    http.get(at('/v1/vendor/brand-profile/published'), authed(({ db, vendor }) => {
      const published = brandVersions(db, vendor.id).find((v) => v.state === 'published')
      return published ? json(db, brandOut(db, vendor.id, published)) : fail(db, 404, 'no_published_profile', 'No brand profile has been approved yet')
    })),
    http.post(at('/v1/vendor/brand-profile/submit'), authed(({ db, vendor }) => {
      const versions = brandVersions(db, vendor.id)
      const draft = versions.find((v) => v.state === 'draft')
      if (!draft) return fail(db, 409, 'nothing_to_submit', 'There is no draft to submit')
      if (versions.some((v) => v.state === 'pending_review')) {
        return fail(db, 409, 'review_pending', 'A version of the brand profile is already in review. You can keep editing the draft, but submit it after that review is decided')
      }
      if (draft.content.categories.length === 0) return fail(db, 422, 'profile_incomplete', 'Add at least one category before you submit')
      const now = iso()
      draft.state = 'pending_review'
      draft.submitted_at = now
      draft.updated_at = now
      db.submissions.push({ id: nextId(db), vendor_id: vendor.id, subject: 'brand_profile', product_id: null, sku: null, title: null, version: draft.version, status: 'pending', reason: null, submitted_at: now, decided_at: null })
      return json(db, brandOut(db, vendor.id, draft))
    })),

    // ---- uploads (sign → Cloudinary → register) -------------------------------------------------
    http.post(at('/v1/vendor/assets/sign'), authed(async ({ db, request, vendor }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const fields = extraFields(read.body, ['kind', 'content_type', 'size_bytes'])
      const kind = read.body.kind
      if (kind !== 'brand_logo' && kind !== 'brand_banner' && kind !== 'product_image') fields.kind = "Input should be 'brand_logo', 'brand_banner' or 'product_image'"
      if (!IMAGE_TYPES.includes(read.body.content_type as never)) fields.content_type = "Input should be 'image/jpeg', 'image/png' or 'image/webp'"
      if (!isIntIn(read.body.size_bytes, 1, 1_099_511_627_776)) fields.size_bytes = 'Input should be greater than 0'
      if (hasErrors(fields)) return invalid(db, fields)
      if ((read.body.size_bytes as number) > MAX_UPLOAD) return fail(db, 422, 'invalid_upload', 'The image is larger than 10 MB')
      const id = nextId(db)
      const publicId = `shazlo/vendors/${vendor.id}/${String(kind)}/${id}`
      db.assets.set(id, { id, vendor_id: vendor.id, kind: kind as never, public_id: publicId, url: '', status: 'pending', bytes: null, format: null, width: null, height: null, created_at: iso() })
      const signed: SignResponse = {
        asset_id: id,
        public_id: publicId,
        upload_url: `${UPLOAD_ORIGIN}/v1_1/${CLOUD_NAME}/image/upload`,
        fields: { api_key: '000000000000000', timestamp: String(Math.floor(db.now().getTime() / 1000)), signature: nextToken(db, 'sig'), public_id: publicId, overwrite: 'false', allowed_formats: 'jpg,jpeg,png,webp' },
        expires_at: new Date(db.now().getTime() + 3_600_000).toISOString(),
        max_bytes: MAX_UPLOAD,
        allowed_content_types: [...IMAGE_TYPES],
      }
      return json(db, signed, 201)
    })),

    // Stands in for Cloudinary, which answers the browser's CORS preflight (an upload with progress
    // events is always preflighted) and allows any origin.
    http.options(`${UPLOAD_ORIGIN}/v1_1/:cloud/image/upload`, () => new HttpResponse(null, { status: 204, headers: CLOUDINARY_CORS })),

    // Keeps the file as a blob: URL so previews show the real image.
    http.post(`${UPLOAD_ORIGIN}/v1_1/:cloud/image/upload`, open(async ({ db, request }) => {
      const raw = request.clone()
      let publicId: string
      let file: unknown = null
      try {
        const form = await request.formData()
        publicId = String(form.get('public_id') ?? '')
        file = form.get('file')
      } catch {
        // Some test runtimes cannot parse a jsdom File; read the public id from the raw body.
        const text = await raw.text().catch(() => '')
        publicId = /name="public_id"\r?\n\r?\n([^\r\n]+)/.exec(text)?.[1] ?? ''
      }
      if (!publicId) return HttpResponse.json({ error: { message: 'Missing required parameter - public_id' } }, { status: 400, headers: CLOUDINARY_CORS })
      const blob = file instanceof Blob && file.size > 0 ? file : null
      const url = blob ? URL.createObjectURL(blob) : swatch(publicId, 'front')
      const format = blob?.type.replace('image/', '').replace('jpeg', 'jpg') || 'jpg'
      db.uploads.set(publicId, { url, bytes: blob?.size ?? 48_000, format })
      return HttpResponse.json({ public_id: publicId, secure_url: url, bytes: blob?.size ?? 48_000, format }, { headers: CLOUDINARY_CORS })
    })),

    http.post(at('/v1/vendor/assets'), authed(async ({ db, request, vendor }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const publicId = typeof read.body.public_id === 'string' ? read.body.public_id : ''
      const asset = [...db.assets.values()].find((a) => a.public_id === publicId && a.vendor_id === vendor.id)
      if (!asset) return fail(db, 404, 'upload_not_found', 'There is no upload with that id')
      const uploaded = db.uploads.get(publicId)
      if (!uploaded) return fail(db, 409, 'upload_pending', 'The image host has not received the file yet')
      Object.assign(asset, { status: 'ready', url: uploaded.url, bytes: uploaded.bytes, format: uploaded.format, width: 1200, height: 1500 })
      const { vendor_id: _vendor, ...out } = asset
      return json(db, out satisfies AssetOut, 201)
    })),

    // ---- products ------------------------------------------------------------------------------
    http.get(at('/v1/vendor/products'), authed(({ db, request, vendor }) => {
      const url = new URL(request.url)
      const status = url.searchParams.get('status')
      const category = url.searchParams.get('category')?.trim().toLowerCase()
      const q = url.searchParams.get('q')?.trim().toLowerCase()
      const limit = Number(url.searchParams.get('limit') ?? 25)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const problems: FieldErrors = {}
      if (status !== null && !['draft', 'pending_review', 'approved', 'rejected', 'archived'].includes(status)) problems.status = "Input should be 'draft', 'pending_review', 'approved', 'rejected' or 'archived'"
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) problems.limit = 'Input should be between 1 and 100'
      if (!Number.isInteger(offset) || offset < 0) problems.offset = 'Input should be 0 or more'
      // The proposed filters and sorts; vendor-api today ignores unknown query parameters.
      const proposed = db.proposals.productSummaries
      const gender = proposed ? url.searchParams.get('gender') : null
      const inStock = proposed ? url.searchParams.get('in_stock') : null
      const sort = (proposed ? url.searchParams.get('sort') : null) ?? 'updated_desc'
      if (gender !== null && !['women', 'men', 'unisex'].includes(gender)) problems.gender = "Input should be 'women', 'men' or 'unisex'"
      if (inStock !== null && !['true', 'false'].includes(inStock)) problems.in_stock = 'Input should be a valid boolean'
      if (!(PRODUCT_SORTS as readonly string[]).includes(sort)) problems.sort = "Input should be 'updated_desc', 'price_asc', 'price_desc' or 'stock_asc'"
      if (hasErrors(problems)) return invalid(db, problems, { prefix: ['query'] })
      const price = (s: { price_paise: number | null }, missing: number) => s.price_paise ?? missing
      const matching = db.products
        .filter((p) => p.vendor_id === vendor.id)
        .filter((p) => (status ? p.status === status : p.status !== 'archived'))
        .map((p) => productSummary(db, p))
        .filter((s) => !category || s.category.toLowerCase() === category)
        .filter((s) => !q || s.title.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q))
        .filter((s) => gender === null || s.gender === gender)
        .filter((s) => inStock === null || (inStock === 'true' ? (s.stock ?? 0) > 0 : s.stock === 0))
        .sort((a, b) =>
          sort === 'price_asc' ? price(a, Number.MAX_SAFE_INTEGER) - price(b, Number.MAX_SAFE_INTEGER)
            : sort === 'price_desc' ? price(b, -1) - price(a, -1)
              : sort === 'stock_asc' ? (a.stock ?? 0) - (b.stock ?? 0)
                : Date.parse(b.updated_at) - Date.parse(a.updated_at))
      const rows = proposed
        ? matching
        : matching.map(({ price_paise: _p, mrp_paise: _m, stock: _s, thumbnail_url: _t, main_colour: _c, gender: _g, working_state: _w, ...today }) => today)
      return json(db, { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset } satisfies ProductPageOut)
    })),

    http.post(at('/v1/vendor/products'), authed(async ({ db, request, vendor }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const given = typeof read.body.sku === 'string' && read.body.sku.trim() ? read.body.sku.trim() : null
      if (read.body.sku !== undefined && given === null) return invalid(db, { sku: 'String should have at least 1 character' })
      const sku = given ?? `P-${nextToken(db, 'c').slice(2, 10).toUpperCase()}`
      if (db.products.some((p) => p.vendor_id === vendor.id && p.sku.toLowerCase() === sku.toLowerCase())) return fail(db, 409, 'sku_taken', 'You already use this SKU (SKUs ignore letter case)')
      const { sku: _sku, ...content } = read.body
      const checked = readContent(db, vendor, content, { sku, existing: [] })
      if (!checked.ok) return checked.code ? fail(db, 422, checked.code, checked.message ?? '') : invalid(db, checked.fields)
      const now = iso()
      const product: ProductRecord = {
        id: nextId(db),
        vendor_id: vendor.id,
        sku,
        status: 'draft',
        version: 1,
        created_at: now,
        updated_at: now,
        live: null,
        working: { id: nextId(db), version: 1, state: 'editing', content: checked.content, submitted_at: null, review: null, updated_at: now },
        ever_submitted: false,
      }
      db.products.push(product)
      return json(db, productOut(db, product), 201)
    })),

    http.get(at('/v1/vendor/products/:product_id'), authed(({ db, params, vendor }) => {
      const product = findProduct(db, vendor, param(params, 'product_id'))
      return product ? json(db, productOut(db, product)) : fail(db, 404, 'product_not_found', 'Product not found')
    })),

    http.put(at('/v1/vendor/products/:product_id'), authed(async ({ db, request, params, vendor }) => {
      const product = findProduct(db, vendor, param(params, 'product_id'))
      if (!product) return fail(db, 404, 'product_not_found', 'Product not found')
      if (product.status === 'archived') return fail(db, 409, 'product_archived', 'This product is archived')
      if (product.working?.state === 'in_review') return fail(db, 409, 'product_in_review', 'This product has a version in review. Wait for the decision before changing it')
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const { version: expected, ...body } = read.body
      if (expected !== undefined && !isIntIn(expected, 1, Number.MAX_SAFE_INTEGER)) return invalid(db, { version: 'Input should be greater than or equal to 1' })
      if (db.proposals.productVersions && expected !== undefined && expected !== product.version) {
        return fail(db, 409, 'version_conflict', 'This product changed after you opened it. Nothing was saved; open it again to see the change.')
      }
      const existing = [...(product.live?.content.variants ?? []), ...(product.working?.content.variants ?? [])]
      const checked = readContent(db, vendor, body, { sku: product.sku, existing })
      if (!checked.ok) return checked.code ? fail(db, 422, checked.code, checked.message ?? '') : invalid(db, checked.fields)
      const now = iso()
      if (product.working?.state === 'editing') {
        product.working.content = checked.content
        product.working.updated_at = now
      } else {
        const version = Math.max(product.live?.version ?? 0, product.working?.version ?? 0) + 1
        product.working = { id: nextId(db), version, state: 'editing', content: checked.content, submitted_at: null, review: null, updated_at: now }
        // A rejected product is being reworked.
        if (!product.live) product.status = 'draft'
      }
      product.version += 1
      product.updated_at = now
      return json(db, productOut(db, product))
    })),

    http.delete(at('/v1/vendor/products/:product_id'), authed(({ db, params, vendor }) => {
      const product = findProduct(db, vendor, param(params, 'product_id'))
      if (!product) return fail(db, 404, 'product_not_found', 'Product not found')
      if (product.status === 'archived') return noContent(db)
      if (product.working?.state === 'in_review') return fail(db, 409, 'product_in_review', 'This product has a version in review. Wait for the decision before changing it')
      if (!product.ever_submitted) {
        db.products = db.products.filter((p) => p.id !== product.id)
      } else {
        if (product.working?.state === 'editing') product.working = null
        product.version += 1
        product.status = 'archived'
        product.updated_at = iso()
      }
      return noContent(db)
    })),

    http.post(at('/v1/vendor/products/:product_id/submit'), authed(({ db, params, vendor }) => {
      const product = findProduct(db, vendor, param(params, 'product_id'))
      if (!product) return fail(db, 404, 'product_not_found', 'Product not found')
      if (product.status === 'archived') return fail(db, 409, 'product_archived', 'This product is archived')
      if (product.working?.state === 'in_review') return fail(db, 409, 'product_in_review', 'This product has a version in review. Wait for the decision before changing it')
      const revision = product.working?.state === 'editing' ? product.working : null
      if (!revision) return fail(db, 409, 'nothing_to_submit', 'There are no unsubmitted changes to send for review')
      const missing = submitProblems(revision.content, storeMissing(storeOf(db, vendor.id)).length === 0)
      if (missing.length > 0) {
        return fail(db, 422, 'product_incomplete', 'Finish the product before sending it for review', missing.map(([key, msg]) => ({ loc: [key], msg, type: 'missing' })))
      }
      const now = iso()
      revision.state = 'in_review'
      revision.submitted_at = now
      revision.review = { status: 'pending', reason: null, decided_at: null }
      product.ever_submitted = true
      product.version += 1
      if (!product.live) product.status = 'pending_review'
      product.updated_at = now
      db.submissions.push({ id: nextId(db), vendor_id: vendor.id, subject: 'product', product_id: product.id, sku: product.sku, title: revision.content.title, version: revision.version, status: 'pending', reason: null, submitted_at: now, decided_at: null })
      return json(db, productOut(db, product))
    })),

    // ---- bulk import ---------------------------------------------------------------------------
    http.get(at('/v1/vendor/products/import/template'), authed(({ db, request }) => {
      const format = new URL(request.url).searchParams.get('format') ?? 'xlsx'
      if (format !== 'csv') return fail(db, 422, 'unsupported_format', 'The demo has the CSV template only. Ask for format=csv.')
      return new HttpResponse(IMPORT_TEMPLATE, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="shazlo-products-template.csv"', 'X-Request-ID': requestId(db) } })
    })),

    http.post(at('/v1/vendor/products/import'), authed(async ({ db, request, vendor }) => {
      const mode = new URL(request.url).searchParams.get('mode') ?? 'import'
      if (!['validate', 'import', 'all_or_nothing'].includes(mode)) return invalid(db, { mode: "Input should be 'validate', 'import' or 'all_or_nothing'" }, { prefix: ['query'] })
      const type = (request.headers.get('Content-Type') ?? '').split(';')[0]!.trim()
      if (type !== 'text/csv' && type !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return fail(db, 415, 'unsupported_media_type', 'Upload a .csv or .xlsx file')
      const bytes = await request.arrayBuffer()
      if (bytes.byteLength > MAX_IMPORT_BYTES) return fail(db, 413, 'file_too_large', `The file is larger than ${MAX_IMPORT_BYTES / 1024} KB. Split it in parts`)
      if (type !== 'text/csv') return fail(db, 422, 'invalid_file', 'The demo reads .csv files only. Save the sheet as CSV and try again.')
      const text = new TextDecoder().decode(bytes)
      if (!text.trim()) return fail(db, 422, 'invalid_file', 'The file is empty')
      const sheet = checkCsv(text)
      if (sheet.rowsRead > MAX_IMPORT_ROWS) return fail(db, 422, 'too_many_rows', `The file has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files and import each one`)
      if (sheet.rowsRead === 0 && sheet.problems.length > 0) {
        const missing = sheet.problems.map((p) => p.column).filter(Boolean)
        return fail(db, 422, 'missing_columns', `The file has no column named ${missing.join(', ')}`)
      }
      const rejected = new Set(sheet.problems.map((p) => p.row))
      const existing = new Set(db.products.filter((p) => p.vendor_id === vendor.id).map((p) => (p.working ?? p.live)?.content.title.toLowerCase()))
      const write = mode === 'import' || (mode === 'all_or_nothing' && sheet.problems.length === 0)
      const now = iso()
      const products: ImportReportOut['products'] = []
      for (const row of sheet.rows) {
        const code = `P-${nextToken(db, 'c').slice(2, 10).toUpperCase()}`
        if (existing.has(row.name.toLowerCase())) {
          products.push({ product_id: null, sku: code, rows: [row.row], status: 'unchanged' })
          continue
        }
        if (!write) {
          products.push({ product_id: null, sku: code, rows: [row.row], status: 'valid' })
          continue
        }
        const id = nextId(db)
        db.products.push({
          id,
          vendor_id: vendor.id,
          sku: code,
          status: 'draft',
          version: 1,
          created_at: now,
          updated_at: now,
          live: null,
          working: {
            id: nextId(db),
            version: 1,
            state: 'editing',
            content: {
              title: row.name,
              description: row.description,
              category: row.category.toLowerCase(),
              subcategory: null,
              gender: row.gender.toLowerCase() as 'women',
              fabric: row.material,
              weight_grams: null,
              returnable: false,
              return_window_days: null,
              main_colour: row.main_colour,
              other_colours: row.other_colours,
              variants: row.variants.map((v) => ({ id: nextId(db), sku: sizeCode(code, v.size), size: v.size, color: '', price_paise: row.price_paise, mrp_paise: row.mrp_paise, is_active: true, stock: v.stock })),
              images: [],
            },
            submitted_at: null,
            review: null,
            updated_at: now,
          },
          ever_submitted: false,
        })
        products.push({ product_id: id, sku: code, rows: [row.row], status: 'created' })
      }
      for (const row of rejected) products.push({ product_id: null, sku: '', rows: [row], status: 'rejected' })
      const count = (status: string) => products.filter((p) => p.status === status).length
      const report: ImportReportOut = {
        mode,
        file_format: 'csv',
        committed: write && count('created') > 0,
        summary: { products: products.length, created: count('created'), unchanged: count('unchanged'), valid: count('valid'), rejected: count('rejected'), rows_read: sheet.rowsRead, rows_with_errors: rejected.size },
        ignored_columns: sheet.ignored,
        products,
        errors: sheet.problems.map((p) => ({ row: p.row, column: p.column, code: p.code, message: p.message })),
        errors_truncated: false,
      }
      return json(db, report)
    })),

    // ---- review decisions ----------------------------------------------------------------------
    http.get(at('/v1/vendor/submissions'), authed(({ db, request, vendor }) => {
      const url = new URL(request.url)
      const status = url.searchParams.get('status') ?? 'all'
      const subject = url.searchParams.get('subject')
      const limit = Number(url.searchParams.get('limit') ?? 25)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      if (!['pending', 'approved', 'rejected', 'withdrawn', 'all'].includes(status)) return invalid(db, { status: "Input should be 'pending', 'approved', 'rejected', 'withdrawn' or 'all'" }, { prefix: ['query'] })
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return invalid(db, { limit: 'Input should be between 1 and 100' }, { prefix: ['query'] })
      const matching = db.submissions
        .filter((s) => s.vendor_id === vendor.id)
        .filter((s) => status === 'all' || s.status === status)
        .filter((s) => !subject || s.subject === subject)
        .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at))
      const items = matching
        .slice(offset, offset + limit)
        .map(({ vendor_id: _v, product_id, ...s }) => (db.proposals.submissionProductIds ? { ...s, product_id } : s))
      return json(db, { items, total: matching.length, limit, offset } satisfies SubmissionPageOut)
    })),

    // ---- team ----------------------------------------------------------------------------------
    http.get(at('/v1/vendor/users'), authed(({ db, vendor }) => json(db, db.users.filter((u) => u.vendor_id === vendor.id).map(userOut)), { owner: true })),

    http.post(at('/v1/vendor/users'), authed(async ({ db, request, vendor }) => {
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      const email = str(read.body.email).toLowerCase()
      if (!EMAIL.test(email)) return invalid(db, { email: 'value is not a valid email address' })
      const message = { message: 'If that address can be invited, an invitation is on its way.', status: 'accepted' }
      if (db.users.some((u) => u.email.toLowerCase() === email)) return json(db, message, 202)
      const user: UserRecord = { id: nextId(db), vendor_id: vendor.id, email, password: null, role: 'staff', status: 'invited', verified: false, last_login_at: null, created_at: iso() }
      db.users.push(user)
      const token = nextToken(db, 'invite')
      db.tokens.set(token, { kind: 'invite', userId: user.id })
      db.emails.push({ to: email, kind: 'invite', token })
      return json(db, message, 202)
    }, { owner: true })),

    http.patch(at('/v1/vendor/users/:user_id'), authed(async ({ db, request, params, user, vendor }) => {
      const target = db.users.find((u) => u.id === param(params, 'user_id') && u.vendor_id === vendor.id)
      if (!target) return fail(db, 404, 'user_not_found', 'User not found')
      const read = await readJson(request)
      if (!read.ok) return badJson(db)
      if (typeof read.body.disabled !== 'boolean') return invalid(db, { disabled: 'Input should be a valid boolean' })
      if (target.id === user.id && read.body.disabled) return fail(db, 409, 'cannot_disable_self', 'You cannot turn yourself off')
      if (read.body.disabled) {
        target.status = 'disabled'
        for (const [refresh, id] of db.sessions.refresh) if (id === target.id) db.sessions.refresh.delete(refresh)
        for (const [access, s] of db.sessions.access) if (s.userId === target.id) db.sessions.access.delete(access)
      } else if (target.status === 'disabled') {
        target.status = target.password === null ? 'invited' : 'active'
      }
      return json(db, userOut(target))
    }, { owner: true })),

    http.post(at('/v1/vendor/users/:user_id/resend-invite'), authed(({ db, params, vendor }) => {
      const target = db.users.find((u) => u.id === param(params, 'user_id') && u.vendor_id === vendor.id)
      if (!target) return fail(db, 404, 'user_not_found', 'User not found')
      if (target.status !== 'invited') return fail(db, 409, 'not_invited', 'This person has already accepted the invitation')
      const token = nextToken(db, 'invite')
      db.tokens.set(token, { kind: 'invite', userId: target.id })
      db.emails.push({ to: target.email, kind: 'invite', token })
      return noContent(db)
    }, { owner: true })),
  ]
}

// ---- helpers for tests and the demo --------------------------------------------------------------

/** Decides the newest pending review of a product or the brand page, as an admin would. */
export function decide(db: MockDb, target: { productId?: string; brandOf?: string }, decision: { approve: boolean; reason?: string }): void {
  const now = db.now().toISOString()
  if (target.productId) {
    const product = db.products.find((p) => p.id === target.productId)
    if (!product?.working || product.working.state !== 'in_review') return
    const submission = db.submissions.find((s) => s.product_id === product.id && s.status === 'pending')
    if (submission) Object.assign(submission, { status: decision.approve ? 'approved' : 'rejected', reason: decision.reason ?? null, decided_at: now })
    const revision = product.working
    revision.review = { status: decision.approve ? 'approved' : 'rejected', reason: decision.reason ?? null, decided_at: now }
    if (decision.approve) {
      revision.state = 'live'
      product.live = revision
      product.working = null
      product.status = 'approved'
    } else {
      revision.state = 'rejected'
      if (!product.live) product.status = 'rejected'
    }
    product.version += 1
    product.updated_at = now
  }
  if (target.brandOf) {
    const versions = db.brands.get(target.brandOf) ?? []
    const pending = versions.find((v) => v.state === 'pending_review')
    if (!pending) return
    const submission = db.submissions.find((s) => s.vendor_id === target.brandOf && s.subject === 'brand_profile' && s.status === 'pending')
    if (submission) Object.assign(submission, { status: decision.approve ? 'approved' : 'rejected', reason: decision.reason ?? null, decided_at: now })
    if (decision.approve) {
      for (const v of versions) if (v.state === 'published') v.state = 'superseded'
      pending.state = 'published'
      pending.published_at = now
    } else {
      pending.state = 'rejected'
    }
  }
}
