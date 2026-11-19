import { isProductStatus, type ProductStatus } from './status'

export const PAGE_SIZE = 25
const MAX_TEXT = 100

export interface ProductFilters {
  /** `''` is every status except archived, which the API shows only when asked. */
  status: ProductStatus | ''
  category: string
  q: string
  /** 1-based. */
  page: number
}

export const NO_FILTERS: ProductFilters = { status: '', category: '', q: '', page: 1 }

const text = (value: string | null): string => (value ?? '').trim().slice(0, MAX_TEXT)

/** The filters in an address. Anything invalid is ignored, so a hand-edited link never breaks the page. */
export function filtersFromSearch(params: URLSearchParams): ProductFilters {
  const status = params.get('status')
  const page = Number.parseInt(params.get('page') ?? '', 10)
  return {
    status: isProductStatus(status) ? status : '',
    category: text(params.get('category')),
    q: text(params.get('q')),
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 / PAGE_SIZE ? page : 1,
  }
}

/** The address for some filters; defaults are left out so the plain list has a plain address. */
export function searchFromFilters(filters: ProductFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.category) params.set('category', filters.category)
  if (filters.q) params.set('q', filters.q)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

export function hasActiveFilters(filters: ProductFilters): boolean {
  return filters.status !== '' || filters.category !== '' || filters.q !== ''
}

/** The query the list endpoint takes. */
export function queryFromFilters(filters: ProductFilters) {
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    limit: PAGE_SIZE,
    offset: (filters.page - 1) * PAGE_SIZE,
  }
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE))
}
