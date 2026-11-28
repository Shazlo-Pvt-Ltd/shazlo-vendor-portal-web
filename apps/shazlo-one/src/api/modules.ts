import { actorIds, badgeOf, manifestUrl, parseManifest, parseSummary, type ModuleManifest, type ModuleSummary, type RegistryEntry } from '@shazlo/shell-protocol'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { shellCopy } from '../copy/shell'
import { useAppContext, type AppContext, type SessionStore } from './context'
import { ApiError, toApiError } from './http'

// ADR 0011: what the shell reads from each module. Neither call may hold the shell up: each gives up
// after five seconds, and a module that fails shows its registry title and no badge, never a 0.

export const MODULE_FETCH_TIMEOUT_MS = 5_000
const copy = shellCopy.module

export const moduleKeys = {
  manifest: (id: string) => ['module-manifest', id] as const,
  summary: (id: string) => ['module-summary', id] as const,
  // The names of the admins the summaries name, shared by every module.
  adminNames: ['admin-names'] as const,
}

// Names change rarely: one lookup serves the summaries' refreshes for five minutes.
export const NAMES_FRESH_MS = 5 * 60_000
// An admin id to its display name; null when identity-api answered that it knows no such admin.
type KnownNames = Record<string, string | null>

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

/**
 * The display names of these identity-api admins. An id identity-api does not know reads "a former
 * admin". The figures matter more than the names, so this never fails: a lookup that fails keeps the
 * names of the last one that worked (an admin is not called "former" because identity-api blinked),
 * and with none, every admin reads "a former admin". One answer serves for five minutes unless it
 * lacks someone.
 */
export async function lookUpAdminNames(queryClient: QueryClient, identity: AppContext['identity'], ids: string[]): Promise<Record<string, string>> {
  const known = queryClient.getQueryData<KnownNames>(moduleKeys.adminNames)
  const covered = known !== undefined && ids.every((id) => id in known)
  let found: KnownNames | undefined
  try {
    found = await queryClient.fetchQuery({
      queryKey: moduleKeys.adminNames,
      queryFn: async () => {
        const answer = await identity.call((c) => c.GET('/v1/admins/names', { params: { query: { ids } } }))
        // Kept with what other modules' summaries asked for, so they do not ask again.
        const next: KnownNames = { ...queryClient.getQueryData<KnownNames>(moduleKeys.adminNames), ...Object.fromEntries(ids.map((id) => [id, null])) }
        for (const admin of answer.items) next[admin.id] = admin.display_name
        return next
      },
      // Someone new in the list is looked up at once; otherwise the last answer serves.
      staleTime: covered ? NAMES_FRESH_MS : 0,
      // Kept until sign-out clears the cache, so a failed lookup has something to fall back on.
      gcTime: Infinity,
      // The figures wait for this; a failure falls back rather than retries.
      retry: false,
    })
  } catch {
    found = queryClient.getQueryData<KnownNames>(moduleKeys.adminNames)
  }
  return Object.fromEntries(Object.entries(found ?? {}).flatMap(([id, name]) => (name ? [[id, name] as const] : [])))
}

/** The module's summary with the module's own token, every minute. Disabled for a module with none. */
export function useModuleSummary(entry: RegistryEntry, enabled = true) {
  const { session, identity, queryClient } = useAppContext()
  const { summaryUrl } = entry
  return useQuery({
    queryKey: moduleKeys.summary(entry.id),
    queryFn: () => fetchSummary({ ...entry, summaryUrl: summaryUrl! }, session, (ids) => lookUpAdminNames(queryClient, identity, ids)),
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
