import type * as S from '../../../api/model'
import { modulePaths } from '../../../app/routes'
type Decision = S.Summary['recent'][number]

// Every figure and row opens the screen that lists what it counts, filtered through the query
// parameters that screen reads: the vendor list's `status` (useVendorParams; `rates` is its
// `commission=proposed` tab), the queue's `kind` and `sort` (useQueueParams), the publishing
// page's `status` and the vendor page's `tab`.
export const dashboardLinks = {
  vendorsWith: (status: S.VendorStatus) => `${modulePaths.vendors}?status=${status}`,
  rates: modulePaths.rates,
  queueOf: (kind: S.ItemKind) => `${modulePaths.queue}?kind=${kind}`,
  // The queue filters by "24–48 h ago" or "older", not "over 24 h"; oldest first puts those on top.
  queueOldest: `${modulePaths.queue}?sort=oldest`,
  publishingWith: (status: S.OutboxStatus) => `${modulePaths.publishing}?status=${status}`,
  // The vendor page's Products tab, where a brand's waiting products can be approved together.
  vendorProducts: (vendorId: string) => `${modulePaths.vendor(vendorId)}?tab=products`,
  // Brand pages and applications are keyed by their vendor and open directly. A product decision
  // opens the queue, as on Shazlo One's home.
  decision: (d: Decision) => {
    if (d.kind === 'brand_page') return modulePaths.brand(d.vendor.id)
    if (d.kind === 'application') return modulePaths.vendor(d.vendor.id)
    return modulePaths.queue
  },
}
