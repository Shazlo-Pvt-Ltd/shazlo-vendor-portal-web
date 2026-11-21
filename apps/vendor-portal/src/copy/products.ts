import type { Schemas } from '../api/client'
import { formatCount } from '../lib/format'
import { productStatusWords, statusWords } from './status'

// Copy for Products (V-06). Product types and genders are labelled in ./catalog.ts. One module per
// screen keeps a later Hindi translation in one place.
const products = (n: number) => `${formatCount(n)} ${n === 1 ? 'product' : 'products'}`

export const productsCopy = {
  title: 'Products',
  subtitle: (total: number, live: number) => `${products(total)} · ${formatCount(live)} live in the app`,
  bulkImport: 'Bulk import',
  laptopNote: 'Easier on a laptop',
  addProduct: 'Add product',
  tabsLabel: 'Product status',
  // A product's status in plain words, here and in the editor (#267: the same words everywhere).
  statuses: productStatusWords,
  changesInReview: statusWords.changesInReview,
  // Status tabs, in order; `status` is what each one filters by.
  tabs: [
    { key: 'all', label: 'All', status: undefined },
    { key: 'approved', label: statusWords.live, status: 'approved' },
    { key: 'pending_review', label: statusWords.inReview, status: 'pending_review' },
    { key: 'rejected', label: statusWords.needsChanges, status: 'rejected' },
    { key: 'draft', label: statusWords.drafts, status: 'draft' },
    { key: 'archived', label: statusWords.archived, status: 'archived' },
  ] as const satisfies readonly { key: keyof Schemas['StatusCounts']; label: string; status?: Schemas['ProductStatus'] }[],

  search: {
    label: 'Search name or code',
    clear: 'Clear search',
  },
  filters: {
    category: 'Product type',
    gender: 'Gender',
    stock: 'Stock',
    sort: 'Sort',
    sortPrefix: 'Sort:',
    all: 'All',
    any: 'Any',
    button: (active: number) => (active ? `Filters (${active})` : 'Filters'),
    drawerTitle: 'Filters',
    showResults: 'Show results',
    clear: 'Clear filters',
  },
  stockOptions: [
    { value: 'in_stock', label: 'In stock' },
    { value: 'low', label: 'Low (1–5)' },
    { value: 'out', label: 'Out of stock' },
  ],
  sortOptions: [
    { value: 'updated_desc', label: 'Recently updated' },
    { value: 'price_asc', label: 'Price: low to high' },
    { value: 'price_desc', label: 'Price: high to low' },
    { value: 'stock_asc', label: 'Stock: low first' },
  ],

  table: {
    label: 'Products',
    selectAll: 'Select all on this page',
    select: (title: string) => `Select ${title}`,
    product: 'Product',
    category: 'Product type',
    price: 'Price',
    stock: 'Stock',
    status: 'Status',
    updated: 'Updated',
    actionsHeader: 'Actions',
    actions: (title: string) => `Actions for ${title}`,
    mrp: (value: string) => `MRP ${value}`,
    noCategory: '—',
  },
  card: {
    stock: (value: string) => `Stock ${value}`,
  },
  menu: {
    edit: 'Edit',
    submit: 'Send for review',
    archive: 'Archive',
  },

  bulk: {
    label: 'Bulk actions',
    selected: (n: number) => `${formatCount(n)} selected`,
    submit: 'Send for review',
    submitting: 'Sending…',
    archive: 'Archive',
    archiving: 'Archiving…',
    clear: 'Clear selection',
  },
  results: {
    submitted: (n: number) => `${products(n)} sent for review`,
    archived: (n: number) => `${products(n)} archived`,
    notSubmitted: (n: number) => `${products(n)} could not be sent for review`,
    notArchived: (n: number) => `${products(n)} could not be archived`,
    failedBody: 'Open each one, fix what is listed, then send it again.',
    failedLabel: 'Products that need changes',
    failed: 'That did not go through.',
    dismiss: 'Dismiss',
  },
  archiveDialog: {
    title: (n: number, name?: string) => (n === 1 && name ? `Archive ${name}?` : `Archive ${products(n)}?`),
    body: (n: number) =>
      n === 1 ? 'It leaves the app and moves to Archived. You can restore it later.' : 'They leave the app and move to Archived. You can restore them later.',
    confirm: 'Archive',
    cancel: 'Cancel',
  },

  pagination: {
    label: 'Pages',
    showing: (from: number, to: number, total: number) => `Showing ${formatCount(from)}–${formatCount(to)} of ${formatCount(total)}`,
    previous: 'Previous',
    next: 'Next',
    pastEnd: 'There is nothing on this page any more.',
    firstPage: 'Go to the first page',
  },

  empty: {
    title: 'No products yet',
    tip: 'Start with your best seller',
    body: 'Add one product to see how it looks in the app, or bring many in at once from a spreadsheet.',
  },
  noResults: {
    title: 'No products match these filters',
    body: 'Check the spelling, or clear the filters to see everything.',
    clear: 'Clear filters',
  },
  emptyTab: {
    approved: { title: 'Nothing is live yet', body: 'Products appear here once our team approves them.' },
    pending_review: { title: 'Nothing is in review', body: 'Products you send for review wait here until our team decides.' },
    rejected: { title: 'Nothing needs changes', body: 'If our team asks for changes, the product shows up here with the reason.' },
    draft: { title: 'No drafts', body: 'Products you start but have not sent for review are kept here.' },
    archived: { title: 'Nothing archived', body: 'Archived products leave the app and are kept here.' },
    showAll: 'Show all products',
  },
  error: {
    title: 'We could not load your products.',
    retry: 'Try again',
  },
  loading: 'Loading products',
  updating: 'Updating products',
} as const

export type SortKey = (typeof productsCopy.sortOptions)[number]['value']
export type StockKey = (typeof productsCopy.stockOptions)[number]['value']
