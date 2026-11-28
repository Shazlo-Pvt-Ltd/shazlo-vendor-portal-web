import { useMemo } from 'react'
import { useEveryQueueItem } from '../../../api/queries'
import type * as S from '../../../api/model'

export type BrandWaiting = { vendor: S.VendorRef; count: number; oldest: string }

// One entry per brand whose products wait for review: most products first, then the brand whose
// oldest product has waited longest, then by name so the order never jumps between loads.
export function groupByBrand(items: readonly S.QueueItem[]): BrandWaiting[] {
  const byVendor = new Map<string, BrandWaiting>()
  for (const item of items) {
    if (item.kind !== 'product') continue
    const brand = byVendor.get(item.vendor.id)
    if (!brand) byVendor.set(item.vendor.id, { vendor: item.vendor, count: 1, oldest: item.submitted_at })
    else {
      brand.count += 1
      if (Date.parse(item.submitted_at) < Date.parse(brand.oldest)) brand.oldest = item.submitted_at
    }
  }
  return [...byVendor.values()].sort((a, b) => b.count - a.count || Date.parse(a.oldest) - Date.parse(b.oldest) || a.vendor.name.localeCompare(b.vendor.name))
}

// Every product in the review queue, not just its first page, grouped by brand: a brand's count and
// oldest wait are only right when all of its products are counted.
export function useBrandsWaiting() {
  const query = useEveryQueueItem({ kind: 'product' })
  const brands = useMemo(() => (query.data ? groupByBrand(query.data) : undefined), [query.data])
  return { query, brands }
}
