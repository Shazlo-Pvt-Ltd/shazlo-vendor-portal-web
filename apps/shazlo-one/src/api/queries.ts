import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from './context'
import type { components } from './identity'
import { reviewerIds, toHomeSummary, type HomeSummary } from './summary'

type S = components['schemas']

export const keys = {
  summary: ['vendor-summary'] as const,
  adminNames: ['admin-names'] as const,
  admins: (q: AdminFilters) => ['admins', q] as const,
  allAdmins: ['admins'] as const,
  roles: ['roles'] as const,
}

export type AdminFilters = { q?: string; role?: string; is_active?: boolean }

// Names change rarely: one lookup serves the summary's refreshes for five minutes.
const NAMES_FRESH_MS = 5 * 60_000
// An admin id to its display name; null when identity-api answered that it knows no such admin.
type KnownNames = Record<string, string | null>

// Counts and recent decisions for Home and the sidebar badge, from vendor-api with an exchanged token.
// A decision names its admin by id; the names come from identity-api. An id identity-api does not
// know reads "a former admin". A lookup that fails keeps the names of the last one that worked (an
// admin is not called "former" because identity-api blinked) and never fails the figures.
export function useVendorSummary(enabled = true) {
  const { vendorApi, identity, queryClient } = useAppContext()

  async function names(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const known = queryClient.getQueryData<KnownNames>(keys.adminNames)
    const covered = known !== undefined && ids.every((id) => id in known)
    let found: KnownNames | undefined
    try {
      found = await queryClient.fetchQuery({
        queryKey: keys.adminNames,
        queryFn: async () => {
          const answer = await identity.call((c) => c.GET('/v1/admins/names', { params: { query: { ids } } }))
          const next: KnownNames = Object.fromEntries(ids.map((id) => [id, null]))
          for (const admin of answer.items) next[admin.id] = admin.display_name
          return next
        },
        // A new reviewer in the list is looked up at once; otherwise the last answer serves.
        staleTime: covered ? NAMES_FRESH_MS : 0,
        // Kept until sign-out clears the cache, so a failed lookup has something to fall back on.
        gcTime: Infinity,
        // The figures wait for this; a failure falls back rather than retries.
        retry: false,
      })
    } catch {
      found = queryClient.getQueryData<KnownNames>(keys.adminNames)
    }
    return new Map(Object.entries(found ?? {}).flatMap(([id, name]) => (name ? [[id, name] as const] : [])))
  }

  return useQuery<HomeSummary>({
    queryKey: keys.summary,
    queryFn: async () => {
      const wire = await vendorApi.call((c) => c.GET('/v1/admin/summary'))
      return toHomeSummary(wire, await names(reviewerIds(wire)))
    },
    enabled,
    refetchInterval: 60_000,
  })
}

export function useAdmins(filters: AdminFilters) {
  const { identity } = useAppContext()
  return useQuery({ queryKey: keys.admins(filters), queryFn: () => identity.call((c) => c.GET('/v1/admins', { params: { query: { ...filters, limit: 100 } } })) })
}

export function useRoles() {
  const { identity } = useAppContext()
  return useQuery({ queryKey: keys.roles, queryFn: () => identity.call((c) => c.GET('/v1/roles')), staleTime: Infinity })
}

export function useCreateAdmin() {
  const { identity } = useAppContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['CreateAdminRequest']) => identity.call((c) => c.POST('/v1/admins', { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.allAdmins }),
  })
}

export function useUpdateAdmin() {
  const { identity } = useAppContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: S['UpdateAdminRequest'] & { id: string }) => identity.call((c) => c.PATCH('/v1/admins/{admin_id}', { params: { path: { admin_id: id } }, body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.allAdmins }),
  })
}

export function useResetPassword() {
  const { identity } = useAppContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => identity.call((c) => c.POST('/v1/admins/{admin_id}/reset-password', { params: { path: { admin_id: id } }, body: { new_password: password } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.allAdmins }),
  })
}

// Temporary passwords for new or reset admins: 16 characters, easy to read aloud.
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const raw = [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`
}
