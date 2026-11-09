// Contract of vendor-api's admin endpoints (docs/05-api-design.md §6) as the vendor-admin module
// uses it. The in-memory mock in mock.ts implements it until the endpoints ship.

/* ---------- Review queue (GET /api/v1/admin/queue) ---------- */

export type QueueKind = 'product' | 'brand_page' | 'application'

export interface QueueItem {
  /** Product or brand submission id; for an application, the vendor id. */
  id: string
  kind: QueueKind
  title: string
  /** "Product · KS-AJR-014", "Brand page · cover, story", "Vendor application". */
  subtitle: string
  vendorId: string | null
  /** Null for vendor applications (shown as an em dash). */
  vendorName: string | null
  sku: string | null
  submittedLabel: string
  submittedDay: 'today' | 'yesterday' | 'earlier'
  waitingMinutes: number
  /** "New product", "Resubmission #2", "Edit to live page", "New application". */
  typeLabel: string
  resubmission: boolean
  /** Queue order, oldest first. */
  seq: number
}

export interface QueueStats {
  waiting: number
  oldestMinutes: number
  decidedToday: number
  approvedToday: number
  sentBackToday: number
  rejectedToday: number
  medianDecisionMinutes: number
  resubmissionsWaiting: number
}

export interface QueueResponse {
  items: QueueItem[]
  stats: QueueStats
}

/* ---------- Decisions ---------- */

export interface Decision {
  outcome: 'approved' | 'sent_back'
  by: string
  at: string
  reasons?: string[]
  message?: string
  checklist?: string[]
}

export type ReviewStatus = 'pending' | 'approved' | 'sent_back'

/* ---------- Product review (A-05) ---------- */

export type ProductChange = 'new' | 'resubmission' | 'edit'

export interface ProductField {
  field: string
  /** Value in the version compared against (sent back or live); null for a new product. */
  before: string | null
  after: string
}

export interface ProductSubmission {
  id: string
  sku: string
  title: string
  vendorId: string
  vendorName: string
  change: ProductChange
  resubmission?: number
  submittedLabel: string
  /** Why this needs a closer look, appended to the header line. */
  note?: string
  photos: Array<{ label: string; isNew?: boolean }>
  description: string
  fields: ProductField[]
  previousDecision?: { by: string; at: string; message: string }
  status: ReviewStatus
  decision?: Decision
}

export interface ProductDecisionInput {
  id: string
  outcome: 'approved' | 'sent_back'
  checklist: string[]
  reasons?: string[]
  message?: string
}

/* ---------- Brand page review (A-07) ---------- */

export interface BrandPageFields {
  /** Image ids; a different id means a new image. */
  cover: string
  logo: string
  name: string
  tagline: string
  location: string
  dispatch: string
  story: string
  returnPolicy: string
}

export type BrandFieldKey = keyof BrandPageFields

export interface BrandSubmission {
  id: string
  vendorId: string
  vendorName: string
  submittedLabel: string
  livePublishedLabel: string | null
  live: BrandPageFields | null
  draft: BrandPageFields
  status: ReviewStatus
  decision?: Decision
}

export interface BrandDecisionInput {
  id: string
  outcome: 'approved' | 'sent_back'
  checklist: string[]
  reasons?: string[]
  message?: string
}

/* ---------- Vendors (A-08, A-09) ---------- */

export type VendorStatus = 'applied' | 'under_review' | 'approved' | 'rejected' | 'suspended'

export interface ActivityEntry {
  title: string
  at: string
  quote?: string
  /** "applied → under_review" */
  transition?: string
}

export interface Vendor {
  id: string
  applicationRef: string
  brand: string
  initials: string
  city: string
  categories: string[]
  owner: string
  phone: string
  email: string
  instagram: string
  priceRange: string
  about: string
  liveCount: number | null
  status: VendorStatus
  sinceLabel: string
  appliedLabel: string
  commissionPct: number | null
  checks: Array<{ ok: boolean; text: string }>
  activity: ActivityEntry[]
  ownerLogin?: string
  statusReason?: string
  seq: number
}

export interface ApproveVendorInput {
  id: string
  commissionPct: number
  ownerLogin: string
}

export interface VendorReasonInput {
  id: string
  reasons?: string[]
  message: string
}

/* ---------- Publishing outbox (A-10) ---------- */

export type OutboxStatus = 'waiting' | 'retrying' | 'failed' | 'delivered'
export type OutboxEventName = 'product.published' | 'product.unpublished' | 'brand_profile.published' | 'vendor.status_changed'

export interface OutboxEvent {
  id: string
  name: OutboxEventName
  version: number
  item: string
  status: OutboxStatus
  tries: number
  maxTries: number
  lastLabel: string | null
  nextTryLabel?: string
  idempotencyKey: string
  approvedBy: string
  response?: { at: string; status: number; body: string }
  payload: Record<string, unknown>
  /** What ops should do about it, when the publisher can tell. */
  hint?: string
  seq: number
}

export interface OutboxSummary {
  events: OutboxEvent[]
  counts: Record<OutboxStatus | 'all', number>
  delivered24h: number
  medianDeliverySeconds: number
}

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}
