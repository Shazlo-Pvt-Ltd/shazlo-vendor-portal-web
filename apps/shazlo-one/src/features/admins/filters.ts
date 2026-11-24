export const PAGE_SIZE = 25
const MAX_TEXT = 200
const MAX_PAGE = 1000

export type StatusFilter = 'all' | 'active' | 'inactive'

export interface AdminFilters {
  /** Email or name contains this. */
  q: string
  /** A role name, or `''` for any. */
  role: string
  status: StatusFilter
  /** 1-based. */
  page: number
}

export const NO_FILTERS: AdminFilters = { q: '', role: '', status: 'all', page: 1 }

const text = (value: string | null, max: number): string => (value ?? '').trim().slice(0, max)

/** A role name as identity-api writes them: letters, digits, `_` and `-`. Anything else is not a role. */
const ROLE = /^[A-Za-z0-9_-]{1,64}$/

/** The filters in an address. Anything invalid is ignored, so a hand-edited link never breaks the page. */
export function filtersFromSearch(params: URLSearchParams): AdminFilters {
  const status = params.get('status')
  const page = Number.parseInt(params.get('page') ?? '', 10)
  const role = text(params.get('role'), 64)
  return {
    q: text(params.get('q'), MAX_TEXT),
    role: ROLE.test(role) ? role : '',
    status: status === 'active' || status === 'inactive' ? status : 'all',
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  }
}

/** The address for some filters; defaults are left out so the plain list has a plain address. */
export function searchFromFilters(filters: AdminFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.role) params.set('role', filters.role)
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

export function hasActiveFilters(filters: AdminFilters): boolean {
  return filters.q !== '' || filters.role !== '' || filters.status !== 'all'
}

/** The query `GET /v1/admins` takes. */
export function queryFromFilters(filters: AdminFilters) {
  return {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.status === 'all' ? {} : { is_active: filters.status === 'active' }),
    limit: PAGE_SIZE,
    offset: (filters.page - 1) * PAGE_SIZE,
  }
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE))
}
