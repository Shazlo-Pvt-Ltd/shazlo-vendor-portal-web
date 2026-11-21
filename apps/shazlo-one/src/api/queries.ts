import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from './context'
import type { components } from './identity'

type S = components['schemas']

export const keys = {
  summary: ['vendor-summary'] as const,
  admins: (q: AdminFilters) => ['admins', q] as const,
  allAdmins: ['admins'] as const,
  roles: ['roles'] as const,
}

export type AdminFilters = { q?: string; role?: string; is_active?: boolean }

// Counts for Home and the sidebar badge, from vendor-api with an exchanged token.
export function useVendorSummary(enabled = true) {
  const { vendorApi } = useAppContext()
  return useQuery({ queryKey: keys.summary, queryFn: () => vendorApi.call((c) => c.GET('/api/v1/admin/summary')), enabled, refetchInterval: 60_000 })
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
    mutationFn: (body: S['CreateAdmin']) => identity.call((c) => c.POST('/v1/admins', { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.allAdmins }),
  })
}

export function useUpdateAdmin() {
  const { identity } = useAppContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: S['UpdateAdmin'] & { id: string }) => identity.call((c) => c.PATCH('/v1/admins/{admin_id}', { params: { path: { admin_id: id } }, body })),
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
