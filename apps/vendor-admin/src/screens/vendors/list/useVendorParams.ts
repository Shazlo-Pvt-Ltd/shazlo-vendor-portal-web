import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { VendorFilters } from '../../../api/queries'
import type { components } from '../../../api/schema'
import { RATE_TAB, SORTS, vendorTabs, type VendorSort, type VendorTabKey } from '../../../copy/vendors'

type Status = components['schemas']['VendorStatus']
type CommissionState = components['schemas']['CommissionState']

export const DEFAULT_SORT: VendorSort = 'name'

// Everything the list shows is in the URL, so back, forward, reload and shared links keep it.
export interface VendorParams {
  status: Status | undefined
  // The "Rate to review" tab is commission=proposed.
  commission: CommissionState | undefined
  q: string
  city: string
  sort: VendorSort
}

export type ParamKey = keyof VendorParams
export type Update = (patch: Partial<Record<ParamKey, string | undefined>>, options?: { replace?: boolean }) => void

const STATUSES = vendorTabs.flatMap((t) => (t.key === 'all' || t.key === RATE_TAB ? [] : [t.key]))
// The API filters by any commission state; the list only offers the one with a tab, so the URL and
// the selected tab always agree.
const COMMISSION_STATES: readonly CommissionState[] = ['proposed']

function oneOf<T extends string>(list: readonly T[], value: string | null): T | undefined {
  return list.find((item) => item === value)
}

export function parseVendorParams(search: URLSearchParams): VendorParams {
  return {
    status: oneOf(STATUSES, search.get('status')),
    commission: oneOf(COMMISSION_STATES, search.get('commission')),
    q: search.get('q')?.trim() ?? '',
    city: search.get('city') ?? '',
    sort: oneOf(SORTS, search.get('sort')) ?? DEFAULT_SORT,
  }
}

export function toFilters(p: VendorParams): VendorFilters {
  return { status: p.status, commission: p.commission, q: p.q || undefined, city: p.city || undefined, sort: p.sort }
}

// The selected tab: a rate filter wins over a status.
export function tabOf(p: VendorParams): VendorTabKey {
  return p.commission === 'proposed' ? RATE_TAB : (p.status ?? 'all')
}

// Each tab sets one filter and clears the other.
export function tabPatch(key: string): Partial<Record<ParamKey, string | undefined>> {
  if (key === RATE_TAB) return { status: undefined, commission: 'proposed' }
  return { status: key === 'all' ? undefined : key, commission: undefined }
}

export function useVendorParams() {
  const [search, setSearch] = useSearchParams()
  const params = useMemo(() => parseVendorParams(search), [search])

  // Defaults stay out of the URL.
  const update = useCallback<Update>(
    (patch, { replace = false } = {}) => {
      setSearch(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '' || (key === 'sort' && value === DEFAULT_SORT)) next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace },
      )
    },
    [setSearch],
  )

  return [params, update] as const
}
