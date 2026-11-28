import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { NO_FILTERS, filtersFromSearch, searchFromFilters, type AdminFilters } from './filters'

const DEBOUNCE_MS = 300

/**
 * The list's filters, kept in the address: shareable, they survive a reload, and the back button steps
 * through them. Typing in the search box is debounced and replaces the address entry instead of adding one
 * per pause; choosing a role or a status, or a page, adds one. Changing a filter goes back to page 1.
 */
export function useAdminFilters() {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearch(params), [params])

  const apply = useCallback(
    (patch: Partial<AdminFilters>, options: { replace?: boolean } = {}) => {
      const next: AdminFilters = { ...filters, ...patch }
      if (patch.page === undefined) next.page = 1
      setParams(searchFromFilters(next), { replace: options.replace ?? false })
    },
    [filters, setParams],
  )

  // The search box shows what is typed at once; the address follows a moment later.
  const [qInput, setQInput] = useState(filters.q)
  const pushed = useRef(filters.q)

  // The address changed by itself (back, a link, clear filters): show it, unless it is our own echo.
  useEffect(() => {
    if (filters.q !== pushed.current) {
      pushed.current = filters.q
      setQInput(filters.q)
    }
  }, [filters.q])

  // After a pause in typing, put it in the address.
  useEffect(() => {
    const q = qInput.trim()
    if (q === filters.q) return
    const timer = setTimeout(() => {
      pushed.current = q
      apply({ q }, { replace: true })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [qInput, filters.q, apply])

  const clear = useCallback(() => {
    pushed.current = ''
    setQInput('')
    setParams(searchFromFilters(NO_FILTERS))
  }, [setParams])

  return { filters, apply, clear, qInput, setQInput }
}
