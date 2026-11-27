import { actorIds, badgeOf, manifestUrl, parseManifest, parseSummary, type ModuleManifest, type ModuleSummary, type RegistryEntry } from '@shazlo/shell-protocol'
import { useQuery } from '@tanstack/react-query'
import { shellCopy } from '../copy/shell'
import { useAppContext, type SessionStore } from './context'
import { ApiError, toApiError } from './http'

// ADR 0011: what the shell reads from each module. Neither call may hold the shell up: each gives up
// after five seconds, and a module that fails shows its registry title and no badge, never a 0.

export const MODULE_FETCH_TIMEOUT_MS = 5_000
const copy = shellCopy.module

export const moduleKeys = {
  manifest: (id: string) => ['module-manifest', id] as const,
  summary: (id: string) => ['module-summary', id] as const,
}

/** `promise`, or an `unreachable` ApiError once `ms` have passed. */
export function withTimeout<T>(promise: Promise<T>, ms: number = MODULE_FETCH_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError(0, 'unreachable', copy.unreachable)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

// A network failure from a module is "it did not answer", not "you are offline": the rest of Shazlo One works.
async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await withTimeout(fetch(url, { ...init, cache: 'no-store' }))
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(0, 'unreachable', copy.unreachable)
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

export async function fetchManifest(entry: RegistryEntry): Promise<ModuleManifest> {
  // The manifest is public: no token, no cookies.
  const response = await request(manifestUrl(entry.url), { credentials: 'omit', headers: { Accept: 'application/json' } })
  const body = await readJson(response)
  if (!response.ok) throw toApiError(response, body)
  const manifest = parseManifest(body, entry.id)
  if (!manifest) throw new ApiError(response.status, 'invalid_manifest', copy.invalid)
  return manifest
}

export type LoadedSummary = { summary: ModuleSummary; names: Record<string, string> }

export async function fetchSummary(entry: RegistryEntry & { summaryUrl: string }, session: SessionStore, names: (ids: string[]) => Promise<Record<string, string>>): Promise<LoadedSummary> {
  const send = async (force: boolean) => {
    const { token } = await session.moduleToken(entry.audience, force)
    return request(entry.summaryUrl, { credentials: 'omit', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } })
  }
  let response = await send(false)
  // A token the module no longer takes (rotated keys, a role change): one new token, one more try.
  if (response.status === 401) response = await send(true)
  const body = await readJson(response)
  if (!response.ok) throw toApiError(response, body)
  const summary = parseSummary(body)
  if (!summary) throw new ApiError(response.status, 'invalid_summary', copy.invalid)
  const ids = actorIds(summary)
  return { summary, names: ids.length > 0 ? await names(ids) : {} }
}

/** The module's manifest, read once per session. Failing is fine: the module keeps its registry title. */
export function useModuleManifest(entry: RegistryEntry, enabled = true) {
  return useQuery({
    queryKey: moduleKeys.manifest(entry.id),
    queryFn: () => fetchManifest(entry),
    enabled,
    staleTime: Infinity,
    retry: false,
  })
}

/** The module's summary with the module's own token, every minute. Disabled for a module with none. */
export function useModuleSummary(entry: RegistryEntry, enabled = true) {
  const { session, identity } = useAppContext()
  const { summaryUrl } = entry
  return useQuery({
    queryKey: moduleKeys.summary(entry.id),
    queryFn: () =>
      fetchSummary({ ...entry, summaryUrl: summaryUrl! }, session, async (ids) => {
        // The figures matter more than the names: a lookup that fails leaves "a former admin".
        try {
          const found = await identity.call((c) => c.GET('/v1/admins/names', { params: { query: { ids } } }))
          return Object.fromEntries(found.items.map((a) => [a.id, a.display_name]))
        } catch {
          return {}
        }
      }),
    enabled: enabled && Boolean(summaryUrl),
    refetchInterval: 60_000,
    // Once more when the module did not answer; an answer it gave (4xx, invalid) stands.
    retry: (count, error) => count < 1 && error instanceof ApiError && error.code === 'unreachable',
  })
}

/** The badge for a module's row: only from a summary that was just read. A failed read shows none. */
export function useModuleBadge(entry: RegistryEntry, enabled = true): { count: number; label: string } | null {
  const query = useModuleSummary(entry, enabled)
  return query.isError ? null : badgeOf(query.data?.summary)
}
