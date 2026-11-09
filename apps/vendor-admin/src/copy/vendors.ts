// Copy for A-08 Vendors and A-09 Vendor detail. One module per screen family, so Hindi can follow.
import type { components } from '../api/schema'

type S = components['schemas']
type HistoryEvent = S['History'][number]['event']

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

export const SORTS = ['name', 'newest', 'products'] as const
export type VendorSort = (typeof SORTS)[number]

export const vendorTabs: { key: 'all' | S['VendorStatus']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'applied', label: 'Applied' },
  { key: 'under_review', label: 'More info asked' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'suspended', label: 'Suspended' },
]

export const REASON_MIN = 10

export const vendorsCopy = {
  title: 'Vendors',
  subtitle: (brands: number, waiting: number) => `${plural(brands, 'brand', 'brands')} · ${plural(waiting, 'application', 'applications')} waiting`,
  exportCsv: 'Export CSV',
  exported: (n: number) => `Exported ${plural(n, 'vendor', 'vendors')}`,
  nothingToExport: 'There are no vendors in this list to export.',
  tabsLabel: 'Vendor status',
  updating: 'Updating the list',
  search: { label: 'Search brand, owner, email or phone', clear: 'Clear search' },
  filters: { city: 'City', allCities: 'All cities', sort: 'Sort', sortPrefix: 'Sort:' },
  sortOptions: [
    { value: 'name', label: 'Name A–Z' },
    { value: 'newest', label: 'Newest' },
    { value: 'products', label: 'Most live products' },
  ] satisfies { value: VendorSort; label: string }[],
  table: {
    label: 'Vendors',
    brand: 'Brand',
    owner: 'Owner',
    sells: 'Sells',
    liveProducts: 'Live products',
    status: 'Status',
    since: 'Since',
    commission: 'Commission',
    actionsHeader: 'Actions',
    actions: (brand: string) => `Actions for ${brand}`,
    review: 'Review',
    reviewLabel: (brand: string) => `Review ${brand}'s application`,
    more: (n: number) => `+${n}`,
  },
  menu: { open: 'Open', suspend: 'Suspend', reactivate: 'Reactivate' },
  noResults: { title: 'No vendors match', body: 'Try a different name, phone number or city.', clear: 'Clear filters' },
  emptyTab: {
    all: { title: 'No vendors yet', body: 'Applications from new brands show up here.' },
    applied: { title: 'No new applications', body: 'New applications from brands show up here.' },
    under_review: { title: 'No one is waiting on a reply', body: 'Applications you asked more information about show up here.' },
    approved: { title: 'No approved vendors', body: 'Brands you approve show up here.' },
    rejected: { title: 'No rejected applications', body: 'Applications you reject show up here, with your reason.' },
    suspended: { title: 'No suspended vendors', body: 'Vendors you suspend show up here until you reactivate them.' },
    showAll: 'Show all vendors',
  } as Record<'all' | S['VendorStatus'], { title: string; body: string }> & { showAll: string },
  error: { title: 'We could not load vendors', retry: 'Try again' },
  csv: {
    headers: ['Brand', 'Owner', 'Email', 'Phone', 'City', 'Sells', 'Status', 'Live products', 'Since', 'Commission'],
    filename: (day: string) => `shazlo-vendors-${day}.csv`,
  },
} as const

export const vendorActionsCopy = {
  cancel: 'Cancel',
  reasonHint: `At least ${REASON_MIN} characters.`,
  reasonShort: `Write at least ${REASON_MIN} characters.`,
  suspend: {
    title: (brand: string) => `Suspend ${brand}?`,
    body: 'Suspending hides all of their products from the app at once and pauses new orders.',
    label: 'Reason for suspending',
    confirm: 'Suspend vendor',
    pending: 'Suspending…',
    done: (brand: string) => `Suspended ${brand}`,
    banner: (brand: string) => `Suspended ${brand}. Their products are hidden from the app and new orders are paused.`,
  },
  reactivate: {
    title: (brand: string) => `Reactivate ${brand}?`,
    body: 'Their approved products show in the app again and new orders open at once.',
    confirm: 'Reactivate vendor',
    pending: 'Reactivating…',
    done: (brand: string) => `Reactivated ${brand}`,
    banner: (brand: string) => `Reactivated ${brand}. Their approved products are back in the app and new orders are open.`,
  },
  requestInfo: {
    button: 'Ask for more info',
    title: (brand: string) => `Ask ${brand} for more information`,
    body: 'The applicant gets this by email and their application stays open.',
    label: 'What do you need to know?',
    confirm: 'Send question',
    pending: 'Sending…',
    done: (brand: string) => `Asked ${brand} for more information`,
    banner: (brand: string, owner: string) => `Asked ${brand} for more information. ${owner} gets your question by email.`,
  },
  reject: {
    button: 'Reject',
    title: (brand: string) => `Reject ${brand}?`,
    body: 'The applicant sees this reason.',
    label: 'Reason for rejecting',
    confirm: 'Reject application',
    pending: 'Rejecting…',
    done: (brand: string) => `Rejected ${brand}`,
    banner: (brand: string, owner: string) => `Rejected ${brand}. ${owner} has been emailed your reason.`,
  },
  approve: {
    button: 'Approve and invite',
    pending: 'Approving…',
    done: (brand: string) => `Approved ${brand}`,
    banner: (brand: string, owner: string) => `Approved ${brand}. ${owner} has been sent an invite to set a password.`,
    blockedAgreement: 'Tick “Vendor agreement signed” below to approve.',
    blockedFields: 'Fix the approval settings below to approve.',
  },
  failed: 'That did not go through',
} as const

