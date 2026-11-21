/**
 * Review decisions: vendor-api lists every submission (`/v1/vendor/submissions`) by code and
 * version; Build 2's Review status page shows review items that link to the product, with a
 * thumbnail and the reviewer's reason.
 */
import type { ReviewItem, Submission, SubmissionStatus } from '../model'
import type { SubmissionIn } from '../wire'
import { isoOrNull, oneOf, textOrNull } from './common'

export const BRAND_PAGE_TITLE = 'Brand page'

const STATE: Record<string, ReviewItem['state']> = { pending: 'waiting', rejected: 'rejected', approved: 'approved' }

export interface ReviewContext {
  /** Products by id, or by code (as sent, or in lower case: codes ignore case): their id and front photo. */
  products: ReadonlyMap<string, { id: string; thumbnail: string | null }>
  brandThumbnail: string | null
}

/** A submission as a review item; null for one Build 2 does not show (withdrawn, or a status it does not know). */
export function reviewItemFromSubmission(s: SubmissionIn, context: ReviewContext): ReviewItem | null {
  const state = STATE[String(s.status)]
  if (!state) return null
  const code = textOrNull(s.sku)
  // vendor-api with the proposal names the product; without it, the product is found by its code.
  const productId = textOrNull(s.product_id)
  const product = (productId ? context.products.get(productId) : undefined) ?? (code ? (context.products.get(code) ?? context.products.get(code.toLowerCase())) : undefined)
  const subject: ReviewItem['subject'] =
    s.subject === 'brand_profile'
      ? { type: 'brand_page', id: 'brand', title: BRAND_PAGE_TITLE, thumbnail_url: context.brandThumbnail }
      : { type: 'product', id: productId ?? product?.id ?? '', title: textOrNull(s.title) ?? code ?? '', ...(code ? { detail: code } : {}), thumbnail_url: product?.thumbnail ?? null }
  const decided = isoOrNull(s.decided_at)
  const reason = textOrNull(s.reason)
  return {
    id: String(s.id),
    subject,
    // vendor-api with the proposal says whether a product was live; otherwise (and for the brand page) a later version is an edit.
    kind: (s.subject !== 'brand_profile' && typeof s.was_live === 'boolean' ? s.was_live : Number(s.version) > 1) ? 'edit' : 'new',
    state,
    submitted_at: String(s.submitted_at ?? ''),
    ...(decided && state !== 'waiting' ? { decided_at: decided } : {}),
    ...(reason && state === 'rejected' ? { reason } : {}),
  }
}

/** The `status` filter vendor-api takes for one of Build 2's review states. */
export function reviewStateToStatus(state: ReviewItem['state'] | undefined): 'pending' | 'rejected' | 'approved' | 'all' {
  if (state === 'waiting') return 'pending'
  return state ?? 'all'
}

const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const satisfies readonly SubmissionStatus[]

export function submissionFromApi(s: SubmissionIn): Submission {
  return {
    id: String(s.id),
    subject: s.subject === 'brand_profile' ? 'brand_profile' : 'product',
    code: textOrNull(s.sku),
    productId: textOrNull(s.product_id),
    title: textOrNull(s.title),
    version: Number.isInteger(s.version) ? s.version : 0,
    // An unknown status is shown as still waiting: nothing has been decided that the portal understands.
    status: oneOf(SUBMISSION_STATUSES, s.status) ?? 'pending',
    reason: textOrNull(s.reason),
    submittedAt: String(s.submitted_at ?? ''),
    decidedAt: isoOrNull(s.decided_at),
  }
}
