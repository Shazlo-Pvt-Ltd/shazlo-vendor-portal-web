import type * as M from '../model'
import type { components } from '../schema'
import { colourOf } from '../../lib/swatch'

// vendor-api's `GET /v1/admin/reviews/{review_id}` (services/vendor-api/vendor_api/api/admin_reviews.py)
// as the two review screens read it. The server's detail is one shape for every kind of review with a
// free-form `content`; this is where it becomes a product review or a brand page review, and where
// what the server does not keep yet (named photo slots, try-on photos, stock, #288) is left empty.
type Detail = components['schemas']['ReviewDetailOut']
type Version = components['schemas']['VersionOut']
type Rec = Record<string, unknown>

const NEEDS_NAME = '—'
const REVIEWER = 'Reviewer'
const SELLER = 'The seller'

const rec = (value: unknown): Rec => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export type ReviewStatus = M.ProductReview['status']

/** The review's status as the screens name it ("pending" is "pending_review"); an unknown one is treated as waiting. */
export function toStatus(status: string): ReviewStatus {
  if (status === 'approved' || status === 'rejected' || status === 'withdrawn') return status
  return 'pending_review'
}

const GENDERS = ['women', 'men', 'unisex'] as const

// ---- Product -------------------------------------------------------------------------------------

export function toProductVersion(content: Rec): M.ProductVersion {
  const variants = list(content.variants).map(rec).filter((v) => v.is_active !== false)
  // The colours are the variants' colours, in the order they first appear.
  const names = [...new Set(variants.map((v) => text(v.color).trim()).filter(Boolean))]
  const cheapest = variants.reduce<Rec | null>((best, v) => {
    const price = num(v.price_paise)
    return price !== null && (best === null || price < (num(best.price_paise) ?? Infinity)) ? v : best
  }, null)
  const sizes = new Set<string>()
  const gender = text(content.gender)
  return {
    title: text(content.title),
    description: text(content.description),
    gender: (GENDERS as readonly string[]).includes(gender) ? (gender as M.ProductVersion['gender']) : 'unisex',
    product_type: text(content.subcategory) || text(content.category),
    main_colour: names[0] ? colourOf(names[0]) : { name: NEEDS_NAME, hex: colourOf('').hex },
    other_colours: names.slice(1).map(colourOf),
    material: text(content.fabric),
    price_paise: cheapest ? (num(cheapest.price_paise) ?? 0) : 0,
    mrp_paise: cheapest ? num(cheapest.mrp_paise) : null,
    // One row per size and colour would repeat the size; the sizes table lists each SKU once.
    variants: variants
      .filter((v) => text(v.sku))
      .map((v) => ({ size: text(v.size), sku: text(v.sku), stock: null }))
      .filter((v) => !sizes.has(v.sku) && sizes.add(v.sku)),
    photos: list(content.images)
      .map(rec)
      .filter((image) => text(image.url))
      .sort((a, b) => (num(a.position) ?? 0) - (num(b.position) ?? 0))
      .map((image, i) => ({ id: text(image.asset_id) || `photo-${i + 1}`, url: text(image.url), slot: null })),
    try_on_photos: null,
    size_chart: null,
  }
}

function historyOf(detail: Detail): M.History {
  const out: M.History = []
  for (const e of detail.events) {
    const at = e.created_at
    switch (e.action) {
      case 'submitted':
        out.push({ at, event: 'submitted', by: detail.submitted_by_email || SELLER })
        break
      case 'approved':
        out.push({ at, event: 'approved', by: REVIEWER })
        break
      case 'rejected':
        out.push({ at, event: 'rejected', by: REVIEWER, ...(e.reason ? { note: e.reason } : {}) })
        break
      case 'withdrawn':
        out.push({ at, event: 'withdrawn', by: SELLER })
        break
      default:
        // `reopened` and anything a newer server adds: not something the page can say.
        break
    }
  }
  return out
}

export type Neighbours = { prev: M.ReviewRef | null; next: M.ReviewRef | null }
export const NO_NEIGHBOURS: Neighbours = { prev: null, next: null }

const asProduct = (detail: Detail): boolean => detail.subject === 'product'

/** A product review. `null` when the review is not a product's (the page is the wrong one for it). */
export function toProductReview(detail: Detail, nav: Neighbours = NO_NEIGHBOURS): M.ProductReview | null {
  if (!asProduct(detail)) return null
  const base = detail.base ? toProductVersion(detail.base.content) : null
  return {
    id: detail.id,
    version: detail.content.version,
    sku: detail.sku ?? '',
    status: toStatus(detail.status),
    vendor: { id: detail.vendor.id, name: detail.vendor.name.trim() || 'Unnamed vendor' },
    submitted_at: detail.submitted_at,
    resubmission: Math.max(0, Math.trunc(detail.resubmission ?? 0)),
    submitted: toProductVersion(detail.content.content),
    compare_to: base,
    // The server compares with the version that went live; "the one sent back last time" is not offered yet.
    compare_label: base ? 'live' : null,
    history: historyOf(detail),
    prev: nav.prev,
    next: nav.next,
  }
}

