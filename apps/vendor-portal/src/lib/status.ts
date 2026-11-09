import type { PillStatus } from '@shazlo/ui'
import type { Schemas } from '../api/client'

// API statuses (docs/05: approved, rejected…) shown in seller words (Live, Sent back…).
export function productPills(p: Pick<Schemas['ProductSummary'], 'status' | 'edit_in_review' | 'publishing'>): PillStatus[] {
  const base: Record<Schemas['ProductStatus'], PillStatus> = {
    approved: 'live',
    pending_review: 'pending',
    rejected: 'sentBack',
    draft: 'draft',
    archived: 'archived',
  }
  const pills: PillStatus[] = [p.publishing && p.status === 'approved' ? 'publishing' : base[p.status]]
  if (p.edit_in_review) pills.push('editInReview')
  return pills
}

export function reviewPill(item: Pick<Schemas['ReviewItem'], 'state' | 'kind' | 'publishing'>): PillStatus {
  if (item.state === 'waiting') return item.kind === 'edit' ? 'editInReview' : 'pending'
  if (item.state === 'rejected') return 'sentBack'
  return item.publishing ? 'publishing' : 'live'
}

// Status tabs on Products (V-06) and the API value each one filters by.
export const productTabs = [
  { key: 'all', label: 'All', status: undefined },
  { key: 'approved', label: 'Live', status: 'approved' },
  { key: 'pending_review', label: 'Pending review', status: 'pending_review' },
  { key: 'rejected', label: 'Sent back', status: 'rejected' },
  { key: 'draft', label: 'Drafts', status: 'draft' },
  { key: 'archived', label: 'Archived', status: 'archived' },
] as const satisfies readonly { key: keyof Schemas['StatusCounts']; label: string; status?: Schemas['ProductStatus'] }[]
