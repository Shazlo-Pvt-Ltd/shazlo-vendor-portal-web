import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import { checksFor, percent, type BrandRecord, type MockVendorApi, type ProductRecord, type VendorRecord } from './db'
import type { components } from './schema'

type S = components['schemas']
const API = '*/api/v1/admin'
const QUEUE_URL = '*/v1/admin/queue'
const REVIEWS_URL = '*/v1/admin/reviews/:id'
const STORE_DETAILS_URL = '*/v1/admin/vendors/:id/store-details'
const REASON_CODES = ['photos', 'try_on_photos', 'price', 'category', 'prohibited', 'description', 'brand_images', 'contact_details', 'other']
const REASON_MIN = 10
const NOTE_MAX = 600
const MAX_BPS = 4000

// Tokens come from the identity mock's token exchange: mock.vendor-api.<adminId>.<name>.<expEpochSeconds>
export function mockModuleToken(admin: { id: string; name: string }, expiresAt: number) {
  return `mock.vendor-api.${admin.id}.${encodeURIComponent(admin.name)}.${expiresAt}`
}

function reviewerFrom(header: string | null, now: Date): string | null {
  const parts = header?.replace(/^Bearer /, '').split('.') ?? []
  if (parts.length !== 5 || parts[0] !== 'mock' || parts[1] !== 'vendor-api') return null
  if (Number(parts[4]) * 1000 < now.getTime()) return null
  return decodeURIComponent(parts[3]!)
}

// vendor-api's envelope: {error: {code, message, request_id, details?}}; a 422 lists pydantic-style problems.
function fail(status: number, code: string, message: string, fields?: Record<string, string>) {
  const details = fields ? Object.entries(fields).map(([field, msg]) => ({ loc: ['body', field], msg, type: 'value_error' })) : undefined
  const request_id = crypto.randomUUID()
  return HttpResponse.json({ error: { code, message, request_id, ...(details ? { details } : {}) } }, { status, headers: { 'X-Request-Id': request_id } })
}

const ref = (v: VendorRecord): S['VendorRef'] => ({ id: v.id, name: v.brand_name })

function summaryOf(v: VendorRecord): S['VendorSummary'] {
  const { application: _a, history: _h, ...rest } = v
  return { ...rest, commission_bps: v.commission.agreed_bps }
}

// A rate from the admin: whole basis points from 0 to 40%.
function rateProblem(bps: unknown) {
  const n = Number(bps)
  if (bps === undefined || bps === null || bps === '' || !Number.isInteger(n) || n < 0 || n > MAX_BPS) return fail(422, 'validation_error', 'Check the commission.', { commission_bps: 'Enter a commission between 0% and 40%.' })
  return null
}