export const vendorDetailCopy = {
  back: 'Vendors',
  applied: (days: number, date: string) => (days <= 0 ? 'Applied today' : days === 1 ? 'Applied yesterday' : days < 30 ? `Applied ${days} days ago` : `Applied ${date}`),
  opensInNewTab: '(opens in a new tab)',
  tabsLabel: 'Vendor details',
  tabs: { application: 'Application', products: 'Products', brand: 'Brand page', activity: 'Activity' },
  application: {
    title: 'Application',
    owner: 'Owner',
    email: 'Email',
    phone: 'Phone',
    city: 'City',
    link: 'Instagram or website',
    sells: 'What they sell',
    price: 'Typical price range',
    about: 'About',
  },
  checks: {
    title: 'Automatic checks',
    allPassed: 'All passed',
    needLook: (n: number) => `${n} ${n === 1 ? 'needs' : 'need'} a look`,
    passed: 'Passed:',
    failed: 'Needs a look:',
  },
  approval: {
    title: 'Approval settings',
    commission: 'Commission %',
    commissionHint: 'Shazlo’s share of each sale',
    email: 'Owner login email',
    agreement: 'Vendor agreement signed (offline)',
    hint: 'Approving creates the owner’s login and emails them a link to set a password.',
    errors: {
      commissionRequired: 'Enter a commission, like 15.',
      commissionNumber: 'Enter a number, like 15 or 12.5.',
      commissionRange: 'Enter a commission between 0% and 40%.',
      emailRequired: 'Enter the owner’s email address.',
      emailFormat: 'Enter an email address, like name@brand.in.',
      agreement: 'Tick this once the vendor agreement is signed.',
    },
  },
  terms: { title: 'Terms', commission: 'Commission', none: '—' },
  products: {
    title: 'Products',
    label: 'Products from this vendor',
    empty: { title: 'No products yet', body: 'Products show up here once the brand adds them.' },
    status: { pending_review: 'Pending review', approved: 'Live', rejected: 'Sent back' } as Record<string, string>,
  },
  brand: {
    title: 'Brand page',
    live: 'Their brand page is live in the app.',
    notLive: 'No brand page is live in the app yet.',
    waiting: (date: string) => `A brand page was submitted on ${date} and is waiting for review.`,
    review: 'Review the submitted brand page',
    nothingWaiting: 'No brand page changes are waiting for review.',
    error: 'We could not check for a waiting brand page.',
  },
  activity: {
    title: 'Activity',
    label: 'Activity, newest first',
    events: {
      applied: 'Applied',
      info_requested: 'Asked for more information',
      invited: 'Approved and invited',
      rejected: 'Rejected',
      suspended: 'Suspended',
      reactivated: 'Reactivated',
      submitted: 'Submitted',
      approved: 'Approved',
      published: 'Published',
    } satisfies Record<HistoryEvent, string>,
    by: (name: string) => `by ${name}`,
    empty: 'Nothing has happened yet.',
  },
  actions: { suspend: 'Suspend', reactivate: 'Reactivate' },
  rejected: {
    label: 'Why this application was rejected',
    title: (date: string, by: string) => `Rejected on ${date} by ${by}`,
    noReason: 'No reason was recorded.',
  },
  suspended: {
    label: 'Why this vendor is suspended',
    title: (date: string, by: string) => `Suspended on ${date} by ${by}`,
  },
  notFound: { title: 'We could not find that vendor', body: 'The link may be old, or the vendor was removed.', back: 'Back to Vendors' },
  error: { title: 'We could not load this vendor', retry: 'Try again' },
  notFoundTitle: 'Vendor not found',
} as const
