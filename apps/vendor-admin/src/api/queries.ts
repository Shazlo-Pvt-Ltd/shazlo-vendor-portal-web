import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useRuntime } from '../runtime/runtime'
import { ApiError, type Api } from './http'
import type { ApiPaths } from './client'
import { afterDecision, neighboursIn, toBrandReview, toDecision, toPolicies, toProductReview } from './adapters/review'
import { toCommission, withCommission } from './adapters/commission'
import { joinSlices, nextOffset, QUEUE_MAX_PAGE_SIZE, QUEUE_PAGE_SIZE, toQueueSlice, type QueueSlice } from './adapters/queue'
import type * as M from './model'


export type QueueFilters = { kind?: M.ItemKind; vendor?: string; q?: string; submitted?: 'today' | '24h' | 'older'; resubmissions?: boolean; sort?: 'oldest' | 'newest' }
export type VendorFilters = { status?: M.VendorStatus; q?: string; city?: string; sort?: 'name' | 'newest' | 'products'; commission?: M.CommissionState }

export const keys = {
  summary: ['summary'] as const,
  queue: (f: QueueFilters) => ['queue', f] as const,
  allQueue: ['queue'] as const,
  queueOrder: ['queue', 'order'] as const,
  review: (reviewId: string) => ['review', reviewId] as const,
  allReviews: ['review'] as const,
  storeDetails: (vendorId: string) => ['store-details', vendorId] as const,
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

// The queue's own order (oldest first, one page of the most the server returns), kept for the review
// pages: the item before and after the one on screen are its neighbours. Past the first page of a very
// long queue a page simply has no neighbours.
export function useQueueOrder() {
  const { api } = useRuntime()
  return useQuery({ queryKey: keys.queueOrder, queryFn: () => fetchQueueSlice(api, {}, 0, QUEUE_MAX_PAGE_SIZE) })
}

// One review as vendor-api has it; the two screens read it as a product or as a brand page.
export function useReviewDetail(reviewId: string) {
  const { api } = useRuntime()
  return useQuery({
    queryKey: keys.review(reviewId),
    queryFn: () => api.call((c) => c.GET('/v1/admin/reviews/{review_id}', { params: { path: { review_id: reviewId } } })),
  })
}

// What the page needs of a query: its data (once adapted), whether it is loading or failed, and a retry.
type ReviewQuery<T> = { data: T | undefined; isPending: boolean; isError: boolean; error: Error | null; refetch: () => Promise<unknown> }

// A review of the wrong kind for the page (a brand page opened as a product) is "not found", like an unknown id.
const wrongKind = () => new ApiError(404, 'review_not_found', 'Review not found')

function adapted<T>(detail: ReturnType<typeof useReviewDetail>, data: T | null | undefined): ReviewQuery<T> {
  const mismatch = detail.data !== undefined && data === null
  return { data: data ?? undefined, isPending: detail.isPending, isError: detail.isError || mismatch, error: detail.error ?? (mismatch ? wrongKind() : null), refetch: detail.refetch }
}

export function useProductReview(reviewId: string): ReviewQuery<M.ProductReview> {
  const detail = useReviewDetail(reviewId)
  const order = useQueueOrder()
  const items = order.data?.items
  const data = useMemo(() => (detail.data ? toProductReview(detail.data, neighboursIn(items ?? [], reviewId)) : undefined), [detail.data, items, reviewId])
  return adapted(detail, data)
}

export function useBrandReview(reviewId: string): ReviewQuery<M.BrandReview> {
  const { api } = useRuntime()
  const detail = useReviewDetail(reviewId)
  const order = useQueueOrder()
  const items = order.data?.items
  // Returns and delivery are the vendor's store details; the page still opens if they cannot be read.
  const vendorId = detail.data?.vendor.id
  const store = useQuery({
    queryKey: keys.storeDetails(vendorId ?? ''),
    queryFn: () => api.call((c) => c.GET('/v1/admin/vendors/{vendor_id}/store-details', { params: { path: { vendor_id: vendorId! } } })),
    enabled: vendorId !== undefined,
    retry: false,
  })
  const policies = useMemo(() => toPolicies(store.data), [store.data])
  const data = useMemo(() => (detail.data ? toBrandReview(detail.data, neighboursIn(items ?? [], reviewId), policies) : undefined), [detail.data, items, reviewId, policies])
  return adapted(detail, data)
}

// Approve and send back run against the version the reviewer looked at: if the seller changed the
// submission since, vendor-api refuses with 409 `stale_review` instead of approving what nobody saw.
function useDecide<Body>(reviewId: string, action: 'approve' | 'reject', version: number | undefined) {
  const { api } = useRuntime()
  const invalidate = useInvalidateAfterDecision()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: Body) => {
      if (version === undefined) throw new Error('The review has not loaded.')
      const path = { params: { path: { review_id: reviewId } } }
      const detail = await (action === 'approve'
        ? api.call((c) => c.POST('/v1/admin/reviews/{review_id}/approve', { ...path, body: { version } }))
        : api.call((c) => c.POST('/v1/admin/reviews/{review_id}/reject', { ...path, body: { version, ...(body as M.RejectBody) } })))
      // The item leaves the queue with this decision, so the page it offers next is worked out from the queue as it was.
      return toDecision(detail, afterDecision(qc.getQueryData<QueueSlice>(keys.queueOrder)?.items ?? [], reviewId))
    },
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: keys.review(reviewId) })
    },
  })
}

export const useApproveReview = (reviewId: string, version: number | undefined) => useDecide<void>(reviewId, 'approve', version)
export const useRejectReview = (reviewId: string, version: number | undefined) => useDecide<M.RejectBody>(reviewId, 'reject', version)

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

// Codes that mean the vendor is not what the card shows (another proposal, none waiting, or the
// application rejected meanwhile): read it again.
const STALE_COMMISSION = new Set(['commission_changed', 'no_proposal', 'vendor_not_eligible'])

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
      // Any review page that is open shows the new state.
      void qc.invalidateQueries({ queryKey: keys.allReviews })
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
