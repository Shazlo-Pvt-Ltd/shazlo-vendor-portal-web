// Copy for V-04 Overview. One module per screen keeps a later Hindi translation in one place.
import { formatCount } from '../lib/format'

// Brand page fields in the words sellers see on the form, in the order the form shows them.
const fieldNames: Record<string, string> = {
  cover_url: 'cover image',
  logo_url: 'logo',
  story: 'story',
  tagline: 'tagline',
  based_in: 'location',
  return_policy: 'return policy',
  dispatch_time: 'dispatch time',
  instagram: 'Instagram',
  website: 'website',
  brand_name: 'brand name',
}
const fieldOrder = Object.keys(fieldNames)

export function changedFieldList(fields: string[]): string {
  const rank = (f: string) => (fieldOrder.includes(f) ? fieldOrder.indexOf(f) : fieldOrder.length)
  return [...fields]
    .sort((a, b) => rank(a) - rank(b))
    .map((f) => fieldNames[f] ?? f.replace(/_/g, ' '))
    .join(', ')
}

export const overviewCopy = {
  title: 'Overview',
  subtitle: (brandName: string, approvedOn: string | null) => (approvedOn ? `${brandName} · approved seller since ${approvedOn}` : brandName),
  bulkImport: 'Bulk import',
  addProduct: 'Add product',
  retry: 'Try again',

  sentBack: {
    title: (n: number) => (n === 1 ? '1 product was sent back by the review team' : `${formatCount(n)} products were sent back by the review team`),
    body: (n: number) =>
      n === 1 ? 'Fix the notes on it and resubmit. It stays off the app until approved.' : 'Fix the notes on each product and resubmit. They stay off the app until approved.',
    action: 'See feedback',
  },

  stats: {
    label: 'Your products at a glance',
    loading: 'Loading product counts',
    error: 'Your product counts did not load. Check your connection and try again.',
    live: { label: 'Live on Shazlo', baseline: 'Visible in the app feed' },
    pending: { label: 'Pending review', baseline: 'Usually reviewed within 24 h' },
    sentBack: { label: 'Sent back', baseline: 'Needs your changes', baselineNone: 'Nothing to fix' },
    drafts: { label: 'Drafts', baseline: 'Not submitted yet' },
  },

  decisions: {
    title: 'Recent review decisions',
    viewAll: 'View all',
    viewAllLabel: 'View all review decisions',
    loading: 'Loading recent decisions',
    error: 'Recent decisions did not load. Check your connection and try again.',
    reason: (text: string) => `“${text}”`,
    emptyTitle: 'Nothing reviewed yet',
    emptyBody: 'When the Shazlo team decides on something you sent for review, it shows up here.',
    emptyTip: 'Most products are reviewed within a day',
  },

  brand: {
    title: 'Brand page',
    loading: 'Loading your brand page',
    error: 'Your brand page details did not load. Check your connection and try again.',
    published: (day: string) => `Published ${day}.`,
    notPublished: 'Not published yet. Shoppers see your brand page next to every product.',
    draft: (n: number, fields: string) => `You have a draft with ${n} unpublished change${n === 1 ? '' : 's'} (${fields}).`,
    draftNew: 'You have a draft that is not sent for review yet.',
    reason: (text: string) => `“${text}”`,
    inReview: (when: string) => `In review since ${when}.`,
    sentBack: (when: string) => `Sent back ${when}.`,
    edit: 'Edit brand page',
    setUp: 'Set up brand page',
  },
} as const
