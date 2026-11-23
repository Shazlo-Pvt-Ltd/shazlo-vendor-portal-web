// The Vendor dashboard: the module's landing page, what is going on on the vendor side at a glance.
// All of the screen's words, so Hindi can be added later.
import type { components } from '../api/schema'

type ItemKind = components['schemas']['ItemKind']

const count = (n: number) => n.toLocaleString('en-IN')
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`
// formatRelative's words start a sentence ("Yesterday", "Just now"); here they follow other words.
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

export const dashboardCopy = {
  // What Shazlo One shows in its breadcrumb and tab title.
  title: 'Dashboard',
  heading: 'Vendor dashboard',
  subtitle: 'Brands, the review queue and publishing to the app, at a glance.',
  openQueue: 'Open review queue',
  retry: 'Try again',
  // The retry button's name, when several cards can fail at once: what it loads, after its words.
  retryLabel: (what: string) => `Try again to load ${lowerFirst(what)}`,

  vendors: {
    title: 'Vendors',
    label: 'Vendor figures',
    loading: 'Loading vendor figures',
    error: 'Vendor figures did not load',
    all: 'All vendors',
    live: 'Live vendors',
    liveBaseline: 'Approved brands selling on Shazlo',
    applications: 'Applications waiting',
    applicationsBaseline: (fresh: number, asked: number) => `New ${count(fresh)} · More info asked ${count(asked)}`,
    rates: 'Rates to review',
    ratesBaseline: 'Commission proposals waiting for Shazlo',
    suspended: 'Suspended',
    suspendedBaseline: 'Their products are hidden from the app',
  },

  queue: {
    title: 'Review queue',
    label: 'Review queue figures',
    loading: 'Loading review queue figures',
    error: 'Review queue figures did not load',
    products: 'Products waiting',
    productsBaseline: 'New products and edits to live ones',
    brandPages: 'Brand pages waiting',
    brandPagesBaseline: 'First pages and edits to live ones',
    over24h: 'Waiting over 24 h',
    over24hBaseline: 'Oldest first in the queue',
    decidedToday: 'Decided today',
    decidedTodayBaseline: 'Approved or sent back since midnight',
  },

  brands: {
    title: 'Brands with products waiting',
    label: 'Brands with products waiting',
    loading: 'Loading brands with products waiting',
    error: 'Brands with products waiting did not load',
    waiting: (n: number) => plural(n, 'product waiting', 'products waiting'),
    oldest: (when: string) => `Oldest submitted ${lowerFirst(when)}`,
    more: (n: number) => `${plural(n, 'more brand', 'more brands')} not shown`,
    seeAll: 'See all in the review queue',
    empty: {
      title: 'No products waiting',
      body: 'When a brand sends products for review, it shows up here with how many are waiting.',
    },
  },

  // The figures themselves (label, delivered, waiting, retrying, failed) use the publishing page's
  // words, publishingCopy.figures, so a figure reads the same on both screens.
  publishing: {
    title: 'Publishing to the app',
    loading: 'Loading publishing figures',
    error: 'Publishing figures did not load',
    open: 'Open publishing',
    failedBanner: {
      title: (n: number) => `${plural(n, 'event', 'events')} did not reach the app`,
      body: 'Failed events retry on their own. You can also retry them now on the publishing page.',
      action: 'See failed events',
    },
  },

  decisions: {
    title: 'Recent decisions',
    label: 'Recent decisions',
    loading: 'Loading recent decisions',
    error: 'Recent decisions did not load',
    by: (name: string) => `by ${name}`,
    kind: { product: 'Product', brand_page: 'Brand page', application: 'Vendor application' } satisfies Record<ItemKind, string>,
    empty: {
      title: 'No decisions yet',
      body: 'Approvals and send-backs show here as reviewers make them.',
    },
  },
} as const
