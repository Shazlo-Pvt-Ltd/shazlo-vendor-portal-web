import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { QueueFilters } from '../../../api/queries'
import { queueCopy, type KindKey, type SortKey, type SubmittedKey } from '../../../copy/queue'

export const DEFAULT_SORT: SortKey = 'oldest'

// Everything the queue shows is in the URL, so back, forward, reload and shared links keep it.
export interface QueueParams {
  kind: KindKey | undefined
  q: string
  vendor: string
  submitted: SubmittedKey | undefined
  resubmissions: boolean
  sort: SortKey
}

export type ParamKey = keyof QueueParams
export type Patch = Partial<Record<ParamKey, string | boolean | undefined>>

const KINDS: KindKey[] = ['product', 'brand_page', 'application']
const SUBMITTED = queueCopy.filters.submittedOptions.map((o) => o.value)
const SORTS = queueCopy.filters.sortOptions.map((o) => o.value)

function oneOf<T extends string>(list: readonly T[], value: string | null): T | undefined {
  return list.find((item) => item === value)
}

export function parseQueueParams(search: URLSearchParams): QueueParams {
  return {
    kind: oneOf(KINDS, search.get('kind')),
    q: search.get('q')?.trim() ?? '',
    vendor: search.get('vendor') ?? '',
    submitted: oneOf(SUBMITTED, search.get('submitted')),
    resubmissions: search.get('resubmissions') === 'true',
    sort: oneOf(SORTS, search.get('sort')) ?? DEFAULT_SORT,
  }
}

// What the API is asked for. Defaults are left out, so the plain queue shares one cache entry.
export function toFilters(p: QueueParams): QueueFilters {
  return {
    kind: p.kind,
    q: p.q || undefined,
    vendor: p.vendor || undefined,
    submitted: p.submitted,
    resubmissions: p.resubmissions || undefined,
    sort: p.sort === DEFAULT_SORT ? undefined : p.sort,
  }
}

// Filters narrow the list inside a tab; the tab itself and the sort are not filters.
export const hasFilters = (p: QueueParams) => Boolean(p.q || p.vendor || p.submitted || p.resubmissions)
export const clearedFilters: Patch = { q: undefined, vendor: undefined, submitted: undefined, resubmissions: undefined }

export function useQueueParams() {
  const [search, setSearch] = useSearchParams()
  const params = useMemo(() => parseQueueParams(search), [search])

  const update = useCallback(
    (patch: Patch, { replace = false }: { replace?: boolean } = {}) => {
      setSearch(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(patch)) {
            const empty = value === undefined || value === '' || value === false || (key === 'sort' && value === DEFAULT_SORT)
            if (empty) next.delete(key)
            else next.set(key, String(value))
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
