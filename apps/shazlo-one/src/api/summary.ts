import type { components as IdentityComponents } from './identity'
import type { components } from './vendor-api'

// What vendor-api's `GET /v1/admin/summary` answers (generated types), and what the screens read.
// The screens keep their shape; this is the one place that knows both (#299).
type Wire = components['schemas']['AdminSummaryOut']
type WireDecision = Wire['recent'][number]
export type AdminNames = IdentityComponents['schemas']['AdminNames']

// Shown where an admin's name cannot be found: the admin was deleted, or identity-api did not answer.
export const FORMER_ADMIN = 'a former admin'

export type HomeDecision = {
  id: string
  kind: WireDecision['kind']
  /** The review to open, for a product or brand page */
  reviewId: string | null
  /** The product's id for a product; the vendor's id for everything else */
  subjectId: string
  title: string
  vendor: { id: string; name: string }
  decision: WireDecision['decision']
  at: string
  reviewer: string
}

export type HomeSummary = {
  queue: { all: number; product: number; brand_page: number; application: number; over_24h: number }
  decided_today: number
  median_minutes: number | null
  resubmissions: number
  commission_proposals: number
  publishing: { waiting: number; retrying: number; failed: number; delivered_24h: number }
  recent: HomeDecision[]
}

/** The admin ids a summary names, once each: what to ask identity-api for. */
export function reviewerIds(wire: Wire): string[] {
  return [...new Set(wire.recent.flatMap((d) => (d.reviewer_id ? [d.reviewer_id] : [])))]
}

/** The summary as the screens read it. `names` maps an admin id to a display name; an id without one
 * (a deleted admin, a lookup that failed) reads "a former admin" rather than hiding the decision. */
export function toHomeSummary(wire: Wire, names: ReadonlyMap<string, string>): HomeSummary {
  const { waiting, decisions, publishing } = wire
  return {
    queue: { all: waiting.product + waiting.brand_page + waiting.application, product: waiting.product, brand_page: waiting.brand_page, application: waiting.application, over_24h: waiting.over_24h },
    decided_today: decisions.decided_today,
    median_minutes: decisions.median_minutes ?? null,
    resubmissions: wire.resubmissions,
    commission_proposals: wire.commission_proposals,
    publishing: { waiting: publishing.waiting, retrying: publishing.retrying, failed: publishing.failed, delivered_24h: publishing.delivered_24h },
    recent: wire.recent.map((d) => ({
      id: d.id,
      kind: d.kind,
      reviewId: d.review_id ?? null,
      subjectId: d.subject_id,
      title: d.title,
      vendor: { id: d.vendor_id, name: d.vendor_name },
      decision: d.decision,
      at: d.at,
      reviewer: (d.reviewer_id && names.get(d.reviewer_id)) || FORMER_ADMIN,
    })),
  }
}
