// Copy for V-09 Review status. One module per screen keeps a later Hindi translation in one place.
import { formatCount } from '../lib/format'

const hours = (h: number) => (h === 0 ? 'less than an hour' : h === 1 ? '1 hour' : `${formatCount(h)} hours`)

export const reviewCopy = {
  title: 'Review status',
  subtitle: 'Everything you have sent to the Shazlo review team, and what they decided.',
  retry: 'Try again',
  addProduct: 'Add product',

  tabsLabel: 'Show review items',
  tabs: { all: 'All', waiting: 'Waiting', rejected: 'Sent back', approved: 'Approved' },

  queue: 'Most items are reviewed within 24 hours.',
  oldest: (h: number) => `Your oldest waiting item has been in the queue for ${hours(h)}.`,

  loading: 'Loading review items',
  error: 'Your review items did not load. Check your connection and try again.',

  waiting: {
    title: 'Waiting for review',
    count: (n: number) => `${formatCount(n)} item${n === 1 ? '' : 's'}`,
    submitted: (when: string, waited: string) => `Submitted ${when} · waiting ${waited}`,
    submittedEdit: (day: string) => `Submitted ${day} · the live version stays in the app`,
    emptyTitle: 'Nothing waiting',
    emptyBody: 'Items you submit show up here.',
  },

  kind: {
    product: 'Product',
    productEdit: 'Edit to a live product',
    brand: 'Brand page',
    brandEdit: 'Edit to your live brand page',
  },

  decided: {
    title: 'Recently decided',
    sentBack: (when: string) => `Sent back ${when}`,
    live: (day: string) => `Approved ${day} · live in the app`,
    publishing: (day: string) => `Approved ${day} · publishing to the app`,
    reason: (text: string) => `“${text}”`,
    fix: 'Fix and resubmit',
    fixLabel: (title: string) => `Fix and resubmit ${title}`,
    emptyTitle: 'No decisions yet',
    emptyBody: 'Most items are reviewed within 24 hours. Decisions show up here.',
    emptyRejectedTitle: 'Nothing sent back',
    emptyRejectedBody: 'If the review team needs changes, the item shows up here with the reason.',
    emptyApprovedTitle: 'Nothing approved yet',
    emptyApprovedBody: 'Approved items go live in the app within minutes and show up here.',
  },

  nothing: {
    title: 'Nothing sent for review yet',
    body: 'Submit a product or your brand page and follow its review here.',
    tip: 'Most items are reviewed within a day',
  },

  how: {
    title: 'How review works',
    steps: [
      { title: 'Submitted', body: 'Your item joins the queue. You can still see it, but not edit it.' },
      { title: 'Reviewed', body: 'Usually within 24 hours, by the Shazlo team.' },
      { title: 'Live or sent back', body: 'Live items appear in the app within minutes. Sent-back items come with a reason.' },
    ],
    checksTitle: 'What we check',
    checks: ['Front, back and close-up photos', 'Price matches the tag (MRP)', 'Category and fabric are right', 'Nothing on the prohibited list'],
  },
} as const
