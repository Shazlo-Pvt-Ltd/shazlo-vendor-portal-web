import type { components } from '../../api/schema'

export type ProductSummary = components['schemas']['ProductSummaryOut']
export type ProductDetail = components['schemas']['ProductOut']

/** Every status the API's `status` filter accepts. */
export const PRODUCT_STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

/** Words for the status chip. The word carries the meaning; the colour only helps. */
export const STATUS_LABEL: Record<ProductStatus, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  approved: 'Live',
  rejected: 'Needs changes',
  archived: 'Archived',
}

export const STATUS_COLOR: Record<ProductStatus, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  draft: 'default',
  pending_review: 'info',
  approved: 'success',
  rejected: 'error',
  archived: 'default',
}

export function isProductStatus(value: unknown): value is ProductStatus {
  return typeof value === 'string' && (PRODUCT_STATUSES as readonly string[]).includes(value)
}

/** A status the portal does not know (a newer API): shown as it is, never as a blank. */
export function statusLabel(status: string): string {
  return isProductStatus(status) ? STATUS_LABEL[status] : status
}
