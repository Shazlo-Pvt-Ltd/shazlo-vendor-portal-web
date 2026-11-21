import type { PillStatus } from '@shazlo/ui'
import type { Schemas } from '../api/client'

// Review decisions (docs/05: approved, rejected…) shown in seller words (Live, Sent back…).
// Products use the plain status words in copy/products.ts.
export function reviewPill(item: Pick<Schemas['ReviewItem'], 'state' | 'kind' | 'publishing'>): PillStatus {
  if (item.state === 'waiting') return item.kind === 'edit' ? 'editInReview' : 'pending'
  if (item.state === 'rejected') return 'sentBack'
  return item.publishing ? 'publishing' : 'live'
}
