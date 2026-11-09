import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import type { BrandRecord, MockVendorApi, ProductRecord, VendorRecord } from './db'
import type { components } from './schema'

type S = components['schemas']
const API = '*/api/v1/admin'
const REASON_MIN = 10

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

function fail(status: number, code: string, message: string, fields?: Record<string, string>) {
  return HttpResponse.json({ message, extra: fields ? { code, fields } : { code } }, { status })
}

const ref = (v: VendorRecord): S['VendorRef'] => ({ id: v.id, name: v.brand_name })

export function createVendorApiHandlers(getDb: () => MockVendorApi) {
  const iso = () => getDb().now().toISOString()
  const vendorOf = (id: string) => getDb().vendors.find((v) => v.id === id)!

  // The reviewer always comes from the token (ADR 0009).
  const guarded = (resolver: (info: Parameters<HttpResponseResolver>[0], reviewer: string) => ReturnType<HttpResponseResolver>): HttpResponseResolver => (info) => {
    const reviewer = reviewerFrom(info.request.headers.get('authorization'), getDb().now())
    if (!reviewer) return fail(401, 'unauthenticated', 'Your session has ended. Sign in again.')
    return resolver(info, reviewer)
  }

  function queueItems(db: MockVendorApi): S['QueueItem'][] {
    const items: S['QueueItem'][] = []
    for (const p of db.products.filter((x) => x.status === 'pending_review')) {
      const v = vendorOf(p.vendorId)
      items.push({ id: `q_${p.id}`, kind: 'product', subject_id: p.id, title: p.submitted.title, detail: p.sku, vendor: ref(v), submitted_at: p.submittedAt, change: p.change, resubmission: p.resubmission, thumbnail_url: p.submitted.images[0]?.url ?? null })
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

  function publish(db: MockVendorApi, event: S['OutboxEvent']['event'], subject: string, vendor: VendorRecord) {
    db.seq += 1
    db.outbox.unshift({ id: `evt_${db.seq}`, event, subject, vendor: ref(vendor), status: 'waiting', tries: 0, created_at: iso(), last_attempt_at: null, next_attempt_at: iso(), last_error: null, payload: { event, idempotency_key: `idem_${db.seq}`, vendor_id: vendor.id, subject, occurred_at: iso(), schema: 'docs/adr/0003-contract' } })
  }

  function detail(v: VendorRecord, db: MockVendorApi): S['VendorDetail'] {
    const products = db.products.filter((p) => p.vendorId === v.id).map((p) => ({ id: p.id, title: p.submitted.title, status: p.status, price_paise: p.submitted.price_paise, thumbnail_url: p.submitted.images[0]?.url ?? null }))
    const { application, checks, history, ...summary } = v
    return { ...summary, application, checks, products, brand_live: db.brands.some((b) => b.vendorId === v.id && b.live !== null) || v.status === 'approved', history }
  }

  function decide(db: MockVendorApi, kind: S['ItemKind'], id: string, title: string, vendorId: string, decision: 'approved' | 'rejected', reviewer: string) {
    db.seq += 1
    db.decisions.unshift({ id: `d${db.seq}`, kind, title, vendorId, decision, at: iso(), reviewer })
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
        publishing: {
          waiting: db.outbox.filter((e) => e.status === 'waiting').length,
          retrying: db.outbox.filter((e) => e.status === 'retrying').length,
          failed: db.outbox.filter((e) => e.status === 'failed').length,
          delivered_24h: 312 + db.outbox.filter((e) => e.status === 'delivered').length,
        },
        recent: db.decisions.slice(0, 6).map((d) => ({ id: d.id, kind: d.kind, title: d.title, vendor: ref(vendorOf(d.vendorId)), decision: d.decision, at: d.at, reviewer: d.reviewer })),
      } satisfies S['Summary'])
    })),

    http.get(`${API}/queue`, guarded(({ request }) => {
      const db = getDb()
      const q = new URL(request.url).searchParams
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
      if (q.get('sort') === 'newest') items = [...items].reverse()
      const count = (k: S['ItemKind']) => all.filter((i) => i.kind === k).length
      const vendors = [...new Map(all.map((i) => [i.vendor.id, i.vendor])).values()]
      return HttpResponse.json({ items, counts: { all: all.length, product: count('product'), brand_page: count('brand_page'), application: count('application') }, vendors } satisfies S['QueuePage'])
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
      if (p.status !== 'pending_review') return fail(409, 'invalid_transition', `This product was already ${p.status === 'approved' ? 'approved' : 'sent back'}.`)
      p.status = 'approved'
      p.history.unshift({ at: iso(), event: 'approved', by: reviewer })
      const v = vendorOf(p.vendorId)
      v.live_products += p.change === 'new' ? 1 : 0
      publish(db, p.change === 'edit' ? 'product.updated' : 'product.published', p.submitted.title, v)
      decide(db, 'product', p.id, p.submitted.title, p.vendorId, 'approved', reviewer)
      return HttpResponse.json({ id: p.id, decision: 'approved', at: iso(), next_id: nextWaiting(db, p.id) } satisfies S['Decision'])
    })),

    http.post(`${API}/products/:id/reject`, guarded(async ({ params, request }, reviewer) => {
      const db = getDb()
      const p = db.products.find((x) => x.id === params.id)
      if (!p) return fail(404, 'not_found', 'We could not find that product.')
      if (p.status !== 'pending_review') return fail(409, 'invalid_transition', 'This product was already decided.')
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
      if (b.status !== 'pending_review') return fail(409, 'invalid_transition', 'This brand page was already decided.')
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
      const sort = q.get('sort') ?? 'name'
      items = [...items].sort((a, b) => (sort === 'newest' ? Date.parse(b.since) - Date.parse(a.since) : sort === 'products' ? b.live_products - a.live_products : a.brand_name.localeCompare(b.brand_name)))
      const c = { all: db.vendors.length, applied: 0, under_review: 0, approved: 0, rejected: 0, suspended: 0 }
      for (const v of db.vendors) c[v.status] += 1
      return HttpResponse.json({ items: items.map(({ application: _a, checks: _c, history: _h, ...v }) => v), counts: c, cities: [...new Set(db.vendors.map((v) => v.city))].sort() } satisfies S['VendorPage'])
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
        if (!open) return fail(409, 'invalid_transition', 'Only applications can be approved.')
        const bps = Number(body.commission_bps)
        if (!Number.isInteger(bps) || bps < 0 || bps > 4000) return fail(422, 'validation_error', 'Check the commission.', { commission_bps: 'Enter a commission between 0% and 40%.' })
        if (!body.agreement_ref) return fail(422, 'validation_error', 'Confirm the agreement.', { agreement_ref: 'Tick this once the vendor agreement is signed.' })
        v.status = 'approved'
        v.commission_bps = bps
        if (typeof body.owner_email === 'string' && body.owner_email) v.email = body.owner_email
        v.history.unshift({ at: iso(), event: 'invited', by: reviewer, note: `Commission ${bps / 100}% · invite sent to ${v.email}` })
        publish(db, 'vendor.status_changed', v.brand_name, v)
        decide(db, 'application', v.id, v.brand_name, v.id, 'approved', reviewer)
      } else if (action === 'reject') {
        if (!open) return fail(409, 'invalid_transition', 'Only applications can be rejected.')
        if (String(body.reason ?? '').trim().length < REASON_MIN) return fail(422, 'validation_error', 'Give a reason.', { reason: `Write at least ${REASON_MIN} characters; the applicant sees this.` })
        v.status = 'rejected'
        v.history.unshift({ at: iso(), event: 'rejected', by: reviewer, note: String(body.reason).trim() })
        decide(db, 'application', v.id, v.brand_name, v.id, 'rejected', reviewer)
      } else if (action === 'request-info') {
        if (!open) return fail(409, 'invalid_transition', 'Only applications can be asked for more information.')
        if (String(body.message ?? '').trim().length < REASON_MIN) return fail(422, 'validation_error', 'Write your question.', { message: `Write at least ${REASON_MIN} characters.` })
        v.status = 'under_review'
        v.history.unshift({ at: iso(), event: 'info_requested', by: reviewer, note: String(body.message).trim() })
      } else if (action === 'suspend') {
        if (v.status !== 'approved') return fail(409, 'invalid_transition', 'Only approved vendors can be suspended.')
        if (String(body.reason ?? '').trim().length < REASON_MIN) return fail(422, 'validation_error', 'Give a reason.', { reason: `Write at least ${REASON_MIN} characters.` })
        v.status = 'suspended'
        v.history.unshift({ at: iso(), event: 'suspended', by: reviewer, note: String(body.reason).trim() })
        publish(db, 'vendor.status_changed', v.brand_name, v)
      } else if (action === 'reactivate') {
        if (v.status !== 'suspended') return fail(409, 'invalid_transition', 'Only suspended vendors can be reactivated.')
        v.status = 'approved'
        v.history.unshift({ at: iso(), event: 'reactivated', by: reviewer })
        publish(db, 'vendor.status_changed', v.brand_name, v)
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
      if (e.status === 'delivered') return fail(409, 'invalid_transition', 'This event was already delivered.')
      Object.assign(e, { status: 'delivered', tries: e.tries + 1, last_attempt_at: iso(), next_attempt_at: null, last_error: null })
      return HttpResponse.json(e)
    })),
  ]
}
