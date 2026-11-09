import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './index'
import type { BrandProfileFields, Product } from './types'

export const keys = {
  session: ['session'] as const,
  overview: ['overview'] as const,
  products: ['products'] as const,
  product: (id: string) => ['products', id] as const,
  brand: ['brand'] as const,
  submissions: ['submissions'] as const,
  lastImport: ['import', 'last'] as const,
}

export const useOverview = () => useQuery({ queryKey: keys.overview, queryFn: api.getOverview })
export const useProducts = () => useQuery({ queryKey: keys.products, queryFn: api.listProducts })
export const useProduct = (id: string | undefined) =>
  useQuery({ queryKey: keys.product(id ?? 'new'), queryFn: () => api.getProduct(id!), enabled: Boolean(id) })
export const useBrandProfile = () => useQuery({ queryKey: keys.brand, queryFn: api.getBrandProfile })
export const useSubmissions = () => useQuery({ queryKey: keys.submissions, queryFn: api.listSubmissions })
export const useLastImport = () => useQuery({ queryKey: keys.lastImport, queryFn: api.getLastImport })

/** Anything that changes products or reviews refreshes the lists, counts and sidebar badges. */
function useInvalidateCatalog() {
  const qc = useQueryClient()
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: keys.products }),
    qc.invalidateQueries({ queryKey: keys.overview }),
    qc.invalidateQueries({ queryKey: keys.submissions }),
  ])
}

export function useSaveProduct() {
  const invalidate = useInvalidateCatalog()
  return useMutation({ mutationFn: (p: Product) => api.saveProduct(p), onSuccess: invalidate })
}
export function useSubmitProducts() {
  const invalidate = useInvalidateCatalog()
  return useMutation({ mutationFn: (ids: string[]) => api.submitProducts(ids), onSuccess: invalidate })
}
export function useArchiveProducts() {
  const invalidate = useInvalidateCatalog()
  return useMutation({ mutationFn: (ids: string[]) => api.archiveProducts(ids), onSuccess: invalidate })
}
export function useImportCatalog() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (file: File) => api.importCatalog(file), onSuccess: r => qc.setQueryData(keys.lastImport, r) })
}
export function useCreateDraftsFromImport() {
  const invalidate = useInvalidateCatalog()
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.createDraftsFromImport, onSuccess: () => { qc.setQueryData(keys.lastImport, null); return invalidate() } })
}
export function useSaveBrandDraft() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (d: BrandProfileFields) => api.saveBrandDraft(d), onSuccess: b => qc.setQueryData(keys.brand, b) })
}
export function useDiscardBrandDraft() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.discardBrandDraft, onSuccess: b => qc.setQueryData(keys.brand, b) })
}
export function useSubmitBrandPage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.submitBrandPage,
    onSuccess: b => { qc.setQueryData(keys.brand, b); return qc.invalidateQueries({ queryKey: keys.submissions }) },
  })
}

/* ---------- catalog screens (V-06, V-07, V-08) ---------- */
export const useProductHistory = (id: string | undefined) =>
  useQuery({ queryKey: ['products', id ?? 'new', 'history'] as const, queryFn: () => api.getProductHistory(id!), enabled: Boolean(id) })
