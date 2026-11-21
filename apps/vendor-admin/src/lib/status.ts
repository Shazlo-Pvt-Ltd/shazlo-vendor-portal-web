import type { PillStatus } from '@shazlo/ui'
import type { components } from '../api/schema'

type S = components['schemas']
export type Pill = { status: PillStatus; label: string }

// One mapping from API states to the shared StatusPill looks, so every admin list reads the same.
export const vendorPill: Record<S['VendorStatus'], Pill> = {
  applied: { status: 'pending', label: 'Applied' },
  under_review: { status: 'editInReview', label: 'More info asked' },
  approved: { status: 'live', label: 'Approved' },
  rejected: { status: 'sentBack', label: 'Rejected' },
  suspended: { status: 'suspended', label: 'Suspended' },
}

export const outboxPill: Record<S['OutboxStatus'], Pill> = {
  waiting: { status: 'pending', label: 'Waiting' },
  retrying: { status: 'publishing', label: 'Retrying' },
  failed: { status: 'suspended', label: 'Failed' },
  delivered: { status: 'live', label: 'Delivered' },
}

export function queuePill(item: Pick<S['QueueItem'], 'kind' | 'change' | 'resubmission'>): Pill {
  if (item.kind === 'application') return { status: 'pending', label: 'Application' }
  if (item.resubmission > 0) return { status: 'sentBack', label: `Resubmission #${item.resubmission}` }
  if (item.change === 'edit') return { status: 'editInReview', label: item.kind === 'brand_page' ? 'Edit to live page' : 'Edit to live product' }
  return { status: 'pending', label: item.kind === 'brand_page' ? 'First brand page' : 'New product' }
}

export const decisionPill: Record<'approved' | 'rejected', Pill> = {
  approved: { status: 'live', label: 'Approved' },
  rejected: { status: 'sentBack', label: 'Sent back' },
}

// "5 h 20 m", "34 h", "2 d 3 h": how long something has waited.
export function formatWait(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) return `${minutes} m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 && hours < 10 ? `${hours} h ${minutes % 60} m` : `${hours} h`
  return `${Math.floor(hours / 24)} d ${hours % 24} h`
}
