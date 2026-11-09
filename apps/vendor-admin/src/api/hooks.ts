import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useShell } from '../app/shell'
import { api } from './mock'
import type { ApproveVendorInput, BrandDecisionInput, ProductDecisionInput, VendorReasonInput } from './types'

export const keys = {
  queue: ['queue'] as const,
  product: (id: string) => ['product', id] as const,
  brand: (id: string) => ['brand', id] as const,
  vendors: ['vendors'] as const,
  vendor: (id: string) => ['vendors', id] as const,
  outbox: ['outbox'] as const,
}

export const useQueue = () => useQuery({ queryKey: keys.queue, queryFn: api.getQueue })
export const useProductSubmission = (id: string) => useQuery({ queryKey: keys.product(id), queryFn: () => api.getProduct(id) })
export const useBrandSubmission = (id: string) => useQuery({ queryKey: keys.brand(id), queryFn: () => api.getBrand(id) })
export const useVendors = () => useQuery({ queryKey: keys.vendors, queryFn: api.listVendors })
export const useVendor = (id: string) => useQuery({ queryKey: keys.vendor(id), queryFn: () => api.getVendor(id) })
export const useOutbox = () => useQuery({ queryKey: keys.outbox, queryFn: api.getOutbox })

/**
 * The name the mock records in the audit trail. The real vendor-api takes the reviewer from the
 * token's sub claim (ADR 0009); the UI never sends an "approve as" field.
 */
function useActor() {
  const { user } = useShell()
  return user?.name ?? user?.email ?? 'Reviewer'
}

/** Every decision changes the queue counts, the vendor list and the publishing outbox. */
function useInvalidateAll() {
  const qc = useQueryClient()
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: keys.queue }),
    qc.invalidateQueries({ queryKey: keys.vendors }),
    qc.invalidateQueries({ queryKey: keys.outbox }),
  ])
}

export function useDecideProduct() {
  const actor = useActor()
  const qc = useQueryClient()
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: ProductDecisionInput) => api.decideProduct(input, actor),
    onSuccess: p => { qc.setQueryData(keys.product(p.id), p); return invalidate() },
  })
}

export function useDecideBrand() {
  const actor = useActor()
  const qc = useQueryClient()
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: BrandDecisionInput) => api.decideBrand(input, actor),
    onSuccess: b => { qc.setQueryData(keys.brand(b.id), b); return invalidate() },
  })
}

function useVendorMutation<I>(fn: (input: I, actor: string) => ReturnType<typeof api.getVendor>) {
  const actor = useActor()
  const qc = useQueryClient()
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: I) => fn(input, actor),
    onSuccess: v => { qc.setQueryData(keys.vendor(v.id), v); return invalidate() },
  })
}

export const useOpenApplication = () => useVendorMutation((id: string, actor) => api.openApplication(id, actor))
export const useRequestInfo = () => useVendorMutation((input: VendorReasonInput, actor) => api.requestInfo(input, actor))
export const useRejectVendor = () => useVendorMutation((input: VendorReasonInput, actor) => api.rejectVendor(input, actor))
export const useApproveVendor = () => useVendorMutation((input: ApproveVendorInput, actor) => api.approveVendor(input, actor))
export const useSuspendVendor = () => useVendorMutation((input: VendorReasonInput, actor) => api.suspendVendor(input, actor))
export const useReactivateVendor = () => useVendorMutation((id: string, actor) => api.reactivateVendor(id, actor))

export function useRetryEvents() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (ids: string[]) => api.retryEvents(ids), onSuccess: () => qc.invalidateQueries({ queryKey: keys.outbox }) })
}
