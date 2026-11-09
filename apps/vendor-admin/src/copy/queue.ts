// A-04 Review queue. All of the screen's words, so Hindi can be added later.
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

export type SubmittedKey = 'today' | '24h' | 'older'
export type SortKey = 'oldest' | 'newest'
export type KindKey = 'product' | 'brand_page' | 'application'

export const queueCopy = {
  title: 'Review queue',
  subtitle: (waiting: number, oldest: string | null) => (waiting === 0 ? 'Nothing is waiting for a decision.' : oldest ? `${waiting.toLocaleString('en-IN')} waiting · oldest has waited ${oldest}` : `${waiting.toLocaleString('en-IN')} waiting`),
  exportCsv: 'Export CSV',
  exported: (n: number) => `Exported ${plural(n, 'row', 'rows')}`,
  updating: 'Updating the queue',

  figures: {
    waiting: 'Waiting',
    waitingBaseline: (products: number, brands: number, applications: number) => `Products ${products} · Brand pages ${brands} · Applications ${applications}`,
    decidedToday: 'Decided today',
    decidedBaseline: 'Approved or sent back since midnight',
    median: 'Median time to decision',
    medianBaseline: 'From submission to approve or send back',
    resubmissions: 'Resubmissions waiting',
    resubmissionsBaseline: 'Sent back before, now fixed',
    label: 'Queue figures',
  },

  tabsLabel: 'Item type',
  tabs: [
    { key: 'all', label: 'All' },
    { key: 'product', label: 'Products' },
    { key: 'brand_page', label: 'Brand pages' },
    { key: 'application', label: 'Vendor applications' },
  ] as const,

  filters: {
    label: 'Filter the queue',
    search: 'Search item, vendor or SKU',
    clearSearch: 'Clear search',
    vendor: 'Vendor',
    allVendors: 'All vendors',
    submitted: 'Submitted',
    anyTime: 'Any time',
    submittedOptions: [
      { value: 'today', label: 'Today' },
      { value: '24h', label: '24–48 h ago' },
      { value: 'older', label: 'Older' },
    ] as { value: SubmittedKey; label: string }[],
    resubmissions: 'Resubmissions only',
    sort: 'Sort',
    sortPrefix: 'Sort:',
    sortOptions: [
      { value: 'oldest', label: 'Oldest first' },
      { value: 'newest', label: 'Newest first' },
    ] as { value: SortKey; label: string }[],
  },

  table: {
    label: 'Items waiting for review',
    item: 'Item',
    vendor: 'Vendor',
    submitted: 'Submitted',
    waiting: 'Waiting',
    type: 'Type',
    actions: 'Actions',
    review: 'Review',
    reviewLabel: (title: string) => `Review ${title}`,
    overADay: 'Waiting over a day',
  },

  empty: {
    tip: 'Nice work',
    title: 'Nothing waiting',
    body: 'New products, brand pages and vendor applications appear here as soon as sellers submit them.',
  },
  emptyTab: {
    title: (tab: string) => `No ${tab.toLowerCase()} waiting`,
    body: 'Other kinds of items are still waiting.',
    showAll: 'Show everything waiting',
  },
  noResults: {
    title: 'No items match these filters',
    body: 'Try another vendor or time, or clear the filters to see the whole queue.',
    clear: 'Clear filters',
  },
  error: {
    title: 'The review queue did not load',
    retry: 'Try again',
  },

  csv: {
    filename: (day: string) => `review-queue-${day}.csv`,
    headers: ['Item', 'Detail', 'Type', 'Vendor', 'Submitted at', 'Waiting'],
  },
} as const