export function createVendorApiHandlers(getDb: () => MockVendorApi) {
  const iso = () => getDb().now().toISOString()
  const vendorOf = (id: string) => getDb().vendors.find((v) => v.id === id)!

  // The reviewer always comes from the token (ADR 0009).
  const guarded = (resolver: (info: Parameters<HttpResponseResolver>[0], reviewer: string) => ReturnType<HttpResponseResolver>): HttpResponseResolver => (info) => {
    const reviewer = reviewerFrom(info.request.headers.get('authorization'), getDb().now())
    if (!reviewer) return fail(401, 'unauthorized', 'Your session has ended. Sign in again.')
    return resolver(info, reviewer)
  }

  function queueItems(db: MockVendorApi): S['QueueItem'][] {
    const items: S['QueueItem'][] = []
    for (const p of db.products.filter((x) => x.status === 'pending_review')) {
      const v = vendorOf(p.vendorId)
      items.push({ id: productReviewId(p), kind: 'product', subject_id: p.id, title: p.submitted.title, detail: p.sku, vendor: ref(v), submitted_at: p.submittedAt, change: p.change, resubmission: p.resubmission, thumbnail_url: p.submitted.photos[0]?.url ?? null })
    }
    for (const b of db.brands.filter((x) => x.status === 'pending_review')) {
      const v = vendorOf(b.vendorId)
      items.push({ id: brandReviewId(b), kind: 'brand_page', subject_id: b.vendorId, title: `${v.brand_name} brand page`, detail: b.live ? 'Edit to a live page' : 'First brand page', vendor: ref(v), submitted_at: b.submittedAt, change: b.live ? 'edit' : 'new', resubmission: 0, thumbnail_url: b.draft.cover_url })
    }
    for (const v of db.vendors.filter((x) => x.status === 'applied' || x.status === 'under_review')) {
      items.push({ id: `q_app_${v.id}`, kind: 'application', subject_id: v.id, title: v.brand_name, detail: `Vendor application · ${v.city}`, vendor: ref(v), submitted_at: v.application.applied_at, change: 'application', resubmission: 0, thumbnail_url: null })
    }
    return items.sort((a, b) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at))
  }

  // vendor-api reviews are keyed by the review's id. The mock has one review per waiting product or
  // brand page, so its id comes from the record (and a decided record keeps its id).
  const productReviewId = (p: ProductRecord) => `rev_${p.id}`
  const brandReviewId = (b: BrandRecord) => `rev_brand_${b.vendorId}`
  // A submission's version: one more than the times it was sent back.
  const productVersion = (p: ProductRecord) => p.resubmission + 1
  const brandVersion = (b: BrandRecord) => (b.live ? 2 : 1)

  const wireStatus = (status: ProductRecord['status']) => (status === 'pending_review' ? 'pending' : status)

  // What each history entry was, as vendor-api's audit trail names it (actors are ids there, not names).
  const eventsOf = (history: S['History'], vendorId: string) =>
    [...history].reverse().map((e) => ({ action: e.event, actor_type: e.event === 'submitted' ? 'vendor' : 'admin', actor_id: e.event === 'submitted' ? null : 'a_priya', reason: e.note ?? null, detail: null, created_at: e.at, _vendor: vendorId }))

  const vendorOut = (v: VendorRecord) => ({ id: v.id, name: v.brand_name, slug: v.brand_name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), status: v.status === 'suspended' ? 'suspended' : 'approved' })

  // A product version as vendor-api's `content`: the fields it stores, the variants (one per size and
  // colour) and the images in order. Named photo slots, try-on photos, stock and the size chart are not
  // stored yet (#288), so they are not here.
  function productContent(v: S['ProductVersion']) {
    const colours = [v.main_colour, ...v.other_colours]
    return {
      title: v.title,
      description: v.description,
      category: 'Clothing',
      subcategory: v.product_type,
      gender: v.gender,
      fabric: v.material,
      weight_grams: 400,
      returnable: true,
      return_window_days: 7,
      variants: colours.flatMap((c, i) => v.variants.map((x) => ({ sku: i === 0 ? x.sku : `${x.sku}-${c.name.slice(0, 3).toUpperCase()}`, size: x.size, color: c.name, price_paise: v.price_paise, mrp_paise: v.mrp_paise, is_active: true }))),
      images: v.photos.map((photo, n) => ({ position: n + 1, asset_id: photo.id, url: photo.url, alt_text: null })),
    }
  }

  function reviewShell(vendor: VendorRecord, id: string, status: ProductRecord['status'], submittedAt: string, version: number, title: string, history: S['History']) {
    const decision = history.find((e) => e.event === 'approved' || e.event === 'rejected')
    return {
      id,
      status: wireStatus(status),
      vendor: vendorOut(vendor),
      submitted_by: `u_${vendor.id}`,
      submitted_by_email: vendor.email,
      submitted_at: submittedAt,
      version,
      title,
      reviewer_id: status === 'pending_review' ? null : 'a_priya',
      decided_at: status === 'pending_review' ? null : (decision?.at ?? null),
      reason: status === 'rejected' ? (decision?.note ?? null) : null,
      reason_code: null,
      events: eventsOf(history, vendor.id).map(({ _vendor, ...e }) => e),
    }
  }

  // The fields that differ between two versions (the service also names variants and images one by one).
  const productChanges = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((field) => ({ field, before: before[field] ?? null, after: after[field] }))

  function productDetail(p: ProductRecord) {
    const version = productVersion(p)
    return {
      ...reviewShell(vendorOf(p.vendorId), productReviewId(p), p.status, p.submittedAt, version, p.submitted.title, p.history),
      subject: 'product',
      product_id: p.id,
      sku: p.sku,
      content: { version, published_at: null, content: productContent(p.submitted) },
      // vendor-api compares with the version that went live only; the version sent back last time is not offered.
      base: p.compareTo && p.compareLabel === 'live' ? { version: Math.max(1, version - 1), published_at: p.submittedAt, content: productContent(p.compareTo) } : null,
      changes: p.compareTo && p.compareLabel === 'live' ? productChanges(productContent(p.compareTo), productContent(p.submitted)) : Object.entries(productContent(p.submitted)).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0)).map(([field, after]) => ({ field, before: null, after })),
      resubmission: p.resubmission,
    }
  }

  // The brand page's fields under vendor-api's names, and which of them differ from the live page.
  const BRAND_WIRE = { tagline: 'tagline', story: 'about', cover_url: 'banner', logo_url: 'logo', instagram: 'instagram_handle', website: 'website_url' } as const
  function brandContent(profile: S['BrandProfile'], vendor: VendorRecord) {
    const asset = (url: string | null, id: string) => (url ? { asset_id: id, url } : null)
    return { brand_name: vendor.brand_name, tagline: profile.tagline, about: profile.story, logo: asset(profile.logo_url, `${vendor.id}-logo`), banner: asset(profile.cover_url, `${vendor.id}-banner`), website_url: profile.website, instagram_handle: profile.instagram.replace(/^@/, ''), categories: [], price_min_paise: null, price_max_paise: null }
  }

  function brandDetail(b: BrandRecord) {
    const vendor = vendorOf(b.vendorId)
    const version = brandVersion(b)
    const changes = (Object.keys(BRAND_WIRE) as (keyof typeof BRAND_WIRE)[]).filter((k) => !b.live || b.live[k] !== b.draft[k]).map((k) => ({ field: BRAND_WIRE[k], before: b.live ? b.live[k] : null, after: b.draft[k] }))
    return {
      ...reviewShell(vendor, brandReviewId(b), b.status, b.submittedAt, version, `${vendor.brand_name} brand page`, b.history),
      subject: 'brand_profile',
      product_id: null,
      sku: null,
      content: { version, published_at: null, content: brandContent(b.draft, vendor) },
      base: b.live ? { version: 1, published_at: b.submittedAt, content: brandContent(b.live, vendor) } : null,
      changes,
      resubmission: 0,
    }
  }

  const findProduct = (db: MockVendorApi, reviewId: string) => db.products.find((p) => productReviewId(p) === reviewId)
  const findBrand = (db: MockVendorApi, reviewId: string) => db.brands.find((b) => brandReviewId(b) === reviewId)

  function publish(db: MockVendorApi, event: S['OutboxEvent']['event'], subject: string, vendor: VendorRecord, extra: Record<string, unknown> = {}) {
    db.seq += 1
    db.outbox.unshift({ id: `evt_${db.seq}`, event, subject, vendor: ref(vendor), status: 'waiting', tries: 0, created_at: iso(), last_attempt_at: null, next_attempt_at: iso(), last_error: null, payload: { event, idempotency_key: `idem_${db.seq}`, vendor_id: vendor.id, subject, occurred_at: iso(), schema: 'docs/adr/0003-contract', ...extra } })
  }

  // The agreed rate changed: the central app needs it to work out payouts.
  function agree(db: MockVendorApi, v: VendorRecord, bps: number, note: string | null) {
    v.commission = { state: 'agreed', agreed_bps: bps, proposed_bps: null, note, updated_at: iso() }
    publish(db, 'vendor.commission_changed', v.brand_name, v, { commission_bps: bps })
  }

  function detail(v: VendorRecord, db: MockVendorApi): S['VendorDetail'] {
    const products = db.products.filter((p) => p.vendorId === v.id).map((p) => ({ id: p.id, title: p.submitted.title, status: p.status, price_paise: p.submitted.price_paise, thumbnail_url: p.submitted.photos[0]?.url ?? null }))
    return { ...summaryOf(v), application: v.application, checks: checksFor(v), products, brand_live: db.brands.some((b) => b.vendorId === v.id && b.live !== null) || v.status === 'approved', history: v.history }
  }

  function decide(db: MockVendorApi, kind: S['ItemKind'], id: string, title: string, vendorId: string, decision: 'approved' | 'rejected', reviewer: string) {
    db.seq += 1
    db.decisions.unshift({ id: `d${db.seq}`, subjectId: id, kind, title, vendorId, decision, at: iso(), reviewer })
  }

  return [
    http.get(`${API}/summary`, guarded(() => {
      const db = getDb()
      const items = queueItems(db)
      const day = new Date(db.now()).toISOString().slice(0, 10)
      const count = (k: S['ItemKind']) => items.filter((i) => i.kind === k).length
      return HttpResponse.json({
        queue: { all: items.length, product: count('product'), brand_page: count('brand_page'), application: count('application'), over_24h: items.filter((i) => db.now().getTime() - Date.parse(i.submitted_at) > 24 * 3_600_000).length },
        decided_today: db.decisions.filter((d) => d.at.slice(0, 10) === day).length,
        median_minutes: 320,
        resubmissions: items.filter((i) => i.resubmission > 0).length,
        commission_proposals: db.vendors.filter((v) => v.commission.state === 'proposed').length,
        publishing: {
          waiting: db.outbox.filter((e) => e.status === 'waiting').length,
          retrying: db.outbox.filter((e) => e.status === 'retrying').length,
          failed: db.outbox.filter((e) => e.status === 'failed').length,
          delivered_24h: 312 + db.outbox.filter((e) => e.status === 'delivered').length,
        },
        recent: db.decisions.slice(0, 6).map((d) => ({ id: d.id, subject_id: d.subjectId, kind: d.kind, title: d.title, vendor: ref(vendorOf(d.vendorId)), decision: d.decision, at: d.at, reviewer: d.reviewer })),
      } satisfies S['Summary'])
    })),

    // `GET /v1/admin/queue` as vendor-api serves it (services/vendor-api/vendor_api/api/admin_queue.py):
    // filtered, sorted and paged here; `counts` and `vendors` always describe the whole queue.
    http.get(QUEUE_URL, guarded(({ request }) => {
      const db = getDb()
      const q = new URL(request.url).searchParams
      const limit = q.has('limit') ? Number(q.get('limit')) : 50
      const offset = q.has('offset') ? Number(q.get('offset')) : 0
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail(422, 'validation_error', 'Check the filters.', { limit: 'Use a page size from 1 to 100.' })
      if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) return fail(422, 'validation_error', 'Check the filters.', { offset: 'Use an offset from 0 to 100000.' })
      const all = queueItems(db)
      let items = all
      if (q.get('kind')) items = items.filter((i) => i.kind === q.get('kind'))
      if (q.get('vendor')) items = items.filter((i) => i.vendor.id === q.get('vendor'))
      const text = q.get('q')?.trim().toLowerCase()
      if (text) items = items.filter((i) => `${i.title} ${i.detail} ${i.vendor.name}`.toLowerCase().includes(text))
      const age = (i: S['QueueItem']) => db.now().getTime() - Date.parse(i.submitted_at)
      if (q.get('submitted') === 'today') items = items.filter((i) => age(i) < 24 * 3_600_000)
      if (q.get('submitted') === '24h') items = items.filter((i) => age(i) >= 24 * 3_600_000 && age(i) < 48 * 3_600_000)
      if (q.get('submitted') === 'older') items = items.filter((i) => age(i) >= 48 * 3_600_000)
      if (q.get('resubmissions') === 'true') items = items.filter((i) => i.resubmission > 0)
      // Same time keeps a fixed order (by id), so paging never repeats or skips an item.
      const order = (a: S['QueueItem'], b: S['QueueItem']) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      items = [...items].sort(order)
      if (q.get('sort') === 'newest') items.reverse()
      const count = (k: S['ItemKind']) => all.filter((i) => i.kind === k).length
      const vendors = [...new Map(all.map((i) => [i.vendor.id, i.vendor])).values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      return HttpResponse.json({ items: items.slice(offset, offset + limit), total: items.length, limit, offset, counts: { all: all.length, product: count('product'), brand_page: count('brand_page'), application: count('application') }, vendors })
    })),

    // `GET /v1/admin/reviews/{review_id}` and the two decisions (services/vendor-api/vendor_api/api/admin_reviews.py).
    http.get(REVIEWS_URL, guarded(({ params }) => {
      const db = getDb()
      const id = String(params.id)
      const p = findProduct(db, id)
      if (p) return HttpResponse.json(productDetail(p))
      const b = findBrand(db, id)
      if (b) return HttpResponse.json(brandDetail(b))
      return fail(404, 'review_not_found', 'Review not found')
    })),

    http.post(`${REVIEWS_URL}/approve`, guarded(async ({ params, request }, reviewer) => {
      const db = getDb()
      const id = String(params.id)
      const body = (await request.json().catch(() => ({}))) as { version?: unknown; reason_code?: unknown }
      if (!Number.isInteger(body.version) || (body.version as number) < 1 || 'reason_code' in body) return fail(422, 'validation_error', 'Check the decision.', { version: 'Send the version you reviewed.' })
      const p = findProduct(db, id)
      const b = p ? undefined : findBrand(db, id)
      if (!p && !b) return fail(404, 'review_not_found', 'Review not found')
      const record = (p ?? b)!
      if (record.status !== 'pending_review') return fail(409, 'review_already_decided', `This review is already ${record.status === 'approved' ? 'approved' : 'rejected'}`)
      if (body.version !== (p ? productVersion(p) : brandVersion(b!))) return fail(409, 'stale_review', 'This submission changed after you opened it.')
      if (p) {
        p.status = 'approved'
        p.history.unshift({ at: iso(), event: 'approved', by: reviewer })
        const v = vendorOf(p.vendorId)
        v.live_products += p.change === 'new' ? 1 : 0
        publish(db, p.change === 'edit' ? 'product.updated' : 'product.published', p.submitted.title, v)
        decide(db, 'product', p.id, p.submitted.title, p.vendorId, 'approved', reviewer)
        return HttpResponse.json(productDetail(p))
      }
      const page = b!
      page.status = 'approved'
      page.live = page.draft
      page.history.unshift({ at: iso(), event: 'approved', by: reviewer })
      const v = vendorOf(page.vendorId)
      publish(db, 'brand_profile.published', v.brand_name, v)
      decide(db, 'brand_page', page.vendorId, `${v.brand_name} brand page`, page.vendorId, 'approved', reviewer)
      return HttpResponse.json(brandDetail(page))
    })),

    http.post(`${REVIEWS_URL}/reject`, guarded(async ({ params, request }, reviewer) => {
      const db = getDb()
      const id = String(params.id)
      const body = (await request.json().catch(() => ({}))) as { version?: unknown; reason?: unknown; reason_code?: unknown }
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (!Number.isInteger(body.version) || (body.version as number) < 1) return fail(422, 'validation_error', 'Check the decision.', { version: 'Send the version you reviewed.' })
      if (!reason || reason.length > 2000) return fail(422, 'validation_error', 'Tell the seller what to change.', { reason: 'Write a reason of up to 2000 characters.' })
      if (body.reason_code != null && !REASON_CODES.includes(String(body.reason_code))) return fail(422, 'validation_error', 'Choose a reason from the list.', { reason_code: 'Choose a reason from the list.' })
      const p = findProduct(db, id)
      const b = p ? undefined : findBrand(db, id)
      if (!p && !b) return fail(404, 'review_not_found', 'Review not found')
      const record = (p ?? b)!
      if (record.status !== 'pending_review') return fail(409, 'review_already_decided', `This review is already ${record.status === 'approved' ? 'approved' : 'rejected'}`)
      if (body.version !== (p ? productVersion(p) : brandVersion(b!))) return fail(409, 'stale_review', 'This submission changed after you opened it.')
      const withCode = (detail: Record<string, unknown>) => ({ ...detail, reason_code: body.reason_code ?? null })
      if (p) {
        p.status = 'rejected'
        p.history.unshift({ at: iso(), event: 'rejected', by: reviewer, note: reason })
        decide(db, 'product', p.id, p.submitted.title, p.vendorId, 'rejected', reviewer)
        return HttpResponse.json(withCode(productDetail(p)))
      }
      const page = b!
      page.status = 'rejected'
      page.history.unshift({ at: iso(), event: 'rejected', by: reviewer, note: reason })
      const v = vendorOf(page.vendorId)
      decide(db, 'brand_page', page.vendorId, `${v.brand_name} brand page`, page.vendorId, 'rejected', reviewer)
      return HttpResponse.json(withCode(brandDetail(page)))
    })),

    // A vendor's store details as the admin reads them: here, only what the brand page needs (returns and delivery).
    http.get(STORE_DETAILS_URL, guarded(({ params }) => {
      const v = getDb().vendors.find((x) => x.id === params.id)
      if (!v) return fail(404, 'vendor_not_found', 'Vendor not found')
      return HttpResponse.json({ brand_name: v.brand_name, business: {}, city: v.city, complete: true, contact: null, delivery: v.application.delivery, instagram_or_website: v.application.instagram_or_website, missing: [], pay_on_delivery: v.application.pay_on_delivery, payout: null, returns: v.application.returns, sells: v.sells, updated_at: null })
    })),

    http.get(`${API}/vendors`, guarded(({ request }) => {
      const db = getDb()
      const q = new URL(request.url).searchParams
      let items = db.vendors
      if (q.get('status')) items = items.filter((v) => v.status === q.get('status'))
      const text = q.get('q')?.trim().toLowerCase()
      if (text) items = items.filter((v) => `${v.brand_name} ${v.owner_name} ${v.email} ${v.phone}`.toLowerCase().includes(text))
      if (q.get('city')) items = items.filter((v) => v.city === q.get('city'))
      if (q.get('commission')) items = items.filter((v) => v.commission.state === q.get('commission'))
      const sort = q.get('sort') ?? 'name'
      items = [...items].sort((a, b) => (sort === 'newest' ? Date.parse(b.since) - Date.parse(a.since) : sort === 'products' ? b.live_products - a.live_products : a.brand_name.localeCompare(b.brand_name)))
      const c = { all: db.vendors.length, applied: 0, under_review: 0, approved: 0, rejected: 0, suspended: 0, rate_to_review: 0 }
      for (const v of db.vendors) {
        c[v.status] += 1
        if (v.commission.state === 'proposed') c.rate_to_review += 1
      }
      return HttpResponse.json({ items: items.map(summaryOf), counts: c, cities: [...new Set(db.vendors.map((v) => v.city))].sort() } satisfies S['VendorPage'])
    })),

    http.get(`${API}/vendors/:id`, guarded(({ params }) => {
      const db = getDb()
      const v = db.vendors.find((x) => x.id === params.id)
      return v ? HttpResponse.json(detail(v, db)) : fail(404, 'not_found', 'We could not find that vendor.')
    })),

    http.post(`${API}/vendors/:id/:action`, guarded(async ({ params, request }, reviewer) => {
      const db = getDb()
      const v = db.vendors.find((x) => x.id === params.id)
      if (!v) return fail(404, 'not_found', 'We could not find that vendor.')
      const action = String(params.action)
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
      const open = v.status === 'applied' || v.status === 'under_review'
      if (action === 'approve') {
        if (!open) return fail(409, 'invalid_status_transition', 'Only applications can be approved.')
        // There is no default rate: the reviewer always sends the agreed one.
        const problem = rateProblem(body.commission_bps)
        if (problem) return problem
        if (!body.agreement_ref) return fail(422, 'validation_error', 'Confirm the agreement.', { agreement_ref: 'Tick this once the vendor agreement is signed.' })
        const bps = Number(body.commission_bps)
        v.status = 'approved'
        if (typeof body.owner_email === 'string' && body.owner_email) v.email = body.owner_email
        v.history.unshift({ at: iso(), event: 'invited', by: reviewer, note: `Commission ${percent(bps)} · invite sent to ${v.email}` })
        publish(db, 'vendor.status_changed', v.brand_name, v)
        agree(db, v, bps, null)
        decide(db, 'application', v.id, v.brand_name, v.id, 'approved', reviewer)
      } else if (action === 'reject') {
        if (!open) return fail(409, 'invalid_status_transition', 'Only applications can be rejected.')
        if (String(body.reason ?? '').trim().length < REASON_MIN) return fail(422, 'validation_error', 'Give a reason.', { reason: `Write at least ${REASON_MIN} characters; the applicant sees this.` })
        v.status = 'rejected'
        // Rejecting the application closes any rate the brand proposed with it.
        v.commission = { state: 'not_set', agreed_bps: null, proposed_bps: null, note: null, updated_at: iso() }
        v.history.unshift({ at: iso(), event: 'rejected', by: reviewer, note: String(body.reason).trim() })
        decide(db, 'application', v.id, v.brand_name, v.id, 'rejected', reviewer)
      } else if (action === 'request-info') {
        if (!open) return fail(409, 'invalid_status_transition', 'Only applications can be asked for more information.')
        if (String(body.message ?? '').trim().length < REASON_MIN) return fail(422, 'validation_error', 'Write your question.', { message: `Write at least ${REASON_MIN} characters.` })
        v.status = 'under_review'
        v.history.unshift({ at: iso(), event: 'info_requested', by: reviewer, note: String(body.message).trim() })
      } else if (action === 'suspend') {
        if (v.status !== 'approved') return fail(409, 'invalid_status_transition', 'Only approved vendors can be suspended.')
        if (String(body.reason ?? '').trim().length < REASON_MIN) return fail(422, 'validation_error', 'Give a reason.', { reason: `Write at least ${REASON_MIN} characters.` })
        v.status = 'suspended'
        v.history.unshift({ at: iso(), event: 'suspended', by: reviewer, note: String(body.reason).trim() })
        publish(db, 'vendor.status_changed', v.brand_name, v)
      } else if (action === 'reactivate') {
        if (v.status !== 'suspended') return fail(409, 'invalid_status_transition', 'Only suspended vendors can be reactivated.')
        v.status = 'approved'
        v.history.unshift({ at: iso(), event: 'reactivated', by: reviewer })
        publish(db, 'vendor.status_changed', v.brand_name, v)
      } else {
        return fail(404, 'not_found', 'Unknown action.')
      }
      return HttpResponse.json(detail(v, db))
    })),

    // Commission for approved (and suspended) brands. An application's rate is set when it is approved.
    http.post(`${API}/vendors/:id/commission/:step`, guarded(async ({ params, request }, reviewer) => {
      const db = getDb()
      const v = db.vendors.find((x) => x.id === params.id)
      if (!v) return fail(404, 'not_found', 'We could not find that vendor.')
      if (v.status !== 'approved' && v.status !== 'suspended') return fail(409, 'invalid_status_transition', v.status === 'rejected' ? 'This application was rejected.' : 'Set the rate when you approve the application.')
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
      const before = v.commission.agreed_bps
      const was = before == null ? '' : ` (was ${percent(before)})`
      const step = String(params.step)
      if (step === 'approve') {
        const proposed = v.commission.proposed_bps
        if (v.commission.state !== 'proposed' || proposed == null) return fail(409, 'no_proposal', 'There is no proposed rate waiting.')
        agree(db, v, proposed, null)
        v.history.unshift({ at: iso(), event: 'commission_approved', by: reviewer, note: `${percent(proposed)}${was}` })
      } else if (step === 'send-back') {
        if (v.commission.state !== 'proposed') return fail(409, 'no_proposal', 'There is no proposed rate waiting.')
        const note = String(body.note ?? '').trim()
        if (note.length < REASON_MIN) return fail(422, 'validation_error', 'Write a note to the brand.', { note: `Write at least ${REASON_MIN} characters so the brand knows what to propose.` })
        if (note.length > NOTE_MAX) return fail(422, 'validation_error', 'Shorten the note.', { note: `Keep the note to ${NOTE_MAX} characters.` })
        v.commission = { ...v.commission, state: 'sent_back', note, updated_at: iso() }
        v.history.unshift({ at: iso(), event: 'commission_sent_back', by: reviewer, note })
      } else if (step === 'set') {
        const problem = rateProblem(body.commission_bps)
        if (problem) return problem
        const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
        if (note && note.length > NOTE_MAX) return fail(422, 'validation_error', 'Shorten the note.', { note: `Keep the note to ${NOTE_MAX} characters.` })
        const bps = Number(body.commission_bps)
        agree(db, v, bps, note)
        v.history.unshift({ at: iso(), event: 'commission_set', by: reviewer, note: `${percent(bps)}${was}${note ? ` · ${note}` : ''}` })
      } else {
        return fail(404, 'not_found', 'Unknown action.')
      }
      return HttpResponse.json(detail(v, db))
    })),

    http.get(`${API}/outbox`, guarded(({ request }) => {
      const db = getDb()
      const status = new URL(request.url).searchParams.get('status')
      const c = { all: db.outbox.length, waiting: 0, retrying: 0, failed: 0, delivered: 0 }
      for (const e of db.outbox) c[e.status] += 1
      return HttpResponse.json({ items: status ? db.outbox.filter((e) => e.status === status) : db.outbox, counts: c } satisfies S['OutboxPage'])
    })),

    http.post(`${API}/outbox/retry-failed`, guarded(() => {
      const db = getDb()
      const failed = db.outbox.filter((e) => e.status === 'failed')
      for (const e of failed) Object.assign(e, { status: 'delivered', tries: e.tries + 1, last_attempt_at: iso(), next_attempt_at: null, last_error: null })
      return HttpResponse.json({ retried: failed.length })
    })),

    http.post(`${API}/outbox/:id/retry`, guarded(({ params }) => {
      const e = getDb().outbox.find((x) => x.id === params.id)
      if (!e) return fail(404, 'not_found', 'We could not find that event.')
      if (e.status === 'delivered') return fail(409, 'invalid_status_transition', 'This event was already delivered.')
      Object.assign(e, { status: 'delivered', tries: e.tries + 1, last_attempt_at: iso(), next_attempt_at: null, last_error: null })
      return HttpResponse.json(e)
    })),
  ]
}
