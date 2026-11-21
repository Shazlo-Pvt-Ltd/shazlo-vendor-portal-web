import type { Schemas } from '../api/model'
import { formatCount } from '../lib/format'

// Copy for Products (V-06). Product types and genders are labelled in ./catalog.ts. One module per
// screen keeps a later Hindi translation in one place.
const products = (n: number) => `${formatCount(n)} ${n === 1 ? 'product' : 'products'}`

// A product's status in plain words, here and in the editor.
const statuses = {
  draft: 'Draft',
  pending_review: 'In review',
  approved: 'Live',
  rejected: 'Needs changes',
  archived: 'Archived',
} satisfies Record<Schemas['ProductStatus'], string>

export const productsCopy = {
  title: 'Products',
  subtitle: (total: number, live: number) => `${products(total)} · ${formatCount(live)} live in the app`,
  bulkImport: 'Bulk import',
  laptopNote: 'Easier on a laptop',
  addProduct: 'Add product',
  tabsLabel: 'Product status',
  statuses,
  changesInReview: 'Changes in review',
  // Status tabs, in order; `status` is what each one filters by.
  tabs: [
    { key: 'all', label: 'All', status: undefined },
    { key: 'approved', label: 'Live', status: 'approved' },
    { key: 'pending_review', label: 'In review', status: 'pending_review' },
    { key: 'rejected', label: 'Needs changes', status: 'rejected' },
    { key: 'draft', label: 'Drafts', status: 'draft' },
    { key: 'archived', label: 'Archived', status: 'archived' },
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
    delete: 'Delete',
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
    archived: (n: number, drafts: boolean) => (drafts ? `${products(n)} archived or deleted` : `${products(n)} archived`),
    // Some went, some did not: "3 of 5 sent for review", then each one that did not, with why.
    someSubmitted: (done: number, total: number) => `${formatCount(done)} of ${formatCount(total)} sent for review`,
    someArchived: (done: number, total: number) => `${formatCount(done)} of ${formatCount(total)} archived`,
    notSubmitted: (n: number, name?: string) => (n === 1 && name ? `${name} could not be sent for review` : `${products(n)} could not be sent for review`),
    notArchived: (n: number, name?: string) => (n === 1 && name ? `${name} could not be archived` : `${products(n)} could not be archived`),
    // One product deleted or archived from its row menu.
    deleted: (name: string) => `${name} was deleted.`,
    archivedOne: (name: string) => `${name} was archived. Find it under Archived.`,
    reason: (name: string, why: string) => `${name}: ${why}`,
    // vendor-api's refusals that are not a list of what is missing, in plain words.
    reasons: {
      product_in_review: 'It is in review. Wait for our decision.',
      nothing_to_submit: 'Nothing has changed since it was sent back. Fix what our team asked for, then send it again.',
      product_archived: 'It is archived.',
      product_not_found: 'It is no longer in your products.',
    } as Record<string, string>,
    failedBody: 'Open each one, fix what is listed, then send it again.',
    archiveFailedBody: 'Nothing else changed.',
    failedLabel: 'Products that need changes',
    failed: 'That did not go through.',
    dismiss: 'Dismiss',
  },
  // Main's delete rules: a product never sent for review is deleted for good; one sent before is
  // archived (kept, and off the app); one in review cannot be touched until the decision.
  deleteDialog: {
    removed: {
      title: (name: string) => `Delete ${name}?`,
      body: 'It has never been sent for review, so it will be deleted for good. This cannot be undone.',
      confirm: 'Delete product',
    },
    archived: {
      title: (name: string) => `Archive ${name}?`,
      body: (live: boolean) =>
        live
          ? 'It has been sent for review before, so it is archived, not deleted: it leaves the app straight away and moves to Archived.'
          : 'It has been sent for review before, so it is archived, not deleted, and moves to Archived.',
      confirm: 'Archive product',
    },
    blocked: {
      title: (name: string) => `${name} cannot be archived yet`,
      body: 'It is in review. Wait for our decision, then archive it.',
    },
    unknown: {
      title: (name: string) => `Delete or archive ${name}?`,
      body: 'If it has never been sent for review, it will be deleted for good. If it has been sent before, it will be archived and move to Archived.',
      confirm: 'Continue',
    },
    bulk: {
      title: (n: number, drafts: boolean) => (drafts ? `Archive or delete ${products(n)}?` : `Archive ${products(n)}?`),
      archived: 'Products sent for review before are archived, not deleted, and move to Archived.',
      live: 'Live ones leave the app straight away.',
      drafts: 'Drafts never sent for review are deleted for good; this cannot be undone.',
      blocked: (n: number) => `${products(n)} ${n === 1 ? 'is' : 'are'} in review and will be skipped until our team decides.`,
      confirm: 'Continue',
    },
    checking: 'Checking this product…',
    checkFailed: 'We could not check this product. Close this and try again.',
    cancel: 'Cancel',
    close: 'Close',
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
    pending_review: { title: 'Nothing is waiting for review', body: 'Products you send for review wait here until our team decides.' },
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
