import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from './context'
import type { components } from './identity'

type S = components['schemas']

export const keys = {
  admins: (q: AdminFilters & { page?: number }) => ['admins', q] as const,
  allAdmins: ['admins'] as const,
  roles: ['roles'] as const,
}

export type AdminFilters = { q?: string; role?: string; is_active?: boolean }

// identity-api pages the list; the screen shows this many at a time.
export const ADMINS_PAGE_SIZE = 50

/** One page (from 1) of the admins that match. */
export function useAdmins(filters: AdminFilters, page = 1) {
  const { identity } = useAppContext()
  return useQuery({
    queryKey: keys.admins({ ...filters, page }),
    queryFn: () => identity.call((c) => c.GET('/v1/admins', { params: { query: { ...filters, limit: ADMINS_PAGE_SIZE, offset: (page - 1) * ADMINS_PAGE_SIZE } } })),
  })
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
    // The body holds the temporary password: the cache drops it as soon as nothing watches it.
    gcTime: 0,
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
    gcTime: 0,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.allAdmins }),
  })
}

// Temporary passwords for new or reset admins: 16 characters from an alphabet without look-alikes
// (no 0, o, 1, l, i), in groups of four to read aloud, about 79 bits. Each character is drawn without
// bias: the low five bits of a random byte pick one of 32 places, and the one place past the 31-letter
// alphabet is thrown away (rejection sampling). No modulo: CodeQL flagged the plain `byte % length`
// this replaced, and a mask of a power of two minus one is uniform.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const FIVE_BITS = 0b11111
export const TEMPORARY_PASSWORD_LENGTH = 16

export function temporaryPassword(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (bytes) => crypto.getRandomValues(bytes)): string {
  let raw = ''
  while (raw.length < TEMPORARY_PASSWORD_LENGTH) {
    for (const byte of random(new Uint8Array(32))) {
      const index = byte & FIVE_BITS
      if (index >= ALPHABET.length) continue
      raw += ALPHABET[index]
      if (raw.length === TEMPORARY_PASSWORD_LENGTH) break
    }
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`
}
