import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRuntime } from '../runtime/runtime'
import { ApiError, type Api } from './http'
import type { ApiPaths } from './client'
import { toCommission, withCommission } from './adapters/commission'
import { joinSlices, nextOffset, QUEUE_MAX_PAGE_SIZE, QUEUE_PAGE_SIZE, toQueueSlice, type QueueSlice } from './adapters/queue'
import type * as M from './model'


export type QueueFilters = { kind?: M.ItemKind; vendor?: string; q?: string; submitted?: 'today' | '24h' | 'older'; resubmissions?: boolean; sort?: 'oldest' | 'newest' }
export type VendorFilters = { status?: M.VendorStatus; q?: string; city?: string; sort?: 'name' | 'newest' | 'products'; commission?: M.CommissionState }

export const keys = {
  summary: ['summary'] as const,
  queue: (f: QueueFilters) => ['queue', f] as const,
  allQueue: ['queue'] as const,
  product: (id: string) => ['product-review', id] as const,
  allProducts: ['product-review'] as const,
  brand: (vendorId: string) => ['brand-review', vendorId] as const,
  vendors: (f: VendorFilters) => ['vendors', f] as const,
  allVendors: ['vendors'] as const,
  vendor: (id: string) => ['vendor', id] as const,
  outbox: (status?: M.OutboxStatus) => ['outbox', status ?? 'all'] as const,
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

async function fetchQueueSlice(api: Api<ApiPaths>, filters: QueueFilters, offset: number, limit: number): Promise<QueueSlice> {
  const wire = await api.call((c) => c.GET('/v1/admin/queue', { params: { query: { ...filters, limit, offset } } }))
  return toQueueSlice(wire)
}

// The queue a page at a time, joined into one list as "Show more" loads the next. `counts`, `vendors`
// and `total` describe the whole waiting queue as of the newest request.
export function useQueue(filters: QueueFilters) {
  const { api } = useRuntime()
  return useInfiniteQuery({
    queryKey: keys.queue(filters),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchQueueSlice(api, filters, pageParam, QUEUE_PAGE_SIZE),
    getNextPageParam: nextOffset,
    select: (data) => joinSlices(data.pages),
    placeholderData: keepPreviousData,
  })
}

// Every item that matches the filters, not just the pages on screen: the CSV export. Pages are
// fetched one after another at the server's largest size.
export async function fetchEveryQueueItem(api: Api<ApiPaths>, filters: QueueFilters): Promise<M.QueueItem[]> {
  const slices: QueueSlice[] = []
  let offset: number | undefined = 0
  while (offset !== undefined) {
    const slice: QueueSlice = await fetchQueueSlice(api, filters, offset, QUEUE_MAX_PAGE_SIZE)
    slices.push(slice)
    offset = nextOffset(slice)
  }
  return joinSlices(slices).items
}

// Every item that matches the filters, as one query (the dashboard's brands with products waiting).
// Its key starts with the queue's, so a decision refreshes it with the queue.
export function useEveryQueueItem(filters: QueueFilters) {
  const { api } = useRuntime()
  return useQuery({ queryKey: [...keys.queue(filters), 'every'] as const, queryFn: () => fetchEveryQueueItem(api, filters) })
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
    mutationFn: (body: M.RejectBody) => api.call((c) => c.POST('/api/v1/admin/products/{id}/reject', { params: { path: { id } }, body })),
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
    mutationFn: (body: M.RejectBody) => api.call((c) => c.POST('/api/v1/admin/brand-pages/{vendor_id}/reject', { params: { path: { vendor_id: vendorId } }, body })),
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

export type CommissionAction = { step: 'approve'; proposed_bps: number } | { step: 'send-back'; body: { note: string } } | { step: 'set'; body: { commission_bps: number; note?: string } }

// Codes that mean the vendor's commission is not what the card shows: read it again.
const STALE_COMMISSION = new Set(['commission_changed', 'no_proposal'])

// Approve a brand's proposed rate (the one the card shows), send it back with a note, or set the rate
// directly. vendor-api answers with the brand's commission, which goes into the vendor the page holds;
// the vendor is read again too, because its history gained an entry.
export function useCommissionAction(id: string) {
  const { api } = useRuntime()
  const invalidate = useInvalidateAfterDecision()
  const qc = useQueryClient()
  const refetchVendor = () => qc.invalidateQueries({ queryKey: keys.vendor(id) })
  return useMutation({
    mutationFn: async (a: CommissionAction) => {
      const path = { params: { path: { vendor_id: id } } }
      switch (a.step) {
        case 'approve':
          return toCommission(await api.call((c) => c.POST('/v1/admin/vendors/{vendor_id}/commission/approve', { ...path, body: { proposed_bps: a.proposed_bps } })))
        case 'send-back':
          return toCommission(await api.call((c) => c.POST('/v1/admin/vendors/{vendor_id}/commission/send-back', { ...path, body: a.body })))
        case 'set':
          return toCommission(await api.call((c) => c.POST('/v1/admin/vendors/{vendor_id}/commission/set', { ...path, body: a.body })))
      }
    },
    onSuccess: (commission) => {
      qc.setQueryData<M.VendorDetail>(keys.vendor(id), (vendor) => vendor && withCommission(vendor, commission))
      void refetchVendor()
      invalidate()
    },
    onError: (error) => {
      if (error instanceof ApiError && STALE_COMMISSION.has(error.code)) {
        void refetchVendor()
        invalidate()
      }
    },
  })
}

// Approve several of one vendor's waiting products at once, each with the version the reviewer saw.
// The answer lists what was approved and what was not; both change the vendor and the product pages.
export function useApproveProducts(vendorId: string) {
  const { api } = useRuntime()
  const invalidate = useInvalidateAfterDecision()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: M.ApproveProductsBody) => api.call((c) => c.POST('/api/v1/admin/vendors/{id}/products/approve', { params: { path: { id: vendorId } }, body })),
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: keys.vendor(vendorId) })
      void qc.invalidateQueries({ queryKey: keys.allProducts })
    },
  })
}

export function useOutbox(status?: M.OutboxStatus) {
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
