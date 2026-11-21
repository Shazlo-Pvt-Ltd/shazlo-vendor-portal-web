import type { PillStatus } from '@shazlo/ui'
import type { Schemas } from '../api/client'

// The one set of words a seller sees for where something stands in review (#267). Every pill, tab,
// figure, count row and heading that names a status takes its word from here. Sentences may still
// say what the team did ("Sent back today, 11:40"). The admin names the same states its own way
// ("Pending review", "Sent back"); those are @shazlo/ui's default pill labels, never shown here.
export const statusWords = {
  live: 'Live',
  inReview: 'In review',
  needsChanges: 'Needs changes',
  changesInReview: 'Changes in review',
  publishing: 'Publishing',
  draft: 'Draft',
  drafts: 'Drafts',
  archived: 'Archived',
  suspended: 'Suspended',
} as const

// A product's status in plain words: the list, the editor and the filters.
export const productStatusWords = {
  draft: statusWords.draft,
  pending_review: statusWords.inReview,
  approved: statusWords.live,
  rejected: statusWords.needsChanges,
  archived: statusWords.archived,
} as const satisfies Record<Schemas['ProductStatus'], string>

// The word on each pill (components/StatusPill). Every look @shazlo/ui has needs one, so a new
// look cannot fall back to the admin's word.
export const pillLabel = {
  live: statusWords.live,
  pending: statusWords.inReview,
  sentBack: statusWords.needsChanges,
  editInReview: statusWords.changesInReview,
  draft: statusWords.draft,
  publishing: statusWords.publishing,
  archived: statusWords.archived,
  suspended: statusWords.suspended,
} as const satisfies Record<PillStatus, string>
