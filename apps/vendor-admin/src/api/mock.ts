// In-memory mock of vendor-api's admin endpoints (docs/05-api-design.md §6). Each method is replaced
// by an HTTP call when the endpoint ships. Every decision writes its audit entry and, where the real
// service would, an outbox event, so the queue, vendors and publishing screens stay consistent.
import {
  applicationQueue, initialBrands, initialDelivered24h, initialOutbox, initialProducts, initialStats, initialVendors, olderDelivered,
} from './fixtures'
import {
  ApiError, type ApproveVendorInput, type BrandDecisionInput, type BrandSubmission, type Decision, type OutboxEvent, type OutboxEventName,
  type OutboxSummary, type ProductDecisionInput, type ProductSubmission, type QueueItem, type QueueResponse, type Vendor, type VendorReasonInput,
} from './types'

const clone = <T,>(v: T): T => structuredClone(v)
const wait = (ms = 220) => new Promise(r => setTimeout(r, import.meta.env.MODE === 'test' ? 0 : ms))

type Queued = { seq: number; waitingMinutes: number; submittedDay: QueueItem['submittedDay']; queueSubmitted: string }

interface State {
  products: Array<ProductSubmission & Queued>
  brands: Array<BrandSubmission & Queued>
  vendors: Vendor[]
  applications: Record<string, Queued>
  outbox: OutboxEvent[]
  olderDelivered: number
  delivered24h: number
  approvedToday: number
  sentBackToday: number
  rejectedToday: number
  medianDecisionMinutes: number
}

function initialState(): State {
  return {
    products: clone(initialProducts),
    brands: clone(initialBrands),
    vendors: clone(initialVendors),
    applications: clone(applicationQueue),
    outbox: clone(initialOutbox),
    olderDelivered,
    delivered24h: initialDelivered24h,
    rejectedToday: 0,
    ...initialStats,
  }
}

let state = initialState()

/** Test helper: start again from the wireframe data. */
export function resetMock() {
  state = initialState()
}

const pad = (n: number) => n.toString().padStart(2, '0')
const clock = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const todayAt = () => `today, ${clock()}`
const nowLabel = () => `Today, ${clock()}`

function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))
}

function enqueue(name: OutboxEventName, item: string, key: string, actor: string, payload: Record<string, unknown>) {
  const seq = Math.min(0, ...state.outbox.map(e => e.seq)) - 1
  state.outbox.push({
    id: uuid(), seq, name, version: 1, item, status: 'waiting', tries: 0, maxTries: 8, lastLabel: null,
    idempotencyKey: key, approvedBy: `${actor} · ${todayAt()}`, payload,
  })
}

/* ---------- Queue ---------- */

const productTypeLabel = (p: ProductSubmission) =>
  p.change === 'resubmission' ? `Resubmission #${p.resubmission ?? 1}` : p.change === 'edit' ? 'Edit to live product' : 'New product'

const brandFieldLabels: Record<string, string> = { cover: 'cover', logo: 'logo', name: 'name', tagline: 'tagline', location: 'location', dispatch: 'dispatch time', story: 'story', returnPolicy: 'return policy' }

export function changedBrandFields(b: Pick<BrandSubmission, 'live' | 'draft'>) {
  const keys = Object.keys(b.draft) as Array<keyof BrandSubmission['draft']>
  if (!b.live) return keys
  const live = b.live
  return keys.filter(k => live[k] !== b.draft[k])
}

