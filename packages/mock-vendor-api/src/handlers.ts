import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import { checksFor, percent, type BrandRecord, type MockVendorApi, type ProductRecord, type VendorRecord } from './db'
import type { components } from './schema'

type S = components['schemas']
const API = '*/api/v1/admin'
const QUEUE_URL = '*/v1/admin/queue'
const REASON_MIN = 10
const NOTE_MAX = 600
const MAX_BPS = 4000
// The most products one bulk approval takes.
const BULK_MAX = 50

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

type BulkItem = S['ApproveProductsBody']['products'][number]

// A bulk approval's list: 1 to 50 products, each once, each with its id and the version the
// reviewer saw. Anything else is a 422 and nothing is approved.
function bulkProblem(body: unknown): { items: BulkItem[] } | { problem: ReturnType<typeof fail> } {
  const invalid = (message: string) => ({ problem: fail(422, 'validation_error', message, { products: message }) })
  const products = (body as { products?: unknown } | null)?.products
  if (!Array.isArray(products) || products.length === 0) return invalid('Choose at least one product to approve.')
  if (products.length > BULK_MAX) return invalid(`Approve up to ${BULK_MAX} products at a time.`)
  const wellFormed = (item: unknown): item is BulkItem => {
    const { id, submitted_at: at } = (item ?? {}) as Record<string, unknown>
    return typeof id === 'string' && id !== '' && typeof at === 'string' && !Number.isNaN(Date.parse(at))
  }
  if (!products.every(wellFormed)) return invalid('Each product needs its id and the submitted_at you saw.')
  if (new Set(products.map((p) => p.id)).size !== products.length) return invalid('List each product only once.')
  return { items: products }
}

