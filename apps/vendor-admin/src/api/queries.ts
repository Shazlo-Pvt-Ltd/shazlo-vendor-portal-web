import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRuntime } from '../runtime/runtime'
import type { components } from './schema'

type S = components['schemas']

export type QueueFilters = { kind?: S['ItemKind']; vendor?: string; q?: string; submitted?: 'today' | '24h' | 'older'; resubmissions?: boolean; sort?: 'oldest' | 'newest' }
export type VendorFilters = { status?: S['VendorStatus']; q?: string; city?: string; sort?: 'name' | 'newest' | 'products' }

export const keys = {
  summary: ['summary'] as const,
  queue: (f: QueueFilters) => ['queue', f] as const,
  allQueue: ['queue'] as const,
  product: (id: string) => ['product-review', id] as const,
  brand: (vendorId: string) => ['brand-review', vendorId] as const,
  vendors: (f: VendorFilters) => ['vendors', f] as const,
  allVendors: ['vendors'] as const,
  vendor: (id: string) => ['vendor', id] as const,
  outbox: (status?: S['OutboxStatus']) => ['outbox', status ?? 'all'] as const,
  allOutbox: ['outbox'] as const,
}

// After any decision the queue, the counts and publishing all change.
function useInvalidateAfterDecision() {
  const qc = useQueryClient()
  return () => {
    for (const key of [keys.allQueue, keys.summary, keys.allOutbox, keys.allVendors]) void qc.invalidateQueries({ queryKey: key })
  }
}

export function useSummary() {
  const { api } = useRuntime()
  return useQuery({ queryKey: keys.summary, queryFn: () => api.call((c) => c.GET('/api/v1/admin/summary')) })
}

export function useQueue(filters: QueueFilters) {
  const { api } = useRuntime()
  return useQuery({ queryKey: keys.queue(filters), queryFn: () => api.call((c) => c.GET('/api/v1/admin/queue', { params: { query: filters } })), placeholderData: keepPreviousData })
}

export function useProductReview(id: string) {
  const { api } = useRuntime()
  return useQuery({ queryKey: keys.product(id), queryFn: () => api.call((c) => c.GET('/api/v1/admin/products/{id}/review', { params: { path: { id } } })) })
}

export function useApproveProduct(id: string) {
  const { api } = useRuntime()
  const invalidate = useInvalidateAfterDecision()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.call((c) => c.POST('/api/v1/admin/products/{id}/approve', { params: { path: { id } } })),
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: keys.product(id) })
    },
  })
}

export function useRejectProduct(id: string) {
  const { api } = useRuntime()
  const invalidate = useInvalidateAfterDecision()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['RejectBody']) => api.call((c) => c.POST('/api/v1/admin/products/{id}/reject', { params: { path: { id } }, body })),
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: keys.product(id) })
    },
  })
}

export function useBrandReview(vendorId: string) {
  const { api } = useRuntime()
  return useQuery({ queryKey: keys.brand(vendorId), queryFn: () => api.call((c) => c.GET('/api/v1/admin/brand-pages/{vendor_id}/review', { params: { path: { vendor_id: vendorId } } })) })
}

export function useApproveBrand(vendorId: string) {
  const { api } = useRuntime()
  const invalidate = useInvalidateAfterDecision()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.call((c) => c.POST('/api/v1/admin/brand-pages/{vendor_id}/approve', { params: { path: { vendor_id: vendorId } } })),
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: keys.brand(vendorId) })
    },
  })
}

export function useRejectBrand(vendorId: string) {
  const { api } = useRuntime()
  const invalidate = useInvalidateAfterDecision()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['RejectBody']) => api.call((c) => c.POST('/api/v1/admin/brand-pages/{vendor_id}/reject', { params: { path: { vendor_id: vendorId } }, body })),
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: keys.brand(vendorId) })
    },
  })
}

export function useVendors(filters: VendorFilters) {
  const { api } = useRuntime()
  return useQuery({ queryKey: keys.vendors(filters), queryFn: () => api.call((c) => c.GET('/api/v1/admin/vendors', { params: { query: filters } })), placeholderData: keepPreviousData })
}

export function useVendor(id: string) {
  const { api } = useRuntime()
  return useQuery({ queryKey: keys.vendor(id), queryFn: () => api.call((c) => c.GET('/api/v1/admin/vendors/{id}', { params: { path: { id } } })) })
}

type VendorAction =
  | { action: 'approve'; body: { commission_bps: number; agreement_ref: string; owner_email?: string } }
  | { action: 'reject'; body: { reason: string } }
  | { action: 'request-info'; body: { message: string } }
  | { action: 'suspend'; body: { reason: string } }
  | { action: 'reactivate' }

export function useVendorAction(id: string) {
  const { api } = useRuntime()
  const invalidate = useInvalidateAfterDecision()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (a: VendorAction) => {
      const path = { params: { path: { id } } }
      switch (a.action) {
        case 'approve':
          return api.call((c) => c.POST('/api/v1/admin/vendors/{id}/approve', { ...path, body: a.body }))
        case 'reject':
          return api.call((c) => c.POST('/api/v1/admin/vendors/{id}/reject', { ...path, body: a.body }))
        case 'request-info':
          return api.call((c) => c.POST('/api/v1/admin/vendors/{id}/request-info', { ...path, body: a.body }))
        case 'suspend':
          return api.call((c) => c.POST('/api/v1/admin/vendors/{id}/suspend', { ...path, body: a.body }))
        case 'reactivate':
          return api.call((c) => c.POST('/api/v1/admin/vendors/{id}/reactivate', path))
      }
    },
    onSuccess: (vendor) => {
      qc.setQueryData(keys.vendor(id), vendor)
      invalidate()
    },
  })
}

export function useOutbox(status?: S['OutboxStatus']) {
  const { api } = useRuntime()
  return useQuery({ queryKey: keys.outbox(status), queryFn: () => api.call((c) => c.GET('/api/v1/admin/outbox', { params: { query: { status } } })), placeholderData: keepPreviousData, refetchInterval: 30_000 })
}

export function useRetryEvent() {
  const { api } = useRuntime()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.call((c) => c.POST('/api/v1/admin/outbox/{id}/retry', { params: { path: { id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.allOutbox })
      void qc.invalidateQueries({ queryKey: keys.summary })
    },
  })
}

export function useRetryFailed() {
  const { api } = useRuntime()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.call((c) => c.POST('/api/v1/admin/outbox/retry-failed')),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.allOutbox })
      void qc.invalidateQueries({ queryKey: keys.summary })
    },
  })
}
