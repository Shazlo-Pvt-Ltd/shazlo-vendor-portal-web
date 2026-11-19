import type { Revision } from './form'
import type { ProductDetail } from './status'

export interface EditingState {
  /** The revision the form starts from: the one being edited or reviewed, else the live one. */
  source: Revision | null
  live: Revision | null
  archived: boolean
  /** A version is waiting for a decision: the form is read-only until then. */
  inReview: boolean
  /** The last version was not approved: its reason, and the form starts from it so it can be fixed. */
  rejected: { version: number; reason: string | null } | null
  /** There are saved changes nobody has submitted yet, so Submit works without editing first. */
  unsubmitted: boolean
  readOnly: boolean
}

/**
 * How the product page behaves for a product from the API. `working` is the revision being edited
 * or reviewed (or the last rejected one) and is never what shoppers see; `live` is.
 */
export function editingState(product: ProductDetail): EditingState {
  const { working, live } = product
  const archived = product.status === 'archived'
  const inReview = working?.state === 'in_review'
  const rejected = working?.state === 'rejected' ? { version: working.version, reason: working.review?.reason ?? null } : null
  return {
    source: working ?? live,
    live,
    archived,
    inReview,
    rejected,
    unsubmitted: working?.state === 'editing',
    readOnly: archived || inReview,
  }
}