// The product review page's rule (vendor-admin ProductPhotos): front, back, detail and worn photos,
// and 5 try-on photos. How many of those a version lacks.
const REQUIRED_SLOTS: S['ProductPhoto']['slot'][] = ['front', 'back', 'detail', 'worn']
const TRY_ONS = 5
function photosMissing(version: ProductRecord['submitted']) {
  const slots = new Set(version.photos.map((photo) => photo.slot))
  return REQUIRED_SLOTS.filter((slot) => !slots.has(slot)).length + Math.max(0, TRY_ONS - version.try_on_photos.length)
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
      items.push({ id: `q_${p.id}`, kind: 'product', subject_id: p.id, title: p.submitted.title, detail: p.sku, vendor: ref(v), submitted_at: p.submittedAt, change: p.change, resubmission: p.resubmission, thumbnail_url: p.submitted.photos[0]?.url ?? null })
    }
    for (const b of db.brands.filter((x) => x.status === 'pending_review')) {
      const v = vendorOf(b.vendorId)
      items.push({ id: `q_brand_${b.vendorId}`, kind: 'brand_page', subject_id: b.vendorId, title: `${v.brand_name} brand page`, detail: b.live ? 'Edit to a live page' : 'First brand page', vendor: ref(v), submitted_at: b.submittedAt, change: b.live ? 'edit' : 'new', resubmission: 0, thumbnail_url: b.draft.cover_url })
    }
    for (const v of db.vendors.filter((x) => x.status === 'applied' || x.status === 'under_review')) {
      items.push({ id: `q_app_${v.id}`, kind: 'application', subject_id: v.id, title: v.brand_name, detail: `Vendor application · ${v.city}`, vendor: ref(v), submitted_at: v.application.applied_at, change: 'application', resubmission: 0, thumbnail_url: null })
    }
    return items.sort((a, b) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at))
  }

  // Prev/next walk the queue in the order reviewers see it (oldest first).
  function neighbours(db: MockVendorApi, subjectId: string) {
    const ids = queueItems(db).filter((i) => i.kind !== 'application').map((i) => `${i.kind}:${i.subject_id}`)
    const key = ids.find((k) => k.endsWith(`:${subjectId}`))
    const i = key ? ids.indexOf(key) : -1
    const id = (k: string | undefined) => (k ? k.split(':')[1]! : null)
    return { prev_id: i > 0 ? id(ids[i - 1]) : null, next_id: i >= 0 ? id(ids[i + 1]) : id(ids[0]) }
  }

  function nextWaiting(db: MockVendorApi, after: string): string | null {
    const items = queueItems(db).filter((i) => i.kind !== 'application' && i.subject_id !== after)
    return items[0]?.subject_id ?? null
  }

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
    const products = db.products.filter((p) => p.vendorId === v.id).map((p) => ({ id: p.id, title: p.submitted.title, status: p.status, price_paise: p.submitted.price_paise, thumbnail_url: p.submitted.photos[0]?.url ?? null, submitted_at: p.submittedAt, photos_missing: photosMissing(p.submitted) }))
    return { ...summaryOf(v), application: v.application, checks: checksFor(v), products, brand_live: db.brands.some((b) => b.vendorId === v.id && b.live !== null) || v.status === 'approved', history: v.history }
  }

  function decide(db: MockVendorApi, kind: S['ItemKind'], id: string, title: string, vendorId: string, decision: 'approved' | 'rejected', reviewer: string) {
    db.seq += 1
    db.decisions.unshift({ id: `d${db.seq}`, subjectId: id, kind, title, vendorId, decision, at: iso(), reviewer })
  }

  // Approving a waiting product, on its own or with others: it goes live, its history says who
  // approved it, the app is told (one outbox event) and the decision is recorded.
  function approveProduct(db: MockVendorApi, p: ProductRecord, reviewer: string) {
    p.status = 'approved'
    p.history.unshift({ at: iso(), event: 'approved', by: reviewer })
    const v = vendorOf(p.vendorId)
    v.live_products += p.change === 'new' ? 1 : 0
    publish(db, p.change === 'edit' ? 'product.updated' : 'product.published', p.submitted.title, v)
    decide(db, 'product', p.id, p.submitted.title, p.vendorId, 'approved', reviewer)
  }

  function rejectBody(body: Partial<S['RejectBody']>) {
    if (!body.reason_code) return fail(422, 'validation_error', 'Choose a reason.', { reason_code: 'Choose a reason.' })
    if ((body.reason ?? '').trim().length < REASON_MIN) return fail(422, 'validation_error', 'Tell the seller what to change.', { reason: `Write at least ${REASON_MIN} characters so the seller knows what to fix.` })
    return null
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
      if ((q.get('q') ?? '').length > 200) return fail(422, 'validation_error', 'Check the filters.', { q: 'Use at most 200 characters.' })
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

    http.get(`${API}/products/:id/review`, guarded(({ params }) => {
      const db = getDb()
      const p = db.products.find((x) => x.id === params.id)
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      return HttpResponse.json({ id: p.id, sku: p.sku, status: p.status, vendor: ref(vendorOf(p.vendorId)), submitted_at: p.submittedAt, resubmission: p.resubmission, submitted: p.submitted, compare_to: p.compareTo, compare_label: p.compareLabel, history: p.history, ...neighbours(db, p.id) } satisfies S['ProductReview'])
    })),

    http.post(`${API}/products/:id/approve`, guarded(({ params }, reviewer) => {
      const db = getDb()
      const p = db.products.find((x) => x.id === params.id) as ProductRecord | undefined
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      if (p.status !== 'pending_review') return fail(409, 'review_already_decided', `This product was already ${p.status === 'approved' ? 'approved' : 'sent back'}.`)
      approveProduct(db, p, reviewer)
      return HttpResponse.json({ id: p.id, decision: 'approved', at: iso(), next_id: nextWaiting(db, p.id) } satisfies S['Decision'])
    })),

    http.post(`${API}/products/:id/reject`, guarded(async ({ params, request }, reviewer) => {
      const db = getDb()
      const p = db.products.find((x) => x.id === params.id)
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      if (p.status !== 'pending_review') return fail(409, 'review_already_decided', 'This product was already decided.')
      const body = (await request.json()) as Partial<S['RejectBody']>
      const problem = rejectBody(body)
      if (problem) return problem
      p.status = 'rejected'
      p.history.unshift({ at: iso(), event: 'rejected', by: reviewer, note: body.reason!.trim() })
      decide(db, 'product', p.id, p.submitted.title, p.vendorId, 'rejected', reviewer)
      return HttpResponse.json({ id: p.id, decision: 'rejected', at: iso(), next_id: nextWaiting(db, p.id) } satisfies S['Decision'])
    })),

    http.get(`${API}/brand-pages/:vendorId/review`, guarded(({ params }) => {
      const db = getDb()
      const b = db.brands.find((x) => x.vendorId === params.vendorId) as BrandRecord | undefined
      if (!b) return fail(404, 'not_found', 'We could not find that brand page.')
      const changed = (Object.keys(b.draft) as (keyof S['BrandProfile'])[]).filter((k) => !b.live || b.live[k] !== b.draft[k])
      return HttpResponse.json({ vendor: ref(vendorOf(b.vendorId)), submitted_at: b.submittedAt, live: b.live, draft: b.draft, changed_fields: changed, history: b.history, ...neighbours(db, b.vendorId) } satisfies S['BrandReview'])
    })),

    http.post(`${API}/brand-pages/:vendorId/approve`, guarded(({ params }, reviewer) => {
      const db = getDb()
      const b = db.brands.find((x) => x.vendorId === params.vendorId)
      if (!b) return fail(404, 'not_found', 'We could not find that brand page.')
      if (b.status !== 'pending_review') return fail(409, 'review_already_decided', 'This brand page was already decided.')
      b.status = 'approved'
      b.live = b.draft
      b.history.unshift({ at: iso(), event: 'approved', by: reviewer })
      const v = vendorOf(b.vendorId)
      publish(db, 'brand_profile.published', v.brand_name, v)
      decide(db, 'brand_page', b.vendorId, `${v.brand_name} brand page`, b.vendorId, 'approved', reviewer)
      return HttpResponse.json({ id: b.vendorId, decision: 'approved', at: iso(), next_id: nextWaiting(db, b.vendorId) } satisfies S['Decision'])
    })),

    http.post(`${API}/brand-pages/:vendorId/reject`, guarded(async ({ params, request }, reviewer) => {
      const db = getDb()
      const b = db.brands.find((x) => x.vendorId === params.vendorId)
      if (!b) return fail(404, 'not_found', 'We could not find that brand page.')
      const body = (await request.json()) as Partial<S['RejectBody']>
      const problem = rejectBody(body)
      if (problem) return problem
      b.status = 'rejected'
      b.history.unshift({ at: iso(), event: 'rejected', by: reviewer, note: body.reason!.trim() })
      const v = vendorOf(b.vendorId)
      decide(db, 'brand_page', b.vendorId, `${v.brand_name} brand page`, b.vendorId, 'rejected', reviewer)
      return HttpResponse.json({ id: b.vendorId, decision: 'rejected', at: iso(), next_id: nextWaiting(db, b.vendorId) } satisfies S['Decision'])
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
      // vendor-api's own codes: a rejected vendor is `vendor_not_eligible`, which keeps its own wording.
      if (v.status === 'rejected') return fail(409, 'vendor_not_eligible', 'This application was rejected: there is no rate to agree.')
      if (v.status !== 'approved' && v.status !== 'suspended') return fail(409, 'invalid_status_transition', 'Set the rate when you approve the application.')
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

    // Several of an approved vendor's waiting products at once. Each is approved exactly as on its own, unless
    // it is not this vendor's, was already decided or changed since the reviewer looked.
    http.post(`${API}/vendors/:id/products/approve`, guarded(async ({ params, request }, reviewer) => {
      const db = getDb()
      const v = db.vendors.find((x) => x.id === params.id)
      if (!v) return fail(404, 'not_found', 'We could not find that vendor.')
      const checked = bulkProblem(await request.json().catch(() => null))
      if ('problem' in checked) return checked.problem
      // Approving here publishes; a suspended or rejected brand's products are hidden from the app.
      if (v.status !== 'approved') return fail(409, 'invalid_status_transition', 'Products can be approved together only for an approved brand.')
      const result: S['ApproveProductsResult'] = { approved: [], failed: [] }
      for (const item of checked.items) {
        // Another vendor's product is not found here, whatever its state: this URL never approves it.
        const p = db.products.find((x) => x.id === item.id && x.vendorId === v.id)
        if (!p) result.failed.push({ id: item.id, code: 'not_found', message: 'We could not find this product for this brand.' })
        else if (p.status !== 'pending_review') result.failed.push({ id: p.id, code: 'not_pending', message: `This product was already ${p.status === 'approved' ? 'approved' : 'sent back'}.` })
        else if (Date.parse(p.submittedAt) !== Date.parse(item.submitted_at)) result.failed.push({ id: p.id, code: 'changed', message: 'The brand changed this product after you looked. Open it to review the new version.' })
        else {
          approveProduct(db, p, reviewer)
          result.approved.push({ id: p.id, at: iso() })
        }
      }
      return HttpResponse.json(result)
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
      // vendor-api's code for a retry of an event that is not dead; the screens show its message as is.
      if (e.status === 'delivered') return fail(409, 'invalid_outbox_status', 'This event was already delivered.')
      Object.assign(e, { status: 'delivered', tries: e.tries + 1, last_attempt_at: iso(), next_attempt_at: null, last_error: null })
      return HttpResponse.json(e)
    })),
  ]
}