function buildQueue(): QueueItem[] {
  const items: QueueItem[] = []
  for (const p of state.products) {
    if (p.status !== 'pending') continue
    items.push({
      id: p.id, kind: 'product', title: p.title, subtitle: `${p.change === 'edit' ? 'Product edit' : 'Product'} · ${p.sku}`, vendorId: p.vendorId, vendorName: p.vendorName,
      sku: p.sku, submittedLabel: p.queueSubmitted, submittedDay: p.submittedDay, waitingMinutes: p.waitingMinutes, typeLabel: productTypeLabel(p),
      resubmission: p.change === 'resubmission', seq: p.seq,
    })
  }
  for (const b of state.brands) {
    if (b.status !== 'pending') continue
    items.push({
      id: b.id, kind: 'brand_page', title: 'Brand page draft', subtitle: `Brand page · ${changedBrandFields(b).map(k => brandFieldLabels[k]).join(', ')}`,
      vendorId: b.vendorId, vendorName: b.vendorName, sku: null, submittedLabel: b.queueSubmitted, submittedDay: b.submittedDay, waitingMinutes: b.waitingMinutes,
      typeLabel: b.live ? 'Edit to live page' : 'New brand page', resubmission: false, seq: b.seq,
    })
  }
  for (const v of state.vendors) {
    if (v.status !== 'applied' && v.status !== 'under_review') continue
    const q = state.applications[v.id] ?? { seq: 100, waitingMinutes: 0, submittedDay: 'today' as const, queueSubmitted: v.appliedLabel }
    items.push({
      id: v.id, kind: 'application', title: v.brand, subtitle: 'Vendor application', vendorId: null, vendorName: null, sku: null,
      submittedLabel: q.queueSubmitted, submittedDay: q.submittedDay, waitingMinutes: q.waitingMinutes, typeLabel: 'New application', resubmission: false, seq: q.seq,
    })
  }
  return items.sort((a, b) => a.seq - b.seq)
}

function decide(outcome: 'approved' | 'sent_back', actor: string, extra: Partial<Decision> = {}): Decision {
  if (outcome === 'approved') state.approvedToday += 1
  else state.sentBackToday += 1
  return { outcome, by: actor, at: todayAt(), ...extra }
}

/* ---------- API ---------- */