// ---- Brand page ----------------------------------------------------------------------------------

/** What the brand page shows from the vendor's store details (returns and delivery live there). */
export type StorePolicies = { return_policy: string; dispatch_time: string }
export const NO_POLICIES: StorePolicies = { return_policy: '', dispatch_time: '' }

/** The returns window and delivery time of `GET /v1/admin/vendors/{id}/store-details` as the brand page's labels. */
export function toPolicies(details: components['schemas']['StoreDetailsOut'] | undefined): StorePolicies {
  const returns = rec(details?.returns)
  const delivery = rec(details?.delivery)
  const window = num(returns.window_days)
  // vendor-api's own delivery is {mode: "own", areas, delivery_days: "2_3"}; Shazlo's has no time of its own.
  const days = text(delivery.delivery_days)
  return {
    return_policy: window === null ? '' : window === 0 ? 'no_returns' : `${window}_day`,
    dispatch_time: days ? `${days}_days` : '',
  }
}

const handle = (value: unknown): string => {
  const raw = text(value).trim()
  return raw && !raw.startsWith('@') ? `@${raw}` : raw
}

const asset = (value: unknown): string | null => text(rec(value).url) || null

export function toBrandProfile(version: Version, policies: StorePolicies): M.BrandProfile {
  const c = version.content
  return {
    tagline: text(c.tagline),
    story: text(c.about),
    based_in: '',
    cover_url: asset(c.banner),
    logo_url: asset(c.logo),
    return_policy: policies.return_policy,
    dispatch_time: policies.dispatch_time,
    instagram: handle(c.instagram_handle),
    website: text(c.website_url),
  }
}

// The server's brand fields, named as the screen names them. Fields the screen has no row for
// (the brand name, categories, price range) are left out of the list of changes.
const BRAND_FIELD: Record<string, keyof M.BrandProfile> = {
  tagline: 'tagline',
  about: 'story',
  banner: 'cover_url',
  logo: 'logo_url',
  instagram_handle: 'instagram',
  website_url: 'website',
}

export function toBrandReview(detail: Detail, nav: Neighbours = NO_NEIGHBOURS, policies: StorePolicies = NO_POLICIES): M.BrandReview | null {
  if (asProduct(detail)) return null
  return {
    id: detail.id,
    version: detail.content.version,
    status: toStatus(detail.status),
    vendor: { id: detail.vendor.id, name: detail.vendor.name.trim() || 'Unnamed vendor' },
    submitted_at: detail.submitted_at,
    live: detail.base ? toBrandProfile(detail.base, policies) : null,
    draft: toBrandProfile(detail.content, policies),
    changed_fields: [...new Set(detail.changes.flatMap((c) => (BRAND_FIELD[c.field] ? [BRAND_FIELD[c.field]!] : [])))],
    history: historyOf(detail),
    prev: nav.prev,
    next: nav.next,
  }
}

// ---- A decision ----------------------------------------------------------------------------------

/** The answer to approve or send back. `next` is worked out by the page before the item left the queue. */
export function toDecision(detail: Detail, next: M.ReviewRef | null): M.Decision {
  return {
    id: detail.id,
    decision: detail.status === 'approved' ? 'approved' : 'rejected',
    at: detail.decided_at ?? new Date().toISOString(),
    next,
  }
}

// ---- Moving through the queue --------------------------------------------------------------------

/** Where to go once this review is decided and has left the queue: the item that came after it, else the oldest one still waiting. */
export function afterDecision(order: readonly M.QueueItem[], reviewId: string): M.ReviewRef | null {
  const { next } = neighboursIn(order, reviewId)
  if (next) return next
  const other = order.find((i) => i.kind !== 'application' && i.id !== reviewId)
  return other && other.kind !== 'application' ? { kind: other.kind, id: other.id } : null
}

/** The items on either side of a review in the queue's order (oldest first); applications are decided on their vendor, not here. */
export function neighboursIn(order: readonly M.QueueItem[], reviewId: string): Neighbours {
  const reviewable = order.filter((i): i is M.QueueItem & { kind: M.ReviewRef['kind'] } => i.kind !== 'application')
  const at = reviewable.findIndex((i) => i.id === reviewId)
  if (at === -1) return NO_NEIGHBOURS
  const ref = (i: (typeof reviewable)[number] | undefined): M.ReviewRef | null => (i ? { kind: i.kind, id: i.id } : null)
  return { prev: ref(reviewable[at - 1]), next: ref(reviewable[at + 1]) }
}

