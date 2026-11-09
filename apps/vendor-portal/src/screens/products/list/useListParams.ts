import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { Schemas } from '../../../api/client'
import type { ProductFilters } from '../../../api/queries'
import { productsCopy, type SortKey, type StockKey } from '../../../copy/products'
import { productTabs } from '../../../lib/status'

export const PAGE_SIZE = 10
export const DEFAULT_SORT: SortKey = 'updated_desc'

// Everything the list shows is in the URL (V-06), so back, forward, reload and shared links keep it.
export interface ListParams {
  status: Schemas['ProductStatus'] | undefined
  q: string
  category: string
  gender: string
  stock: StockKey | undefined
  sort: SortKey
  page: number
}

export type ParamKey = keyof ListParams
type Patch = Partial<Record<ParamKey, string | number | undefined>>

const STATUSES = productTabs.flatMap((t) => (t.status ? [t.status] : []))
const STOCKS = productsCopy.stockOptions.map((o) => o.value)
const SORTS = productsCopy.sortOptions.map((o) => o.value)

function oneOf<T extends string>(list: readonly T[], value: string | null): T | undefined {
  return list.find((item) => item === value)
}

export function parseListParams(search: URLSearchParams): ListParams {
  const page = Number(search.get('page'))
  return {
    status: oneOf(STATUSES, search.get('status')),
    q: search.get('q')?.trim() ?? '',
    category: search.get('category') ?? '',
    gender: search.get('gender') ?? '',
    stock: oneOf(STOCKS, search.get('stock')),
    sort: oneOf(SORTS, search.get('sort')) ?? DEFAULT_SORT,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

// What the API is asked for. The cursor is the offset of the page's first product.
export function toFilters(p: ListParams): ProductFilters {
  return {
    status: p.status,
    q: p.q || undefined,
    category: p.category || undefined,
    gender: p.gender || undefined,
    stock: p.stock,
    sort: p.sort,
    cursor: p.page > 1 ? String((p.page - 1) * PAGE_SIZE) : undefined,
    limit: PAGE_SIZE,
  }
}

export const activeFilterCount = (p: ListParams) => [p.category, p.gender, p.stock].filter(Boolean).length

export function useListParams() {
  const [search, setSearch] = useSearchParams()
  const params = useMemo(() => parseListParams(search), [search])

  // Any change other than the page itself starts again from page 1. Defaults stay out of the URL.
  const update = useCallback(
    (patch: Patch, { replace = false }: { replace?: boolean } = {}) => {
      setSearch(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(patch)) {
            const empty = value === undefined || value === '' || (key === 'sort' && value === DEFAULT_SORT) || (key === 'page' && Number(value) <= 1)
            if (empty) next.delete(key)
            else next.set(key, String(value))
          }
          if (!('page' in patch)) next.delete('page')
          return next
        },
        { replace },
      )
    },
    [setSearch],
  )

  return [params, update] as const
}
