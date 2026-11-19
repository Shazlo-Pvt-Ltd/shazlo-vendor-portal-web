import type { components } from '../../api'

export type Submission = components['schemas']['SubmissionOut']
export type SubmissionStatus = Submission['status']
export type SubjectKind = Submission['subject']

export const SUBMISSION_STATUSES: readonly SubmissionStatus[] = ['pending', 'approved', 'rejected', 'withdrawn']
export const SUBJECTS: readonly SubjectKind[] = ['brand_profile', 'product']

/** The word on the chip carries the meaning; the colour only helps. */
export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: 'In review',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
}
export const STATUS_COLOR: Record<SubmissionStatus, 'info' | 'success' | 'error' | 'default'> = {
  pending: 'info',
  approved: 'success',
  rejected: 'error',
  withdrawn: 'default',
}
export const SUBJECT_LABEL: Record<SubjectKind, string> = { brand_profile: 'Brand page', product: 'Product' }

export const statusLabel = (status: string) => STATUS_LABEL[status as SubmissionStatus] ?? status

/** "Brand page" or the product's title (its SKU when it has none). */
export function itemName(item: Submission): string {
  if (item.subject === 'brand_profile') return 'Brand page'
  return item.title?.trim() || item.sku || 'Product'
}

/** Where to fix it: the brand editor, or the product's own page. */
export function fixLink(item: Submission): string {
  return item.subject === 'brand_profile' ? '/brand' : `/products/${item.id}`
}

/** One review: the same thing at the same version. */
export const reviewKey = (item: Submission) => `${item.subject}:${item.id}:${item.version}`

/**
 * Whether a later version of the same brand page or product appears among `items`: then this
 * rejection was already dealt with, and "Fix and resubmit" would be misleading.
 */
export function isSuperseded(item: Submission, items: readonly Submission[]): boolean {
  return items.some((other) => other.subject === item.subject && other.id === item.id && other.version > item.version)
}

/**
 * The reviews whose status changed since the last answer (by `reviewKey`), as sentences for a
 * screen reader: "Indigo kurta, version 2: approved."
 */
export function statusChanges(before: ReadonlyMap<string, string>, items: readonly Submission[]): string[] {
  const changes: string[] = []
  for (const item of items) {
    const previous = before.get(reviewKey(item))
    if (previous !== undefined && previous !== item.status) {
      changes.push(`${itemName(item)}, version ${item.version}: ${statusLabel(item.status).toLowerCase()}.`)
    }
  }
  return changes
}

/** Decided after `since` (milliseconds): a decision the vendor has not seen on this page yet. */
export function isNewSince(item: Submission, since: number | null): boolean {
  if (since === null || item.decided_at === null) return false
  const decided = Date.parse(item.decided_at)
  return !Number.isNaN(decided) && decided > since
}

// --- Filters, kept in the address so they survive a reload and can be shared ---

export const PAGE_SIZE = 20

/** How often submissions are asked again while a page shows them (they also refresh when the window regains focus). */
export const REFRESH_MS = 60_000

export interface SubmissionFilters {
  status: SubmissionStatus | ''
  subject: SubjectKind | ''
  page: number
}

export function filtersFromSearch(params: URLSearchParams): SubmissionFilters {
  const status = params.get('status') ?? ''
  const subject = params.get('subject') ?? ''
  const page = Number.parseInt(params.get('page') ?? '', 10)
  return {
    status: (SUBMISSION_STATUSES as readonly string[]).includes(status) ? (status as SubmissionStatus) : '',
    subject: (SUBJECTS as readonly string[]).includes(subject) ? (subject as SubjectKind) : '',
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 / PAGE_SIZE ? page : 1,
  }
}

export function searchFromFilters(filters: SubmissionFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.subject) params.set('subject', filters.subject)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

export function queryFromFilters(filters: SubmissionFilters) {
  return {
    status: filters.status || ('all' as const),
    ...(filters.subject ? { subject: filters.subject } : {}),
    limit: PAGE_SIZE,
    offset: (filters.page - 1) * PAGE_SIZE,
  }
}

// --- Dates ---

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const EXACT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "3 days ago", "yesterday", "just now". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = (Date.parse(iso) - now) / 1000
  if (Number.isNaN(seconds)) return ''
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

/** "12 Nov 2026, 09:30". */
export function exactTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : EXACT.format(date)
}
