import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Client } from 'openapi-fetch'
import { isValidIfsc, normaliseIfsc } from '../lib/validators'
import type { StoreSection } from '../lib/storeDetails'
import type { Schemas } from './client'
import { useApi } from './context'
import type { paths } from './schema'

// Every screen reads and writes through these hooks, so cache keys and invalidation live in one place.

export type ProductFilters = {
  status?: Schemas['ProductStatus']
  q?: string
  category?: string
  gender?: string
  stock?: 'in_stock' | 'low' | 'out'
  sort?: 'updated_desc' | 'price_asc' | 'price_desc' | 'stock_asc'
  cursor?: string
  limit?: number
}

export const keys = {
  me: ['me'] as const,
  summary: ['summary'] as const,
  brand: ['brand-page'] as const,
  products: (filters: ProductFilters = {}) => ['products', filters] as const,
  allProducts: ['products'] as const,
  product: (id: string) => ['product', id] as const,
  reviews: (state?: 'waiting' | 'rejected' | 'approved', limit?: number) => ['reviews', state ?? 'all', limit ?? 50] as const,
  allReviews: ['reviews'] as const,
  importJob: (id: string) => ['import', id] as const,
  invite: (token: string) => ['invite', token] as const,
  storeDetails: ['store-details'] as const,
  ifsc: (code: string) => ['ifsc', code] as const,
  sizeChart: (group: Schemas['SizeChartGroup']) => ['size-chart', group] as const,
}

// ---- reads -------------------------------------------------------------------------------

export function useMe(enabled = true) {
  const api = useApi()
  return useQuery({ queryKey: keys.me, queryFn: () => api.call((c) => c.GET('/api/v1/vendor/me')), enabled })
}

export function useSummary() {
  const api = useApi()
  return useQuery({ queryKey: keys.summary, queryFn: () => api.call((c) => c.GET('/api/v1/vendor/summary')) })
}

export function useBrandPage() {
  const api = useApi()
  return useQuery({ queryKey: keys.brand, queryFn: () => api.call((c) => c.GET('/api/v1/vendor/brand-page')) })
}

export function useProducts(filters: ProductFilters) {
  const api = useApi()
  return useQuery({
    queryKey: keys.products(filters),
    queryFn: () => api.call((c) => c.GET('/api/v1/vendor/products', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  })
}

export function useProduct(id: string | undefined) {
  const api = useApi()
  return useQuery({
    queryKey: keys.product(id ?? ''),
    queryFn: () => api.call((c) => c.GET('/api/v1/vendor/products/{id}', { params: { path: { id: id! } } })),
    enabled: Boolean(id),
  })
}

export function useReviews(state?: 'waiting' | 'rejected' | 'approved', limit?: number) {
  const api = useApi()
  return useQuery({
    queryKey: keys.reviews(state, limit),
    queryFn: () => api.call((c) => c.GET('/api/v1/vendor/reviews', { params: { query: { state, limit } } })),
  })
}

export function useInvite(token: string | null) {
  const api = useApi()
  return useQuery({
    queryKey: keys.invite(token ?? ''),
    queryFn: () => api.call((c) => c.GET('/api/v1/vendor/auth/invites/{token}', { params: { path: { token: token! } } })),
    enabled: Boolean(token),
    retry: false,
  })
}

export function useImportJob(id: string | null) {
  const api = useApi()
  return useQuery({
    queryKey: keys.importJob(id ?? ''),
    queryFn: () => api.call((c) => c.GET('/api/v1/vendor/imports/{job_id}', { params: { path: { job_id: id! } } })),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'checking' ? 1000 : false),
  })
}

export function useStoreDetails(enabled = true) {
  const api = useApi()
  return useQuery({ queryKey: keys.storeDetails, queryFn: () => api.call((c) => c.GET('/api/v1/vendor/store-details')), enabled })
}

// Bank and branch for an IFSC, looked up once the code has the right shape ("hdfc0001234" works).
// A 404 (no such bank) is the query's error; it is not retried.
export function useIfsc(code: string | null | undefined) {
  const api = useApi()
  const ifsc = normaliseIfsc(code ?? '')
  return useQuery({
    queryKey: keys.ifsc(ifsc),
    queryFn: () => api.call((c) => c.GET('/api/v1/public/ifsc/{code}', { params: { path: { code: ifsc } } })),
    enabled: isValidIfsc(ifsc),
    staleTime: Infinity,
    retry: false,
  })
}

// The brand's size chart for a product type's group (sizeChartGroupFor in src/lib/catalog.ts);
// an empty chart when none is saved. Disabled for types without a chart (null).
export function useSizeChart(group: Schemas['SizeChartGroup'] | null | undefined) {
  const api = useApi()
  return useQuery({
    queryKey: group ? keys.sizeChart(group) : ['size-chart', 'none'],
    queryFn: () => api.call((c) => c.GET('/api/v1/vendor/size-charts/{group}', { params: { path: { group: group! } } })),
    enabled: Boolean(group),
  })
}

// ---- writes ------------------------------------------------------------------------------

export function useApply() {
  const api = useApi()
  return useMutation({ mutationFn: (body: Schemas['VendorApplication']) => api.call((c) => c.POST('/api/v1/public/vendor-applications', { body })) })
}

// Sets the first password from an invite link; the response signs the seller in.
export function useAcceptInvite() {
  const api = useApi()
  return useMutation({ mutationFn: (body: { token: string; password: string }) => api.call((c) => c.POST('/api/v1/vendor/auth/accept-invite', { body })) })
}

export function useForgotPassword() {
  const api = useApi()
  return useMutation({ mutationFn: (identifier: string) => api.call((c) => c.POST('/api/v1/vendor/auth/password/forgot', { body: { identifier } })) })
}

export function useSaveBrandDraft() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Schemas['BrandProfile']) => api.call((c) => c.PUT('/api/v1/vendor/brand-page/draft', { body })),
    onSuccess: (page) => qc.setQueryData(keys.brand, page),
  })
}

