import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { NO_FILTERS, filtersFromSearch, searchFromFilters, type ProductFilters } from './filters'

const DEBOUNCE_MS = 300

/**
 * The list's filters, kept in the address: shareable, they survive a reload, and the back button
 * steps through them. Typing in the search boxes is debounced and replaces the address entry
 * instead of adding one per pause; choosing a status or a page adds one. Changing a filter goes back
 * to page 1.
 */
export function useProductFilters() {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearch(params), [params])

  const apply = useCallback(
    (patch: Partial<ProductFilters>, options: { replace?: boolean; keepPage?: boolean } = {}) => {
      const next: ProductFilters = { ...filters, ...patch }
      if (!options.keepPage && patch.page === undefined) next.page = 1
      setParams(searchFromFilters(next), { replace: options.replace ?? false })
    },
    [filters, setParams],
  )

  // The two text boxes show what is typed at once; the address follows a moment later.
  const [qInput, setQInput] = useState(filters.q)
  const [categoryInput, setCategoryInput] = useState(filters.category)
  const pushed = useRef({ q: filters.q, category: filters.category })

  // The address changed by itself (back, a link, clear filters): show it, unless it is our own echo.
  useEffect(() => {
    if (filters.q !== pushed.current.q) {
      pushed.current.q = filters.q
      setQInput(filters.q)
    }
    if (filters.category !== pushed.current.category) {
      pushed.current.category = filters.category
      setCategoryInput(filters.category)
    }
  }, [filters.q, filters.category])

  // After a pause in typing, put it in the address.
  useEffect(() => {
    const q = qInput.trim()
    const category = categoryInput.trim()
    if (q === filters.q && category === filters.category) return
    const timer = setTimeout(() => {
      pushed.current = { q, category }
      apply({ q, category }, { replace: true })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [qInput, categoryInput, filters.q, filters.category, apply])

  const clear = useCallback(() => {
    pushed.current = { q: '', category: '' }
    setQInput('')
    setCategoryInput('')
    setParams(searchFromFilters(NO_FILTERS))
  }, [setParams])

  return { filters, apply, clear, qInput, setQInput, categoryInput, setCategoryInput }
}
