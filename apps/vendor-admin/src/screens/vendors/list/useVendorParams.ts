import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { VendorFilters } from '../../../api/queries'
import type { components } from '../../../api/schema'
import { SORTS, vendorTabs, type VendorSort } from '../../../copy/vendors'

type Status = components['schemas']['VendorStatus']

export const DEFAULT_SORT: VendorSort = 'name'

// Everything the list shows is in the URL, so back, forward, reload and shared links keep it.
export interface VendorParams {
  status: Status | undefined
  q: string
  city: string
  sort: VendorSort
}

export type ParamKey = keyof VendorParams
export type Update = (patch: Partial<Record<ParamKey, string | undefined>>, options?: { replace?: boolean }) => void

const STATUSES = vendorTabs.flatMap((t) => (t.key === 'all' ? [] : [t.key]))

function oneOf<T extends string>(list: readonly T[], value: string | null): T | undefined {
  return list.find((item) => item === value)
}

export function parseVendorParams(search: URLSearchParams): VendorParams {
  return {
    status: oneOf(STATUSES, search.get('status')),
    q: search.get('q')?.trim() ?? '',
    city: search.get('city') ?? '',
    sort: oneOf(SORTS, search.get('sort')) ?? DEFAULT_SORT,
  }
}

export function toFilters(p: VendorParams): VendorFilters {
  return { status: p.status, q: p.q || undefined, city: p.city || undefined, sort: p.sort }
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
