import { statusLabel, type ProductDetail, type ProductSummary } from './status'

/**
 * What deleting a product does, which the confirmation must say before it happens.
 * - `removed`: never submitted, so it is erased for good.
 * - `archived`: submitted at some point, so it is kept as history, its SKU stays reserved, and a
 *   live one goes off sale.
 * - `blocked`: in review, so the server refuses (`409 product_in_review`).
 * - `unknown`: cannot be told from what the API shows; the confirmation explains both.
 */
export type DeleteOutcome = 'removed' | 'archived' | 'blocked' | 'unknown'

/**
 * The API does not say whether a product was ever submitted (the server decides from its revision
 * history), so this works it out from the status and, for a draft, from the product's detail:
 * - approved or rejected: it was submitted, so it is archived;
 * - in review: blocked;
 * - draft: a revision after the first only exists once an earlier one was submitted (a rejected
 *   product reworked), and a live version means it was submitted, so those are archived; a first
 *   revision that was never submitted is removed;
 * - a draft whose detail is not available: unknown.
 * If vendor-api exposed `ever_submitted`, this would not need to guess.
 */
export function deleteOutcome(product: Pick<ProductSummary, 'status'>, detail?: ProductDetail): DeleteOutcome {
  switch (product.status) {
    case 'approved':
    case 'rejected':
      return 'archived'
    case 'pending_review':
      return 'blocked'
    case 'draft': {
      if (!detail) return 'unknown'
      const working = detail.working
      if (detail.live != null || working?.submitted_at != null || (working?.version ?? 1) > 1) return 'archived'
      return 'removed'
    }
    default:
      // archived (nothing to delete) or a status this portal does not know
      return 'unknown'
  }
}

export interface ConfirmText {
  title: string
  message: string
  confirmLabel: string
  /** What to tell the vendor once it has happened. */
  done: string
}

/** The words of the confirmation, per outcome. The title always says which of the two it is. */
export function confirmText(product: Pick<ProductSummary, 'title' | 'sku' | 'status'>, outcome: DeleteOutcome): ConfirmText {
  const name = `"${product.title}" (${product.sku})`
  switch (outcome) {
    case 'removed':
      return {
        title: 'Delete this product for good?',
        message: `${name} has never been sent for review, so it will be deleted and cannot be brought back.`,
        confirmLabel: 'Delete product',
        done: `${product.title} was deleted.`,
      }
    case 'archived':
      return {
        title: 'Archive this product?',
        message:
          product.status === 'approved'
            ? `${name} has been sent for review before, so it will be archived, not deleted: it goes off sale straight away, but is kept as history and its SKU stays reserved.`
            : `${name} has been sent for review before, so it will be archived, not deleted: it is kept as history and its SKU stays reserved.`,
        confirmLabel: 'Archive product',
        done: `${product.title} was archived.`,
      }
    case 'blocked':
      return {
        title: "This product can't be deleted right now",
        message: `${name} is in review. Wait for the decision, then delete or archive it.`,
        confirmLabel: 'OK',
        done: '',
      }
    default:
      return {
        title: 'Delete or archive this product?',
        message: `${name} (${statusLabel(product.status)}): if it has never been sent for review it will be deleted for good and cannot be brought back; if it has been sent before, it will be archived instead, kept as history with its SKU reserved.`,
        confirmLabel: 'Continue',
        done: `${product.title} was deleted or archived.`,
      }
  }
}