export const api = {
  async getQueue(): Promise<QueueResponse> {
    await wait()
    const items = buildQueue()
    return clone({
      items,
      stats: {
        waiting: items.length,
        oldestMinutes: Math.max(0, ...items.map(i => i.waitingMinutes)),
        decidedToday: state.approvedToday + state.sentBackToday + state.rejectedToday,
        approvedToday: state.approvedToday,
        sentBackToday: state.sentBackToday,
        rejectedToday: state.rejectedToday,
        medianDecisionMinutes: state.medianDecisionMinutes,
        resubmissionsWaiting: items.filter(i => i.resubmission).length,
      },
    })
  },

  async getProduct(id: string): Promise<ProductSubmission> {
    await wait()
    const p = state.products.find(x => x.id === id)
    if (!p) throw new ApiError('not_found', 'This submission does not exist or was withdrawn by the vendor.')
    return clone(p)
  },

  async decideProduct(input: ProductDecisionInput, actor: string): Promise<ProductSubmission> {
    await wait(350)
    const p = state.products.find(x => x.id === input.id)
    if (!p) throw new ApiError('not_found', 'This submission no longer exists.')
    if (p.status !== 'pending') throw new ApiError('invalid_transition', `This product was already ${p.status === 'approved' ? 'approved' : 'sent back'} by ${p.decision?.by ?? 'another reviewer'}.`)
    if (input.outcome === 'sent_back' && (input.message ?? '').trim().length < 10) throw new ApiError('validation_error', 'Write a message of at least 10 characters.')
    p.status = input.outcome
    p.decision = decide(input.outcome, actor, { checklist: input.checklist, reasons: input.reasons, message: input.message?.trim() })
    if (input.outcome === 'approved') {
      enqueue('product.published', p.title, `product:${p.sku}:rev-${(p.resubmission ?? 0) + 1}`, actor, { product_id: p.sku, vendor_id: p.vendorId, title: p.title, version: 1 })
    }
    return clone(p)
  },

  async getBrand(id: string): Promise<BrandSubmission> {
    await wait()
    const b = state.brands.find(x => x.id === id)
    if (!b) throw new ApiError('not_found', 'This brand page submission does not exist.')
    return clone(b)
  },

  async decideBrand(input: BrandDecisionInput, actor: string): Promise<BrandSubmission> {
    await wait(350)
    const b = state.brands.find(x => x.id === input.id)
    if (!b) throw new ApiError('not_found', 'This brand page submission no longer exists.')
    if (b.status !== 'pending') throw new ApiError('invalid_transition', 'This brand page was already decided.')
    if (input.outcome === 'sent_back' && (input.message ?? '').trim().length < 10) throw new ApiError('validation_error', 'Write a message of at least 10 characters.')
    b.status = input.outcome
    b.decision = decide(input.outcome, actor, { checklist: input.checklist, reasons: input.reasons, message: input.message?.trim() })
    if (input.outcome === 'approved') {
      b.live = clone(b.draft)
      b.livePublishedLabel = 'today'
      enqueue('brand_profile.published', b.vendorName, `brand_profile:${b.vendorId}:${b.id}`, actor, { vendor_id: b.vendorId, name: b.draft.name, version: 1 })
    }
    return clone(b)
  },

  async listVendors(): Promise<Vendor[]> {
    await wait()
    return clone(state.vendors)
  },

  async getVendor(id: string): Promise<Vendor> {
    await wait()
    const v = state.vendors.find(x => x.id === id)
    if (!v) throw new ApiError('not_found', 'No vendor or application with this id.')
    return clone(v)
  },

  /** Opening an application claims it, so two reviewers don't pick the same one (A-08 notes). */
  async openApplication(id: string, actor: string): Promise<Vendor> {
    await wait(120)
    const v = state.vendors.find(x => x.id === id)
    if (!v) throw new ApiError('not_found', 'No vendor or application with this id.')
    if (v.status === 'applied') {
      v.status = 'under_review'
      v.activity.unshift({ title: `Opened for review by ${actor}`, at: nowLabel(), transition: 'applied → under_review' })
    }
    return clone(v)
  },

  async requestInfo(input: VendorReasonInput, actor: string): Promise<Vendor> {
    await wait(300)
    const v = state.vendors.find(x => x.id === input.id)
    if (!v) throw new ApiError('not_found', 'No vendor or application with this id.')
    if (v.status !== 'under_review' && v.status !== 'applied') throw new ApiError('invalid_transition', 'Only an open application can be asked for more info.')
    if (input.message.trim().length < 10) throw new ApiError('validation_error', 'Write a message of at least 10 characters.')
    if (v.status === 'applied') v.activity.unshift({ title: `Opened for review by ${actor}`, at: nowLabel(), transition: 'applied → under_review' })
    v.status = 'under_review'
    v.activity.unshift({ title: `More info requested by ${actor}`, at: nowLabel(), quote: `“${input.message.trim()}”` })
    return clone(v)
  },

  async rejectVendor(input: VendorReasonInput, actor: string): Promise<Vendor> {
    await wait(300)
    const v = state.vendors.find(x => x.id === input.id)
    if (!v) throw new ApiError('not_found', 'No vendor or application with this id.')
    if (v.status !== 'under_review' && v.status !== 'applied') throw new ApiError('invalid_transition', 'Only an open application can be rejected.')
    if (input.message.trim().length < 10) throw new ApiError('validation_error', 'Write a reason of at least 10 characters.')
    const from = v.status
    v.status = 'rejected'
    v.statusReason = input.message.trim()
    v.sinceLabel = 'Today'
    v.activity.unshift({ title: `Rejected by ${actor}`, at: nowLabel(), quote: `“${input.message.trim()}”`, transition: `${from} → rejected` })
    state.rejectedToday += 1
    return clone(v)
  },

  async approveVendor(input: ApproveVendorInput, actor: string): Promise<Vendor> {
    await wait(400)
    const v = state.vendors.find(x => x.id === input.id)
    if (!v) throw new ApiError('not_found', 'No vendor or application with this id.')
    if (v.status !== 'under_review' && v.status !== 'applied') throw new ApiError('invalid_transition', 'Only an open application can be approved.')
    if (!(input.commissionPct >= 0 && input.commissionPct <= 50)) throw new ApiError('validation_error', 'Commission must be between 0% and 50%.')
    if (state.vendors.some(o => o.id !== v.id && (o.ownerLogin === input.ownerLogin || o.email === input.ownerLogin))) {
      throw new ApiError('conflict', 'Another vendor already uses this email for their login.')
    }
    const from = v.status
    v.status = 'approved'
    v.commissionPct = input.commissionPct
    v.ownerLogin = input.ownerLogin
    v.liveCount = 0
    v.sinceLabel = 'Today'
    v.activity.unshift(
      { title: `Invite sent to ${input.ownerLogin}`, at: nowLabel() },
      { title: `Approved by ${actor} · commission ${input.commissionPct}%`, at: nowLabel(), transition: `${from} → approved` },
    )
    state.approvedToday += 1
    enqueue('vendor.status_changed', `${v.brand} · approved`, `vendor:${v.id}:approved`, actor, { vendor_id: v.id, status: 'approved', commission_bps: input.commissionPct * 100, version: 1 })
    return clone(v)
  },

  async suspendVendor(input: VendorReasonInput, actor: string): Promise<Vendor> {
    await wait(300)
    const v = state.vendors.find(x => x.id === input.id)
    if (!v) throw new ApiError('not_found', 'No vendor with this id.')
    if (v.status !== 'approved') throw new ApiError('invalid_transition', 'Only an approved vendor can be suspended.')
    if (input.message.trim().length < 10) throw new ApiError('validation_error', 'Write a reason of at least 10 characters.')
    v.status = 'suspended'
    v.statusReason = input.message.trim()
    v.activity.unshift({ title: `Suspended by ${actor}`, at: nowLabel(), quote: `“${input.message.trim()}”`, transition: 'approved → suspended' })
    enqueue('vendor.status_changed', `${v.brand} · suspended`, `vendor:${v.id}:suspended:${v.activity.length}`, actor, { vendor_id: v.id, status: 'suspended', version: 1 })
    return clone(v)
  },

  async reactivateVendor(id: string, actor: string): Promise<Vendor> {
    await wait(300)
    const v = state.vendors.find(x => x.id === id)
    if (!v) throw new ApiError('not_found', 'No vendor with this id.')
    if (v.status !== 'suspended') throw new ApiError('invalid_transition', 'Only a suspended vendor can be reactivated.')
    v.status = 'approved'
    v.statusReason = undefined
    v.activity.unshift({ title: `Reactivated by ${actor}`, at: nowLabel(), transition: 'suspended → approved' })
    enqueue('vendor.status_changed', `${v.brand} · approved`, `vendor:${v.id}:approved:${v.activity.length}`, actor, { vendor_id: v.id, status: 'approved', version: 1 })
    return clone(v)
  },

  async getOutbox(): Promise<OutboxSummary> {
    await wait()
    const rank = { failed: 0, retrying: 1, waiting: 2, delivered: 3 } as const
    const events = [...state.outbox].sort((a, b) => rank[a.status] - rank[b.status] || a.seq - b.seq)
    const count = (s: OutboxEvent['status']) => state.outbox.filter(e => e.status === s).length
    const delivered = count('delivered') + state.olderDelivered
    return clone({
      events,
      counts: { all: state.outbox.length + state.olderDelivered, waiting: count('waiting'), retrying: count('retrying'), failed: count('failed'), delivered },
      delivered24h: state.delivered24h,
      medianDeliverySeconds: 1.8,
    })
  },

  /** Safe to repeat: the idempotency key makes the central app ignore a duplicate (A-10 notes). */
  async retryEvents(ids: string[]): Promise<number> {
    await wait(300)
    let n = 0
    for (const e of state.outbox) {
      if (!ids.includes(e.id) || (e.status !== 'failed' && e.status !== 'retrying')) continue
      e.status = 'waiting'
      e.tries = 0
      e.nextTryLabel = undefined
      n += 1
    }
    if (n === 0) throw new ApiError('invalid_transition', 'Nothing to retry: the event is already queued or delivered.')
    return n
  },
}

export type Api = typeof api
