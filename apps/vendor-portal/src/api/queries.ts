import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Schemas } from './client'
import { useApi } from './context'

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

// ---- writes ------------------------------------------------------------------------------

export function useApply() {
  const api = useApi()
  return useMutation({ mutationFn: (body: Schemas['VendorApplication']) => api.call((c) => c.POST('/api/v1/public/vendor-applications', { body })) })
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
    mutationFn: async ({ file, purpose }: { file: File; purpose: 'logo' | 'cover' | 'product' }) => {
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
    },
  })
}