export function useDiscardBrandDraft() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.call((c) => c.DELETE('/api/v1/vendor/brand-page/draft')),
    onSuccess: (page) => qc.setQueryData(keys.brand, page),
  })
}

export function useSubmitBrandPage() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.call((c) => c.POST('/api/v1/vendor/brand-page/submit')),
    onSuccess: (page) => {
      qc.setQueryData(keys.brand, page)
      void qc.invalidateQueries({ queryKey: keys.allReviews })
      void qc.invalidateQueries({ queryKey: keys.summary })
    },
  })
}

function useProductWrite<TVars>(send: (vars: TVars) => Promise<Schemas['Product']>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: send,
    onSuccess: (product) => {
      qc.setQueryData(keys.product(product.id), product)
      void qc.invalidateQueries({ queryKey: keys.allProducts })
      void qc.invalidateQueries({ queryKey: keys.summary })
      void qc.invalidateQueries({ queryKey: keys.allReviews })
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

export function useCreateProduct() {
  const api = useApi()
  return useProductWrite((body: Schemas['ProductInput']) => api.call((c) => c.POST('/api/v1/vendor/products', { body })))
}

export function useUpdateProduct(id: string) {
  const api = useApi()
  return useProductWrite((body: Schemas['ProductInput']) => api.call((c) => c.PATCH('/api/v1/vendor/products/{id}', { params: { path: { id } }, body })))
}

export function useSubmitProduct(id: string) {
  const api = useApi()
  return useProductWrite(() => api.call((c) => c.POST('/api/v1/vendor/products/{id}/submit', { params: { path: { id } } })))
}

export function useArchiveProduct(id: string) {
  const api = useApi()
  return useProductWrite(() => api.call((c) => c.POST('/api/v1/vendor/products/{id}/archive', { params: { path: { id } } })))
}

export function useRemoveProductImage(id: string) {
  const api = useApi()
  return useProductWrite((imageId: string) => api.call((c) => c.DELETE('/api/v1/vendor/products/{id}/images/{image_id}', { params: { path: { id, image_id: imageId } } })))
}

export function useAddProductImage(id: string) {
  const api = useApi()
  const upload = useUploadImage()
  return useProductWrite(async ({ file, angle }: { file: File; angle: Schemas['PhotoAngle'] }) => {
    const { key } = await upload.mutateAsync({ file, purpose: 'product' })
    return api.call((c) => c.POST('/api/v1/vendor/products/{id}/images', { params: { path: { id } }, body: { key, angle } }))
  })
}

// The same upload for any product, chosen per call: photos picked after a bulk import are matched
// to the new drafts by name (matchPhotoFile in src/lib/catalog.ts), then attached one by one.
export function useAttachProductPhoto() {
  const api = useApi()
  const upload = useUploadImage()
  return useProductWrite(async ({ productId, file, angle }: { productId: string; file: File; angle: Schemas['PhotoAngle'] }) => {
    const { key } = await upload.mutateAsync({ file, purpose: 'product' })
    return api.call((c) => c.POST('/api/v1/vendor/products/{id}/images', { params: { path: { id: productId } }, body: { key, angle } }))
  })
}

// Moves a photo to another slot ("Make main photo" = angle 'front'); a taken named slot swaps.
export function useMoveProductImage(id: string) {
  const api = useApi()
  return useProductWrite(({ imageId, angle }: { imageId: string; angle: Schemas['PhotoAngle'] }) =>
    api.call((c) => c.PATCH('/api/v1/vendor/products/{id}/images/{image_id}', { params: { path: { id, image_id: imageId } }, body: { angle } })),
  )
}

export function useBulkProducts() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { action: 'submit' | 'archive'; ids: string[] }) => api.call((c) => c.POST('/api/v1/vendor/products/bulk', { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.allProducts })
      void qc.invalidateQueries({ queryKey: keys.summary })
      void qc.invalidateQueries({ queryKey: keys.allReviews })
    },
  })
}

