import type { PillStatus } from '@shazlo/ui'
import type { Schemas } from '../api/client'

// Review decisions (docs/05: approved, rejected…) as the pill to show. The pill's word comes from
// copy/status.ts through components/StatusPill (#267): "In review", "Needs changes", "Live"…
export function reviewPill(item: Pick<Schemas['ReviewItem'], 'state' | 'kind' | 'publishing'>): PillStatus {
  if (item.state === 'waiting') return item.kind === 'edit' ? 'editInReview' : 'pending'
  if (item.state === 'rejected') return 'sentBack'
  return item.publishing ? 'publishing' : 'live'
}

// The brand page's review as a pill, the same on Overview and in the brand editor. A page that is
// already live has its changes in review; a first page is in review. Null when nothing is pending.
export function brandReviewPill(state: Schemas['ReviewState']['state'], live: boolean): PillStatus | null {
  if (state === 'waiting') return live ? 'editInReview' : 'pending'
  if (state === 'rejected') return 'sentBack'
  return null
}
