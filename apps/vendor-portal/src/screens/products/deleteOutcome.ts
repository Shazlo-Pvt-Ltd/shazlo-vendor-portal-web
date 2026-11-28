import type { Schemas } from '../../api/model'
import { productsCopy } from '../../copy/products'

const copy = productsCopy.deleteDialog

/**
 * What deleting a product does (main's rules), which the confirmation says before it happens:
 * - `removed`: never sent for review, so vendor-api erases it.
 * - `archived`: sent at some point, so it is kept and moves to Archived; a live one leaves the app.
 * - `blocked`: something is in review, so vendor-api refuses (`409 product_in_review`).
 * - `unknown`: a draft the portal has not read in full (a list row): the confirmation explains both.
 * - `none`: already archived.
 */
export type DeleteOutcome = 'removed' | 'archived' | 'blocked' | 'unknown' | 'none'

/** A list row (status only) or a product read in full (`live` and `working` present). */
export type Deletable = Pick<Schemas['Product'], 'status'> & {
  edit_in_review?: boolean
  live?: Schemas['ProductVersion'] | null
  working?: Schemas['WorkingVersion'] | null
}

/**
 * vendor-api does not say whether a product was ever sent (it decides from its history), so this
 * works it out: a version after the first exists only once an earlier one was sent (a sent-back
 * product being reworked), and a live version or a sent date means it was sent.
 */
export function deleteOutcome(product: Deletable): DeleteOutcome {
  if (product.edit_in_review || product.working?.state === 'in_review') return 'blocked'
  switch (product.status) {
    case 'approved':
    case 'rejected':
      return 'archived'
    case 'pending_review':
      return 'blocked'
    case 'draft': {
      if (product.working === undefined) return 'unknown'
      const { live, working } = product
      if (live || working?.submitted_at || (working?.version ?? 1) > 1) return 'archived'
      return 'removed'
    }
    default:
      return 'none'
  }
}

export interface DeleteText {
  title: string
  body: string
  /** The confirm button; null when there is nothing to confirm (blocked). */
  confirm: string | null
}

export function deleteText(name: string, outcome: DeleteOutcome, status: Schemas['ProductStatus']): DeleteText {
  switch (outcome) {
    case 'removed':
      return { title: copy.removed.title(name), body: copy.removed.body, confirm: copy.removed.confirm }
    case 'archived':
      return { title: copy.archived.title(name), body: copy.archived.body(status === 'approved'), confirm: copy.archived.confirm }
    case 'blocked':
      return { title: copy.blocked.title(name), body: copy.blocked.body, confirm: null }
    default:
      return { title: copy.unknown.title(name), body: copy.unknown.body, confirm: copy.unknown.confirm }
  }
}

/** The words for archiving a selection: what happens to each kind of product in it. */
export function bulkDeleteText(products: readonly Deletable[]): { title: string; body: string } {
  const outcomes = products.map(deleteOutcome)
  const blocked = outcomes.filter((o) => o === 'blocked').length
  const drafts = outcomes.some((o) => o === 'unknown' || o === 'removed')
  const archived = outcomes.some((o) => o === 'archived' || o === 'unknown')
  const live = products.some((p, i) => p.status === 'approved' && outcomes[i] === 'archived')
  const body = [archived && copy.bulk.archived, live && copy.bulk.live, drafts && copy.bulk.drafts, blocked > 0 && copy.bulk.blocked(blocked)].filter(Boolean).join(' ')
  return { title: copy.bulk.title(products.length, drafts), body }
}
