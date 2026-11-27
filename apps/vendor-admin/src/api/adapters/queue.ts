import type * as M from '../model'
import type { components } from '../schema'

// vendor-api's `GET /v1/admin/queue` (services/vendor-api/vendor_api/api/admin_queue.py) as the review
// queue screen reads it. The wire shape and the screen's view model have the same fields; the adapter
// is where a server that sends something unexpected is turned into something the screen can show.
type WireItem = components['schemas']['QueueItemOut']
type WirePage = components['schemas']['QueuePageOut']

export const QUEUE_PAGE_SIZE = 50
/** The most the server returns in one request; the CSV export asks for this many at a time. */
export const QUEUE_MAX_PAGE_SIZE = 100

const KINDS: readonly M.ItemKind[] = ['product', 'brand_page', 'application']
const CHANGES: readonly M.QueueItem['change'][] = ['new', 'edit', 'application']
const UNNAMED_VENDOR = 'Unnamed vendor'

const isKind = (value: unknown): value is M.ItemKind => KINDS.includes(value as M.ItemKind)
const isChange = (value: unknown): value is M.QueueItem['change'] => CHANGES.includes(value as M.QueueItem['change'])

function vendorOf(wire: { id?: string | null; name?: string | null } | null | undefined): M.VendorRef {
  return { id: wire?.id ?? '', name: wire?.name?.trim() ? wire.name : UNNAMED_VENDOR }
}

/** One waiting item. `null` for a kind this screen does not know (a newer server): it is left out, not shown as a broken row. */
export function toQueueItem(wire: WireItem): M.QueueItem | null {
  if (!isKind(wire.kind)) return null
  return {
    id: wire.id,
    kind: wire.kind,
    subject_id: wire.subject_id,
    title: wire.title?.trim() ? wire.title : 'Untitled',
    detail: wire.detail ?? '',
    vendor: vendorOf(wire.vendor),
    submitted_at: wire.submitted_at,
    // Fall back to what the kind implies, so a new value cannot break the badge.
    change: isChange(wire.change) ? wire.change : wire.kind === 'application' ? 'application' : 'new',
    resubmission: Number.isFinite(wire.resubmission) ? Math.max(0, Math.trunc(wire.resubmission)) : 0,
    thumbnail_url: wire.thumbnail_url ?? null,
  }
}

/** One page of the queue, plus where it sits in the whole list. */
export type QueueSlice = M.QueuePage & { total: number; limit: number; offset: number }

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0)

export function toQueueSlice(wire: WirePage): QueueSlice {
  const counts = wire.counts
  const items = (wire.items ?? []).flatMap((item) => {
    const mapped = toQueueItem(item)
    return mapped ? [mapped] : []
  })
  return {
    items,
    counts: { all: count(counts?.all), product: count(counts?.product), brand_page: count(counts?.brand_page), application: count(counts?.application) },
    vendors: (wire.vendors ?? []).map(vendorOf),
    total: count(wire.total),
    limit: count(wire.limit),
    offset: count(wire.offset),
  }
}

/** Where the next request starts, or `undefined` when this was the last page. */
export function nextOffset(slice: Pick<QueueSlice, 'total' | 'limit' | 'offset'>): number | undefined {
  if (slice.limit <= 0) return undefined
  const next = slice.offset + slice.limit
  return next < slice.total ? next : undefined
}

/** Pages joined into one list. An item that moved to another page while the list was open is shown once. */
export function joinSlices(slices: readonly QueueSlice[]): QueueSlice & { loaded: number } {
  const last = slices[slices.length - 1]!
  const seen = new Set<string>()
  const items: M.QueueItem[] = []
  for (const slice of slices) {
    for (const item of slice.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
  }
  // The counts, vendors and total come from the newest request: they describe the queue now.
  return { ...last, items, offset: slices[0]!.offset, loaded: items.length }
}