// Presign, then upload straight to the storage provider (Cloudinary in production, docs/adr/0005).
export function useUploadImage() {
  const api = useApi()
  return useMutation({
    mutationFn: async ({ file, purpose }: { file: File; purpose: 'logo' | 'cover' | 'product' | 'size_chart' }) => {
      const target = await api.call((c) => c.POST('/api/v1/vendor/uploads/presign', { body: { purpose, content_type: file.type, size_bytes: file.size } }))
      const form = new FormData()
      for (const [k, v] of Object.entries(target.fields)) form.append(k, v)
      form.append('file', file)
      let response: Response
      try {
        response = await fetch(target.upload_url, { method: 'POST', body: form })
      } catch {
        throw new Error('The photo did not upload. Check your connection and try again.')
      }
      if (!response.ok) throw new Error('The photo did not upload. Try again.')
      const { secure_url } = (await response.json()) as { secure_url: string }
      return { key: target.key, url: secure_url }
    },
  })
}

export function useImportTemplate() {
  const api = useApi()
  return useMutation({ mutationFn: () => api.call((c) => c.GET('/api/v1/vendor/imports/template.csv', { parseAs: 'text' })) })
}

export function useStartImport() {
  const api = useApi()
  return useMutation({
    mutationFn: (file: File) =>
      api.call((c) =>
        c.POST('/api/v1/vendor/imports', {
          body: { file: file as unknown as string },
          bodySerializer: (body) => {
            const form = new FormData()
            form.append('file', body.file as unknown as Blob)
            return form
          },
        }),
      ),
  })
}

export function useCommitImport() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => api.call((c) => c.POST('/api/v1/vendor/imports/{job_id}/commit', { params: { path: { job_id: jobId } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.allProducts })
      void qc.invalidateQueries({ queryKey: keys.summary })
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

// ---- store details, commission, size charts -----------------------------------------------

// What each PUT store-details/{section} takes. pay_on_delivery is saved as section 'payment'.
export type StoreSectionInput = {
  brand: Schemas['StoreBrandInput']
  contact: Schemas['Contact']
  delivery: Schemas['Delivery']
  returns: Schemas['Returns']
  payment: Schemas['PayOnDelivery']
  payout: Schemas['PayoutInput']
  business: Schemas['BusinessDetails']
}
export type StoreSectionSave = { [K in StoreSection]: { section: K; body: StoreSectionInput[K] } }[StoreSection]

type StoreResult = Promise<{ data?: Schemas['StoreDetails']; error?: unknown; response: Response }>

function putStoreSection(c: Client<paths>, save: StoreSectionSave): StoreResult {
  switch (save.section) {
    case 'brand': return c.PUT('/api/v1/vendor/store-details/brand', { body: save.body })
    case 'contact': return c.PUT('/api/v1/vendor/store-details/contact', { body: save.body })
    case 'delivery': return c.PUT('/api/v1/vendor/store-details/delivery', { body: save.body })
    case 'returns': return c.PUT('/api/v1/vendor/store-details/returns', { body: save.body })
    case 'payment': return c.PUT('/api/v1/vendor/store-details/payment', { body: save.body })
    case 'payout': return c.PUT('/api/v1/vendor/store-details/payout', { body: save.body })
    case 'business': return c.PUT('/api/v1/vendor/store-details/business', { body: save.body })
  }
}

// Saves one section; answers with the whole StoreDetails (missing, complete). A 422 is an ApiError
// whose `fields` are keyed like the section body ("pickup_address.pin").
export function useSaveStoreSection() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (save: StoreSectionSave) => api.call((c) => putStoreSection(c, save)),
    onSuccess: (details) => {
      qc.setQueryData(keys.storeDetails, details)
      // setup.store_details, and whether products can be sent for review.
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

// Proposes a commission rate in basis points (1250 = 12.5%; parsePercent in src/lib/commission.ts).
export function useProposeCommission() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rateBps: number) => api.call((c) => c.POST('/api/v1/vendor/commission/proposal', { body: { rate_bps: rateBps } })),
    onSuccess: (commission) => {
      qc.setQueryData<Schemas['Me']>(keys.me, (me) => (me ? { ...me, vendor: { ...me.vendor, commission, commission_bps: commission.agreed_bps } } : me))
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

export function useSaveSizeChart(group: Schemas['SizeChartGroup']) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Schemas['SizeChartInput']) => api.call((c) => c.PUT('/api/v1/vendor/size-charts/{group}', { params: { path: { group } }, body })),
    onSuccess: (chart) => qc.setQueryData(keys.sizeChart(chart.group), chart),
  })
}
