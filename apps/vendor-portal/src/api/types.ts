// Shapes follow the vendor-api contract planned in ROADMAP Phases 2–3 (vendors, brand_profiles
// draft/published, products with review states, assets, reviews, bulk import report).

export type ProductStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived'
export type VendorStatus = 'applied' | 'under_review' | 'approved' | 'rejected' | 'suspended'
export type Gender = 'women' | 'men' | 'unisex'

export interface SessionUser {
  id: string
  name: string
  initials: string
  email: string
  role: 'owner' | 'staff'
}

export interface Vendor {
  id: string
  brandName: string
  initials: string
  status: VendorStatus
  approvedAt?: string
  city: string
  commissionPct: number
}

export interface Session {
  user: SessionUser
  vendor: Vendor
}

export interface ProductImage {
  id: string
  slot: 'front' | 'back' | 'detail' | 'extra'
  url?: string
  name?: string
}

export interface SizeStock {
  size: string
  sku: string
  stock: number
}

export interface ReviewDecision {
  id: string
  /** What was reviewed. */
  subject: { kind: 'product'; productId: string; title: string; sku: string } | { kind: 'brand_page'; title: string }
  outcome: 'approved' | 'rejected'
  /** Reviewer's reason, shown verbatim. Reviewers are never named, only "Shazlo review team". */
  reason?: string
  /** Fields the reviewer flagged, for highlighting in the editor. */
  fields?: string[]
  decidedAt: string
  submittedAt: string
  /** Approved items only: when the central app confirmed it is live. Until then the item shows "Publishing" (V-09). */
  liveAt?: string
}

export interface Product {
  id: string
  title: string
  sku: string
  category: string
  gender: Gender
  fabric: string
  description: string
  price: number | null
  mrp: number | null
  sizes: SizeStock[]
  images: ProductImage[]
  status: ProductStatus
  /** An approved product with an edit waiting for review; the live version stays up meanwhile. */
  pendingEdit?: boolean
  returnable: boolean
  returnDays: number
  weightGrams: number | null
  updatedAt: string
  submittedAt?: string
  lastDecision?: ReviewDecision
}

export interface BrandProfileFields {
  brandName: string
  tagline: string
  logoUrl?: string
  coverUrl?: string
  story: string
  city: string
  instagram: string
  website: string
  shipsIn: string
  returnPolicy: string
  categories: string[]
}

export interface BrandProfile {
  published: BrandProfileFields | null
  draft: BrandProfileFields
  publishedAt?: string
  /** Fields in the draft that differ from the published version. */
  changedFields: Array<keyof BrandProfileFields>
  status: 'live' | 'draft_changes' | 'pending_review' | 'rejected'
  /** When the draft was sent for review (status pending_review). */
  submittedAt?: string
  lastDecision?: ReviewDecision
}

export interface OverviewSummary {
  counts: { live: number; pending: number; sentBack: number; drafts: number; total: number }
  recentDecisions: ReviewDecision[]
  checklist: Array<{ id: string; label: string; done: boolean }>
}

export interface Submission {
  id: string
  subject: ReviewDecision['subject']
  submittedAt: string
  /** Pending submissions have no decision yet. */
  decision?: ReviewDecision
}

export interface ImportRowError {
  row: number
  product: string
  column: string
  message: string
}

export interface ImportReport {
  fileName: string
  totalRows: number
  validRows: number
  errors: ImportRowError[]
  uploadedAt: string
}

export interface ApplicationInput {
  brandName: string
  ownerName: string
  phone: string
  email: string
  city: string
  instagram: string
  productTypes: string[]
  priceRange: string
  about: string
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public field?: string) {
    super(message)
  }
}
