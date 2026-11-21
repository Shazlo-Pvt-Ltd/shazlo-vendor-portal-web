import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { uploadImage } from './uploads/upload'
import type { StoreSection } from '../lib/storeDetails'
import { isValidIfsc, normaliseIfsc } from '../lib/validators'
import { assetIdForUrl, rememberAsset } from './adapters/assets'
import { brandErrors, brandPageFromApi, draftBodyFromProfile, publishedAsBody } from './adapters/brand'
import { genderToApi, newProductCode, productTypeFromApi, productTypeToApi } from './adapters/common'
import { importCommitFromReport, importJobFromReport, importReportFromApi, WHOLE_ROW } from './adapters/imports'
import { commissionFromApi, meFromApi } from './adapters/me'
import {
  addImage,
  contentFromInput,
  createBodyFromInput,
  hasSummaryFields,
  moveImage,
  productFromApi,
  removeImage,
  submitErrors,
  summaryFromApi,
  summaryFromProduct,
} from './adapters/products'
import { reviewItemFromSubmission, reviewStateToStatus, submissionFromApi } from './adapters/reviews'
import { signupBodyFromApplication, signupErrors } from './adapters/signup'
import { sizeChartBody, sizeChartFromApi } from './adapters/sizeCharts'
import { storeDetailsFromApi, storeErrors } from './adapters/storeDetails'
import { teamUserFromApi } from './adapters/team'
import { downloadImportTemplate, importProducts } from './endpoints'
import { ApiError, NetworkError } from './errors'
import { getApiClient } from './instance'
import { handleUnauthorized } from './session'
import type {
  ApplicationReceipt,
  BrandPage,
  BulkResult,
  Commission,
  Gender,
  IfscBank,
  ImportCommit,
  ImportJob,
  ImportMode,
  ImportReport,
  Me,
  PhotoAngle,
  Product,
  ProductPage,
  ProductStatus,
  ProductSummary,
  ReviewItem,
  ReviewPage,
  Schemas,
  SizeChart,
  SizeChartGroup,
  SizeChartInput,
  StatusCounts,
  StoreDetails,
  SubmissionPage,
  SubmissionStatus,
  Summary,
  TeamUser,
  UploadedImage,
  UploadPurpose,
  VendorApplication,
} from './model'
import type { AssetKind, DraftOut, ImportReportOut, ProductOut, SessionIn, SizeChartOut, SubmissionIn, SubmissionOut } from './wire'

// Every screen reads and writes through these hooks, so cache keys, invalidation and the
// translation between vendor-api and the view models (src/api/adapters) live in one place. Each
// hook keeps Build 2's name and return shape; underneath it calls vendor-api's real routes, or
// the proposed ones (openapi/proposed.yaml), through main's client.

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
  counts: ['product-counts'] as const,
  productIndex: ['product-index'] as const,
  products: (filters: ProductFilters = {}) => ['products', filters] as const,
  allProducts: ['products'] as const,
  product: (id: string) => ['product', id] as const,
  productRaw: (id: string) => ['product-raw', id] as const,
  reviews: (state?: 'waiting' | 'rejected' | 'approved', limit?: number) => ['reviews', state ?? 'all', limit ?? 50] as const,
  allReviews: ['reviews'] as const,
  submissions: (params: SubmissionParams = {}) => ['submissions', params] as const,
  allSubmissions: ['submissions'] as const,
  importJob: (id: string) => ['import', id] as const,
  invite: (token: string) => ['invite', token] as const,
  storeDetails: ['store-details'] as const,
  ifsc: (code: string) => ['ifsc', code] as const,
  sizeChart: (group: Schemas['SizeChartGroup']) => ['size-chart', group] as const,
  sizeChartRaw: (group: Schemas['SizeChartGroup']) => ['size-chart-raw', group] as const,
  team: ['team'] as const,
}

/** How long a read made for another read (counts, a product's details, the store details) is reused. */
const SHARED_MS = 15_000
const PAGE = 100
/** Products read in full at once when the list must be filtered or sorted in the portal. */
const DETAIL_BATCH = 6

// ---- calling vendor-api --------------------------------------------------------------------------

const client = () => getApiClient()

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

const unreadable = () => new ApiError({ status: 502, code: 'bad_response', message: 'The server sent an answer the portal could not read. Try again.' })

/**
 * The data of a call. A body that is not JSON (a proxy's error page, a cut-off answer) becomes an
 * {@link ApiError} `bad_response` instead of a parser's error, so screens show their usual failure.
 */
async function call<T>(request: Promise<{ data?: T }>): Promise<T> {
  try {
    const { data } = await request
    return data as T
  } catch (error) {
    if (error instanceof ApiError || error instanceof NetworkError || isAbort(error)) throw error
    throw unreadable()
  }
}

/** Like {@link call}, for answers that must be a JSON object. */
async function callObject<T>(request: Promise<{ data?: T }>): Promise<T> {
  const data = await call(request)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw unreadable()
  return data
}

const notFound = (error: unknown) => error instanceof ApiError && error.status === 404

// ---- shared reads --------------------------------------------------------------------------------

async function total(status: ProductStatus | null, signal?: AbortSignal): Promise<number> {
  const page = await callObject(client().GET('/v1/vendor/products', { params: { query: { ...(status ? { status } : {}), limit: 1 } }, signal }))
  return Number.isInteger(page.total) ? page.total : 0
}

/** Product counts by status, from `?status=…&limit=1` totals (archived ones are never in `all`). */
function productCounts(qc: QueryClient, signal?: AbortSignal): Promise<StatusCounts> {
  return qc.fetchQuery({
    queryKey: keys.counts,
    staleTime: SHARED_MS,
    queryFn: async () => {
      const [all, approved, pending_review, rejected, draft, archived] = await Promise.all([
        total(null, signal),
        total('approved', signal),
        total('pending_review', signal),
        total('rejected', signal),
        total('draft', signal),
        total('archived', signal),
      ])
      return { all, approved, pending_review, rejected, draft, archived }
    },
  })
}

function remember(qc: QueryClient, raw: ProductOut): Product {
  const product = productFromApi(raw)
  qc.setQueryData(keys.productRaw(product.id), raw)
  qc.setQueryData(keys.product(product.id), product)
  return product
}

async function fetchProductRaw(id: string, signal?: AbortSignal): Promise<ProductOut> {
  return callObject(client().GET('/v1/vendor/products/{product_id}', { params: { path: { product_id: id } }, signal }))
}

/** One product in full, reused for a short while by the list, the review page and the editor. */
async function productDetail(qc: QueryClient, id: string, signal?: AbortSignal): Promise<Product> {
  const raw = await qc.fetchQuery({ queryKey: keys.productRaw(id), staleTime: SHARED_MS, queryFn: () => fetchProductRaw(id, signal) })
  return remember(qc, raw)
}

async function inBatches<T, R>(items: readonly T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(task))))
  return out
}

/** Every product of the vendor, archived ones included, as `{code → id}`. */
function productIndex(qc: QueryClient, signal?: AbortSignal): Promise<Map<string, string>> {
  return qc.fetchQuery({
    queryKey: keys.productIndex,
    staleTime: SHARED_MS,
    queryFn: async () => {
      const index = new Map<string, string>()
      for (const status of [undefined, 'archived'] as const) {
        for (let offset = 0; ; offset += PAGE) {
          const page = await callObject(client().GET('/v1/vendor/products', { params: { query: { ...(status ? { status } : {}), limit: PAGE, offset } }, signal }))
          for (const item of Array.isArray(page.items) ? page.items : []) index.set(String(item.sku).toLowerCase(), String(item.id))
          if (!Array.isArray(page.items) || offset + PAGE >= page.total) break
        }
      }
      return index
    },
  })
}

function storeDetails(qc: QueryClient, signal?: AbortSignal): Promise<StoreDetails> {
  return qc.fetchQuery({
    queryKey: keys.storeDetails,
    staleTime: SHARED_MS,
    queryFn: async () => storeDetailsFromApi(await callObject(client().GET('/v1/vendor/store-details', { signal }))),
  })
}

async function publishedBrand(signal?: AbortSignal) {
  try {
    const published = await callObject(client().GET('/v1/vendor/brand-profile/published', { signal }))
    rememberAsset(published.logo_url, published.logo_asset_id)
    rememberAsset(published.banner_url, published.banner_asset_id)
    return published
  } catch (error) {
    if (notFound(error)) return null
    throw error
  }
}

async function latestBrandSubmission(signal?: AbortSignal): Promise<SubmissionOut | null> {
  const page = await callObject(client().GET('/v1/vendor/submissions', { params: { query: { subject: 'brand_profile', limit: 1 } }, signal }))
  return Array.isArray(page.items) ? (page.items[0] ?? null) : null
}

async function brandDraft(signal?: AbortSignal): Promise<DraftOut> {
  const draft = await callObject(client().GET('/v1/vendor/brand-profile', { signal }))
  rememberAsset(draft.logo_url, draft.logo_asset_id)
  rememberAsset(draft.banner_url, draft.banner_asset_id)
  return draft
}

async function brandPage(draft?: DraftOut, signal?: AbortSignal): Promise<BrandPage> {
  const [current, published, latest] = await Promise.all([draft ?? brandDraft(signal), publishedBrand(signal), latestBrandSubmission(signal)])
  return brandPageFromApi({ draft: current, published, latest })
}

// ---- reads ---------------------------------------------------------------------------------------

export function useMe(enabled = true) {
  const qc = useQueryClient()
  return useQuery<Me>({
    queryKey: keys.me,
    enabled,
    queryFn: async ({ signal }) => {
      const [me, store, published, counts] = await Promise.all([
        callObject(client().GET('/v1/vendor/me', { signal })),
        // Store details are a proposed route: until vendor-api has it, "Store details" stays a to-do.
        storeDetails(qc, signal).catch((error: unknown) => {
          if (isAbort(error)) throw error
          return null
        }),
        publishedBrand(signal).catch((error: unknown) => {
          if (isAbort(error)) throw error
          return null
        }),
        productCounts(qc, signal),
      ])
      return meFromApi({ me, store, brandLive: published !== null, counts })
    },
  })
}

export function useSummary() {
  const qc = useQueryClient()
  return useQuery<Summary>({
    queryKey: keys.summary,
    queryFn: async ({ signal }) => {
      const [products, pending] = await Promise.all([
        productCounts(qc, signal),
        callObject(client().GET('/v1/vendor/submissions', { params: { query: { status: 'pending', limit: 1 } }, signal })),
      ])
      const waiting = Number.isInteger(pending.total) ? pending.total : 0
      let oldest: number | null = null
      if (waiting > 0) {
        // Newest first: the oldest waiting review is the last one.
        const last = await callObject(client().GET('/v1/vendor/submissions', { params: { query: { status: 'pending', limit: 1, offset: waiting - 1 } }, signal }))
        const at = Date.parse(String(last.items?.[0]?.submitted_at ?? ''))
        if (!Number.isNaN(at)) oldest = Math.max(0, Math.floor((Date.now() - at) / 3_600_000))
      }
      return { products, reviews_waiting: waiting, oldest_waiting_hours: oldest, sent_back: products.rejected }
    },
  })
}

export function useBrandPage() {
  return useQuery<BrandPage>({ queryKey: keys.brand, queryFn: ({ signal }) => brandPage(undefined, signal) })
}

const isServerFilter = (f: ProductFilters) => !f.gender && !f.stock && (!f.sort || f.sort === 'updated_desc')

function categoryQuery(category: string | undefined): string | undefined {
  if (!category) return undefined
  return productTypeToApi(productTypeFromApi(category)) ?? category.toLowerCase()
}

function stockOf(p: ProductSummary): number {
  return p.stock ?? 0
}

function matchesPortalFilters(p: Product, s: ProductSummary, f: ProductFilters): boolean {
  if (f.gender && p.gender !== f.gender) return false
  if (f.stock === 'out' && !(p.variants.length > 0 && stockOf(s) === 0)) return false
  if (f.stock === 'low' && !(stockOf(s) > 0 && stockOf(s) <= 5)) return false
  if (f.stock === 'in_stock' && !(stockOf(s) > 5)) return false
  return true
}

function sortSummaries(items: ProductSummary[], sort: ProductFilters['sort']): ProductSummary[] {
  // Products without a price sort last in both price orders.
  const price = (p: ProductSummary, missing: number) => p.price_paise ?? missing
  return [...items].sort((a, b) =>
    sort === 'price_asc' ? price(a, Number.MAX_SAFE_INTEGER) - price(b, Number.MAX_SAFE_INTEGER)
      : sort === 'price_desc' ? price(b, -1) - price(a, -1)
        : sort === 'stock_asc' ? stockOf(a) - stockOf(b)
          : Date.parse(b.updated_at) - Date.parse(a.updated_at))
}

/** Build 2's stock filters that vendor-api's `in_stock` cannot say alone: they are worked out here from each row's stock. */
function stockThreshold(stock: ProductFilters['stock'], s: ProductSummary): boolean {
  if (stock === 'low') return stockOf(s) > 0 && stockOf(s) <= 5
  if (stock === 'in_stock') return stockOf(s) > 5
  return true
}

/**
 * A page of products with Build 2's columns.
 *
 * With the proposal (`ProposedProductSummaryOut`), each row carries its price, stock, photo and
 * colour, and vendor-api filters by gender and stock and sorts: a page is one request. Build 2's
 * "low" and "in stock" thresholds are worked out here from the rows (pages of 100, no product read
 * in full).
 *
 * Without it (vendor-api today), each row is read in full (reused for a while), and with a gender,
 * stock or price/stock order on, every matching product is read and the page is made here.
 */
async function productPage(qc: QueryClient, filters: ProductFilters, signal?: AbortSignal): Promise<ProductPage> {
  const limit = filters.limit ?? 25
  const offset = Math.max(0, Number(filters.cursor ?? 0) || 0)
  const query = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.category ? { category: categoryQuery(filters.category) } : {}),
  }
  const counts = await productCounts(qc, signal)
  const empty = (total: number): ProductPage => ({ items: [], total, next_cursor: null, counts })
  const gender = filters.gender ? genderToApi(filters.gender as Gender) : null
  // A gender the portal does not know matches nothing, with or without the proposal.
  if (filters.gender && !gender) return empty(0)
  const proposed = {
    ...(gender ? { gender } : {}),
    ...(filters.stock === 'out' ? { in_stock: false } : filters.stock ? { in_stock: true } : {}),
    ...(filters.sort && filters.sort !== 'updated_desc' ? { sort: filters.sort } : {}),
  }
  const byThreshold = filters.stock === 'low' || filters.stock === 'in_stock'
  const page = (from: number, size: number) => callObject(client().GET('/v1/vendor/products', { params: { query: { ...query, ...proposed, limit: size, offset: from } }, signal }))
  const rowsOf = (p: Awaited<ReturnType<typeof page>>) => (Array.isArray(p.items) ? p.items : [])
  const first = await page(byThreshold ? 0 : offset, byThreshold ? PAGE : limit)
  const firstRows = rowsOf(first)
  const firstTotal = Number.isInteger(first.total) ? first.total : firstRows.length

  if (firstRows.length > 0 && firstRows.every((row) => hasSummaryFields(row))) {
    if (!byThreshold) {
      return { items: firstRows.map(summaryFromApi), total: firstTotal, next_cursor: offset + limit < firstTotal ? String(offset + limit) : null, counts }
    }
    const rows = [...firstRows]
    for (let from = PAGE; from < firstTotal; from += PAGE) {
      const more = rowsOf(await page(from, PAGE))
      if (more.length === 0) break
      rows.push(...more)
    }
    const matching = rows.map(summaryFromApi).filter((s) => stockThreshold(filters.stock, s))
    return { items: matching.slice(offset, offset + limit), total: matching.length, next_cursor: offset + limit < matching.length ? String(offset + limit) : null, counts }
  }
  if (firstRows.length === 0 && (firstTotal === 0 || Object.keys(proposed).length === 0)) return empty(firstTotal)

  // vendor-api today: plain rows. With only its own filters, the first page is the page.
  if (isServerFilter(filters)) {
    const items = await inBatches(firstRows, DETAIL_BATCH, (row) => productDetail(qc, String(row.id), signal))
    return { items: items.map(summaryFromProduct), total: firstTotal, next_cursor: offset + limit < firstTotal ? String(offset + limit) : null, counts }
  }
  const rows: { id: string }[] = []
  for (let from = 0; ; from += PAGE) {
    const plain = await callObject(client().GET('/v1/vendor/products', { params: { query: { ...query, limit: PAGE, offset: from } }, signal }))
    const items = Array.isArray(plain.items) ? plain.items : []
    rows.push(...items.map((i) => ({ id: String(i.id) })))
    if (items.length === 0 || from + PAGE >= plain.total) break
  }
  const products = await inBatches(rows, DETAIL_BATCH, (row) => productDetail(qc, row.id, signal))
  const matching = sortSummaries(
    products.flatMap((p) => {
      const s = summaryFromProduct(p)
      return matchesPortalFilters(p, s, filters) ? [s] : []
    }),
    filters.sort,
  )
  return { items: matching.slice(offset, offset + limit), total: matching.length, next_cursor: offset + limit < matching.length ? String(offset + limit) : null, counts }
}

export function useProducts(filters: ProductFilters) {
  const qc = useQueryClient()
  return useQuery<ProductPage>({
    queryKey: keys.products(filters),
    queryFn: ({ signal }) => productPage(qc, filters, signal),
    placeholderData: keepPreviousData,
  })
}

export function useProduct(id: string | undefined) {
  const qc = useQueryClient()
  return useQuery<Product>({
    queryKey: keys.product(id ?? ''),
    queryFn: async ({ signal }) => remember(qc, await fetchProductRaw(id!, signal)),
    enabled: Boolean(id),
  })
}

async function reviewPage(qc: QueryClient, state: ReviewItem['state'] | undefined, limit: number, signal?: AbortSignal): Promise<ReviewPage> {
  const count = async (status: 'pending' | 'rejected' | 'approved') =>
    (await callObject(client().GET('/v1/vendor/submissions', { params: { query: { status, limit: 1 } }, signal }))).total ?? 0
  const [page, waiting, rejected, approved] = await Promise.all([
    callObject(client().GET('/v1/vendor/submissions', { params: { query: { status: reviewStateToStatus(state), limit } }, signal })),
    count('pending'),
    count('rejected'),
    count('approved'),
  ])
  const submissions: SubmissionIn[] = Array.isArray(page.items) ? page.items : []
  const aboutProducts = submissions.filter((s) => s.subject === 'product')
  // With the proposal each submission names its product; without it, products are found by code
  // in the product list.
  const named = aboutProducts.every((s) => typeof s.product_id === 'string' && s.product_id !== '')
  const index = aboutProducts.length > 0 && !named ? await productIndex(qc, signal) : new Map<string, string>()
  const ids = [...new Set(aboutProducts.flatMap((s) => {
    const id = (typeof s.product_id === 'string' && s.product_id) || (s.sku ? index.get(s.sku.toLowerCase()) : undefined)
    return id ? [id] : []
  }))]
  // Keyed by id and by code, so the adapter finds a product either way.
  const products = new Map<string, { id: string; thumbnail: string | null }>()
  await inBatches(ids, DETAIL_BATCH, async (id) => {
    const product = await productDetail(qc, id, signal).catch((error: unknown) => {
      if (isAbort(error)) throw error
      return null
    })
    const front = product?.images.find((i) => i.angle === 'front') ?? product?.images[0]
    const entry = { id, thumbnail: front?.url ?? null }
    products.set(id, entry)
    if (product?.sku) products.set(product.sku.toLowerCase(), entry)
  })
  const brand = submissions.some((s) => s.subject === 'brand_profile') ? await publishedBrand(signal).catch(() => null) : null
  const items = submissions.flatMap((s) => {
    const item = reviewItemFromSubmission(s, { products, brandThumbnail: brand?.banner_url ?? null })
    return item ? [item] : []
  })
  return { items, counts: { all: waiting + rejected + approved, waiting, rejected, approved } }
}

export function useReviews(state?: 'waiting' | 'rejected' | 'approved', limit?: number) {
  const qc = useQueryClient()
  return useQuery<ReviewPage>({
    queryKey: keys.reviews(state, limit),
    queryFn: ({ signal }) => reviewPage(qc, state, Math.min(limit ?? 50, 100), signal),
  })
}

/**
 * Who an invite link is for. vendor-api has no route that says (it only takes the token with the
 * new password), so this answers at once with blanks; the set-password screen should stop
 * greeting by name (see the report on build2-on-main).
 */
export function useInvite(token: string | null) {
  return useQuery({
    queryKey: keys.invite(token ?? ''),
    queryFn: () => ({ email: '', brand_name: '', owner_name: '' }),
    enabled: Boolean(token),
    retry: false,
  })
}

// Bulk import jobs live in this tab's memory: the file is kept so the import can run it again for real.
const importJobs = new Map<string, { file: File; job: ImportJob }>()
let importSeq = 0

export function useImportJob(id: string | null) {
  return useQuery<ImportJob>({
    queryKey: keys.importJob(id ?? ''),
    queryFn: () => {
      const found = id ? importJobs.get(id) : undefined
      if (!found) throw new ApiError({ status: 404, code: 'import_not_found', message: 'That import has ended. Upload the file again.' })
      return found.job
    },
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'checking' ? 1000 : false),
  })
}

export function useStoreDetails(enabled = true) {
  return useQuery<StoreDetails>({
    queryKey: keys.storeDetails,
    queryFn: async ({ signal }) => storeDetailsFromApi(await callObject(client().GET('/v1/vendor/store-details', { signal }))),
    enabled,
  })
}

// Bank and branch for an IFSC, looked up once the code has the right shape ("hdfc0001234" works).
// A 404 (no such bank) is the query's error; it is not retried.
export function useIfsc(code: string | null | undefined) {
  const ifsc = normaliseIfsc(code ?? '')
  return useQuery<IfscBank>({
    queryKey: keys.ifsc(ifsc),
    queryFn: ({ signal }) => callObject(client().GET('/v1/public/ifsc/{code}', { params: { path: { code: ifsc } }, signal })),
    enabled: isValidIfsc(ifsc),
    staleTime: Infinity,
    retry: false,
  })
}

async function sizeChartRaw(qc: QueryClient, group: SizeChartGroup, signal?: AbortSignal): Promise<SizeChartOut> {
  const raw = await callObject(client().GET('/v1/vendor/size-charts/{group}', { params: { path: { group } }, signal }))
  rememberAsset(raw.photo_url, raw.photo_asset_id)
  qc.setQueryData(keys.sizeChartRaw(group), raw)
  return raw
}

// The brand's size chart for a product type's group (sizeChartGroupFor in src/lib/catalog.ts);
// an empty chart when none is saved. Disabled for types without a chart (null).
export function useSizeChart(group: Schemas['SizeChartGroup'] | null | undefined) {
  const qc = useQueryClient()
  return useQuery<SizeChart>({
    queryKey: group ? keys.sizeChart(group) : ['size-chart', 'none'],
    queryFn: async ({ signal }) => sizeChartFromApi(await sizeChartRaw(qc, group!, signal), group!),
    enabled: Boolean(group),
  })
}

// ---- sign-up and passwords (signed out) ----------------------------------------------------------

async function signUp(application: VendorApplication): Promise<ApplicationReceipt> {
  try {
    await call(client().POST('/v1/auth/signup', { body: signupBodyFromApplication(application) }))
  } catch (error) {
    throw signupErrors(error)
  }
  return { id: '', status: 'applied' }
}

/**
 * Calls that carry a password (or a bank account number) are dropped from the mutation cache as
 * soon as nothing watches them (`gcTime: 0`): with the screen's `reset()`, no copy outlives the call.
 */
const FORGET_AT_ONCE = { gcTime: 0 } as const

/** Sign-up with the store details (`POST /v1/auth/signup`). A 422's fields are named as the steps name them. */
export function useSignUp() {
  return useMutation({ mutationFn: signUp, ...FORGET_AT_ONCE })
}

/** Build 2's name for {@link useSignUp}. */
export const useApply = useSignUp

/** `POST /v1/auth/verify-email` with the token from the emailed link. 400 `invalid_token` when it is used or old. */
export function useVerifyEmail() {
  return useMutation({ mutationFn: async (token: string) => void (await call(client().POST('/v1/auth/verify-email', { body: { token } }))) })
}

/** Asks for a new verification email. Always accepted, so it never says whether the address exists. */
export function useResendVerification() {
  return useMutation({ mutationFn: async (email: string) => void (await call(client().POST('/v1/auth/resend-verification', { body: { email: email.trim() } }))) })
}

/** Asks for a password reset link. Always accepted. */
export function useForgotPassword() {
  return useMutation({ mutationFn: async (email: string) => void (await call(client().POST('/v1/auth/forgot-password', { body: { email: email.trim() } }))) })
}

/**
 * Sets a password from an emailed link (reset or invite: `/set-password`, `/reset-password`,
 * `/accept-invite`). It does not sign in; the screen sends the person to sign in. 400
 * `invalid_token` for a used or old link, 422 `weak_password` with the rule in the message.
 */
export function useSetPassword() {
  return useMutation({ mutationFn: async (body: { token: string; password: string }) => void (await call(client().POST('/v1/auth/set-password', { body }))), ...FORGET_AT_ONCE })
}

/** Build 2's name for {@link useSetPassword}. vendor-api does not sign in here, so it resolves with null. */
export function useAcceptInvite() {
  return useMutation({
    mutationFn: async (body: { token: string; password: string }): Promise<null> => {
      await call(client().POST('/v1/auth/set-password', { body }))
      return null
    },
    ...FORGET_AT_ONCE,
  })
}

/**
 * Changes the signed-in user's password. vendor-api ends the user's other sessions and answers with
 * a new one: pass it to the session's `signIn` (it is not shown on any screen). 400
 * `invalid_current_password`, 422 `weak_password`. It needs the access token, but the client does
 * not renew it for `/v1/auth/*` (a 401 there means a bad login), so a 401 renews the session here
 * and the call is sent once more.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }): Promise<SessionIn> => {
      const send = () => callObject(client().POST('/v1/auth/change-password', { body: { current_password: currentPassword, new_password: newPassword } }))
      try {
        return await send()
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && (await handleUnauthorized())) return send()
        throw error
      }
    },
    ...FORGET_AT_ONCE,
  })
}

// ---- brand page ----------------------------------------------------------------------------------

export function useSaveBrandDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (profile: Schemas['BrandProfile']) => {
      const current = await brandDraft()
      try {
        const saved = await callObject(client().PUT('/v1/vendor/brand-profile', { body: draftBodyFromProfile(profile, current, assetIdForUrl) }))
        return await brandPage(saved)
      } catch (error) {
        throw brandErrors(error)
      }
    },
    onSuccess: (page) => qc.setQueryData(keys.brand, page),
  })
}

/** Puts the draft back to the live version (or to an empty page when none is live). */
export function useDiscardBrandDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const [current, published] = await Promise.all([brandDraft(), publishedBrand()])
      const body = published
        ? publishedAsBody(published)
        : { brand_name: current.brand_name, categories: current.categories ?? [], price_min_paise: current.price_min_paise, price_max_paise: current.price_max_paise }
      const saved = await callObject(client().PUT('/v1/vendor/brand-profile', { body }))
      return brandPage(saved)
    },
    onSuccess: (page: BrandPage) => qc.setQueryData(keys.brand, page),
  })
}

/**
 * vendor-api sends a brand page for review only with a category (422 `profile_incomplete`), and
 * Build 2 no longer asks for categories: "who you sell for" in the store details replaced them. A
 * draft without one takes that answer (women, men or both) before it is sent. Without store
 * details the submit is refused as before, and the editor says to fill them in.
 */
async function ensureBrandCategories(qc: QueryClient): Promise<void> {
  const draft = await brandDraft()
  if (Array.isArray(draft.categories) && draft.categories.length > 0) return
  const sells = (await storeDetails(qc).catch(() => null))?.sells
  if (!sells) return
  const categories = sells === 'both' ? ['women', 'men'] : [sells]
  await callObject(client().PUT('/v1/vendor/brand-profile', { body: { ...publishedAsBody(draft), categories } }))
}

export function useSubmitBrandPage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await ensureBrandCategories(qc)
      await callObject(client().POST('/v1/vendor/brand-profile/submit'))
      return brandPage()
    },
    onSuccess: (page) => {
      qc.setQueryData(keys.brand, page)
      void qc.invalidateQueries({ queryKey: keys.allReviews })
      void qc.invalidateQueries({ queryKey: keys.allSubmissions })
      void qc.invalidateQueries({ queryKey: keys.summary })
    },
  })
}

// ---- products ------------------------------------------------------------------------------------

// Writes to one product go one after another, so a photo upload and an autosave never PUT over
// each other (a PUT replaces the whole revision).
const productQueues = new Map<string, Promise<unknown>>()

function serially<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = productQueues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  productQueues.set(key, next)
  void next.then(
    () => productQueues.get(key) === next && productQueues.delete(key),
    () => productQueues.get(key) === next && productQueues.delete(key),
  )
  return next
}

/**
 * Changes a product with a whole-content PUT. The product is read fresh and only this change is
 * applied to it, with the `version` just read (proposed): if another tab saved in between, vendor-api
 * answers 409 `version_conflict` and nothing is saved. Then the product is read once more and this
 * change applied again, so the other tab's other changes survive. A second conflict is the
 * editor's to show. (Without the version check, vendor-api today, the later save wins.)
 */
async function putContent(qc: QueryClient, id: string, change: (raw: ProductOut) => ReturnType<typeof contentFromInput>): Promise<Product> {
  return serially(id, async () => {
    for (let attempt = 1; ; attempt += 1) {
      const raw = await fetchProductRaw(id)
      try {
        const body = { ...change(raw), ...(Number.isInteger(raw.version) && raw.version > 0 ? { version: raw.version } : {}) }
        const saved = await callObject(client().PUT('/v1/vendor/products/{product_id}', { params: { path: { product_id: id } }, body }))
        return remember(qc, saved)
      } catch (error) {
        if (attempt === 1 && error instanceof ApiError && error.code === 'version_conflict') continue
        // In review, archived or changed again meanwhile: readers should read it again.
        if (error instanceof ApiError && error.status === 409) qc.removeQueries({ queryKey: keys.productRaw(id) })
        throw submitErrors(error)
      }
    }
  })
}

function useProductWrite<TVars>(send: (vars: TVars) => Promise<Schemas['Product']>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: send,
    onSuccess: (product) => {
      qc.setQueryData(keys.product(product.id), product)
      // Counts first: the list's refetch reads them, and must not reuse the old ones.
      void qc.invalidateQueries({ queryKey: keys.counts })
      void qc.invalidateQueries({ queryKey: keys.allProducts })
      void qc.invalidateQueries({ queryKey: keys.productIndex })
      void qc.invalidateQueries({ queryKey: keys.summary })
      void qc.invalidateQueries({ queryKey: keys.allReviews })
      void qc.invalidateQueries({ queryKey: keys.allSubmissions })
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

/** Creates a draft. The code is made here until vendor-api makes its own; a clash gets a new one, once. */
export function useCreateProduct() {
  const qc = useQueryClient()
  return useProductWrite(async (input: Schemas['ProductInput']) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const raw = await callObject(client().POST('/v1/vendor/products', { body: createBodyFromInput(input, newProductCode) }))
        return remember(qc, raw)
      } catch (error) {
        if (attempt === 0 && error instanceof ApiError && error.code === 'sku_taken') continue
        throw submitErrors(error)
      }
    }
  })
}

export function useUpdateProduct(id: string) {
  const qc = useQueryClient()
  return useProductWrite((input: Schemas['ProductInput']) => putContent(qc, id, (raw) => contentFromInput(input, raw, newProductCode)))
}

/** Sends for review. A 422 lists every missing requirement under the editor's keys (SubmitRequirement). */
export function useSubmitProduct(id: string) {
  const qc = useQueryClient()
  return useProductWrite(() =>
    serially(id, async () => {
      try {
        return remember(qc, await callObject(client().POST('/v1/vendor/products/{product_id}/submit', { params: { path: { product_id: id } } })))
      } catch (error) {
        throw submitErrors(error)
      }
    }),
  )
}

/**
 * Archives a product (`DELETE`). vendor-api removes a product that was never sent for review and
 * archives the rest; either way the seller sees it archived. 409 `product_in_review` while in review.
 */
export function useArchiveProduct(id: string) {
  const qc = useQueryClient()
  return useProductWrite(() =>
    serially(id, async () => {
      const before = qc.getQueryData<Product>(keys.product(id)) ?? productFromApi(await fetchProductRaw(id))
      await call(client().DELETE('/v1/vendor/products/{product_id}', { params: { path: { product_id: id } } }))
      try {
        return remember(qc, await fetchProductRaw(id))
      } catch (error) {
        if (!notFound(error)) throw error
        qc.removeQueries({ queryKey: keys.productRaw(id) })
        const now = new Date().toISOString()
        return { ...before, status: 'archived', updated_at: now, history: [{ at: now, event: 'archived' }, ...before.history] } satisfies Product
      }
    }),
  )
}

export function useRemoveProductImage(id: string) {
  const qc = useQueryClient()
  return useProductWrite((imageId: string) => putContent(qc, id, (raw) => removeImage(contentFromInput({}, raw, newProductCode), imageId)))
}

const KIND: Record<UploadPurpose, AssetKind> = { logo: 'brand_logo', cover: 'brand_banner', product: 'product_image', size_chart: 'product_image' }

/** Sign → upload to Cloudinary → register (main's pipeline, api/uploads/upload.ts). */
async function upload(file: File, purpose: UploadPurpose, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}): Promise<UploadedImage> {
  const asset = await uploadImage(file, KIND[purpose], { signal: options.signal ?? new AbortController().signal, onProgress: options.onProgress })
  rememberAsset(asset.url, asset.id)
  return { key: asset.id, url: asset.url }
}

type PhotoUpload = { file: File; angle: PhotoAngle; signal?: AbortSignal; onProgress?: (fraction: number) => void }

async function attachPhoto(qc: QueryClient, productId: string, { file, angle, signal, onProgress }: PhotoUpload): Promise<Product> {
  const { key } = await upload(file, 'product', { signal, onProgress })
  // Cancelled after the image host had it: it is registered, but not put on the product.
  if (signal?.aborted) throw new DOMException('The upload was cancelled.', 'AbortError')
  return putContent(qc, productId, (raw) => addImage(contentFromInput({}, raw, newProductCode), { assetId: key, angle }))
}

/** Uploads a photo into a slot. `signal` cancels it (an AbortError); `onProgress` reports 0 to 1 while the file is sent. */
export function useAddProductImage(id: string) {
  const qc = useQueryClient()
  return useProductWrite((photo: PhotoUpload) => attachPhoto(qc, id, photo))
}

// The same upload for any product, chosen per call: photos picked after a bulk import are matched
// to the new drafts by name (matchPhotoFile in src/lib/catalog.ts), then attached one by one.
export function useAttachProductPhoto() {
  const qc = useQueryClient()
  return useProductWrite(({ productId, ...photo }: PhotoUpload & { productId: string }) => attachPhoto(qc, productId, photo))
}

// Moves a photo to another slot ("Make main photo" = angle 'front'); a taken named slot swaps.
export function useMoveProductImage(id: string) {
  const qc = useQueryClient()
  return useProductWrite(({ imageId, angle }: { imageId: string; angle: Schemas['PhotoAngle'] }) =>
    putContent(qc, id, (raw) => moveImage(contentFromInput({}, raw, newProductCode), imageId, angle)),
  )
}

/** Sends or archives several products, one call each in turn, and reports each one. */
export function useBulkProducts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ action, ids }: { action: 'submit' | 'archive'; ids: string[] }): Promise<BulkResult> => {
      const results: BulkResult['results'] = []
      for (const id of ids) {
        try {
          await serially(id, () =>
            action === 'submit'
              ? call(client().POST('/v1/vendor/products/{product_id}/submit', { params: { path: { product_id: id } } }))
              : call(client().DELETE('/v1/vendor/products/{product_id}', { params: { path: { product_id: id } } })),
          )
          results.push({ id, ok: true })
        } catch (error) {
          if (!(error instanceof ApiError)) throw error
          const mapped = submitErrors(error) as ApiError
          const title = qc.getQueryData<Product>(keys.product(id))?.title
          const first = Object.values(mapped.fields)[0] ?? mapped.message
          results.push({ id, ok: false, code: error.code, message: title ? `${title}: ${first}` : first })
        }
        qc.removeQueries({ queryKey: keys.productRaw(id) })
      }
      return { results }
    },
    onSuccess: () => {
      // Counts first: the list's refetch reads them, and must not reuse the old ones.
      void qc.invalidateQueries({ queryKey: keys.counts })
      void qc.invalidateQueries({ queryKey: keys.allProducts })
      void qc.invalidateQueries({ queryKey: keys.summary })
      void qc.invalidateQueries({ queryKey: keys.allReviews })
      void qc.invalidateQueries({ queryKey: keys.allSubmissions })
    },
  })
}

// ---- uploads -------------------------------------------------------------------------------------

/**
 * Uploads one image for a brand logo or cover, a product photo or a size chart, through main's
 * pipeline (sign → Cloudinary → register). `key` is the asset id. Fails with an `UploadError`
 * whose message is written for sellers.
 */
export function useUploadImage() {
  return useMutation({
    mutationFn: ({ file, purpose, signal, onProgress }: { file: File; purpose: UploadPurpose; signal?: AbortSignal; onProgress?: (fraction: number) => void }) =>
      upload(file, purpose, { signal, onProgress }),
  })
}

// ---- bulk import ---------------------------------------------------------------------------------

/** The template (CSV), as text. */
export function useImportTemplate() {
  return useMutation({ mutationFn: async () => (await downloadImportTemplate({ format: 'csv' })).text() })
}

/** The template as a file to save, for main's import screen. */
export function useDownloadImportTemplate() {
  return useMutation({ mutationFn: (format: 'csv' | 'xlsx' = 'csv') => downloadImportTemplate({ format }) })
}

const FILE_PROBLEMS = new Set(['missing_columns', 'duplicate_columns', 'too_many_rows', 'invalid_file', 'empty_file'])

/** Checks a file without importing anything (`mode=validate`) and keeps it for {@link useCommitImport}. */
export function useStartImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      importSeq += 1
      const id = `import-${importSeq}`
      let job: ImportJob
      try {
        job = importJobFromReport(id, file.name, await importProducts(file, { mode: 'validate' }))
      } catch (error) {
        // A problem with the whole file is the job's failure, shown like Build 2's "failed" check.
        if (!(error instanceof ApiError && error.status === 422 && FILE_PROBLEMS.has(error.code))) throw error
        job = { id, status: 'failed', file_name: file.name, total_rows: 0, ok_rows: 0, ok_products: 0, unchanged: 0, error_rows: 0, errors: [{ row: 1, product: null, column: WHOLE_ROW, field: null, code: error.code, message: error.message }], ignored_columns: [], errors_truncated: false }
      }
      importJobs.set(id, { file, job })
      qc.setQueryData(keys.importJob(id), job)
      return { job_id: id }
    },
  })
}

/** Imports the checked file's ready rows as drafts and names them, so photos can be matched by name. */
export function useCommitImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (jobId: string): Promise<ImportCommit> => {
      const found = importJobs.get(jobId)
      if (!found) throw new ApiError({ status: 404, code: 'import_not_found', message: 'That import has ended. Upload the file again.' })
      if (found.job.status === 'committed') throw new ApiError({ status: 409, code: 'already_imported', message: 'These products were imported already.' })
      const report: ImportReportOut = await importProducts(found.file, { mode: 'import' })
      const made = (report.products ?? []).flatMap((p) => (p.status === 'created' && p.product_id ? [p.product_id] : []))
      const titles = new Map<string, string>()
      await inBatches(made, DETAIL_BATCH, async (productId) => {
        const product = await productDetail(qc, productId).catch(() => null)
        if (product) titles.set(productId, product.title)
      })
      const job = { ...importJobFromReport(jobId, found.file.name, report), status: 'committed' as const }
      importJobs.set(jobId, { ...found, job })
      qc.setQueryData(keys.importJob(jobId), job)
      return importCommitFromReport(report, titles)
    },
    onSuccess: () => {
      // Counts first: the list's refetch reads them, and must not reuse the old ones.
      void qc.invalidateQueries({ queryKey: keys.counts })
      void qc.invalidateQueries({ queryKey: keys.allProducts })
      void qc.invalidateQueries({ queryKey: keys.productIndex })
      void qc.invalidateQueries({ queryKey: keys.summary })
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

/** One run of main's validate-first import, with the whole report. `validate` writes nothing. */
export function useRunImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, mode }: { file: File; mode: ImportMode }): Promise<ImportReport> => importReportFromApi(await importProducts(file, { mode })),
    onSuccess: (report) => {
      if (!report.committed) return
      // Counts first: the list's refetch reads them, and must not reuse the old ones.
      void qc.invalidateQueries({ queryKey: keys.counts })
      void qc.invalidateQueries({ queryKey: keys.allProducts })
      void qc.invalidateQueries({ queryKey: keys.productIndex })
      void qc.invalidateQueries({ queryKey: keys.summary })
    },
  })
}

/** {@link useRunImport} with `mode=validate`. */
export function useValidateImport() {
  return useMutation({ mutationFn: async (file: File): Promise<ImportReport> => importReportFromApi(await importProducts(file, { mode: 'validate' })) })
}

// ---- store details, commission, size charts ------------------------------------------------------

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

function putStoreSection(save: StoreSectionSave) {
  const c = client()
  switch (save.section) {
    case 'brand': return c.PUT('/v1/vendor/store-details/brand', { body: save.body })
    case 'contact': return c.PUT('/v1/vendor/store-details/contact', { body: save.body })
    case 'delivery': return c.PUT('/v1/vendor/store-details/delivery', { body: save.body })
    case 'returns': return c.PUT('/v1/vendor/store-details/returns', { body: save.body })
    case 'payment': return c.PUT('/v1/vendor/store-details/payment', { body: save.body })
    case 'payout': return c.PUT('/v1/vendor/store-details/payout', { body: save.body })
    case 'business': return c.PUT('/v1/vendor/store-details/business', { body: save.body })
  }
}

// Saves one section; answers with the whole StoreDetails (missing, complete). A 422 is an ApiError
// whose `fields` are keyed like the section body ("pickup_address.pin").
export function useSaveStoreSection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (save: StoreSectionSave) => {
      try {
        return storeDetailsFromApi(await callObject(putStoreSection(save)))
      } catch (error) {
        throw storeErrors(error)
      }
    },
    onSuccess: (details) => {
      qc.setQueryData(keys.storeDetails, details)
      // setup.store_details, and whether products can be sent for review.
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

// Proposes a commission rate in basis points (1250 = 12.5%; parsePercent in src/lib/commission.ts).
export function useProposeCommission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rateBps: number): Promise<Commission> => commissionFromApi(await callObject(client().POST('/v1/vendor/commission/proposal', { body: { rate_bps: rateBps } }))),
    onSuccess: (commission) => {
      qc.setQueryData<Me>(keys.me, (me) => (me ? { ...me, vendor: { ...me.vendor, commission, commission_bps: commission.agreed_bps } } : me))
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

export function useSaveSizeChart(group: Schemas['SizeChartGroup']) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SizeChartInput) => {
      const current = qc.getQueryData<SizeChartOut>(keys.sizeChartRaw(group)) ?? (await sizeChartRaw(qc, group))
      const saved = await callObject(client().PUT('/v1/vendor/size-charts/{group}', { params: { path: { group } }, body: sizeChartBody(input, current, assetIdForUrl) }))
      rememberAsset(saved.photo_url, saved.photo_asset_id)
      qc.setQueryData(keys.sizeChartRaw(group), saved)
      return sizeChartFromApi(saved, group)
    },
    onSuccess: (chart) => qc.setQueryData(keys.sizeChart(chart.group), chart),
  })
}

// ---- review decisions (main's submissions) -------------------------------------------------------

export interface SubmissionParams {
  status?: SubmissionStatus | 'all'
  subject?: 'brand_profile' | 'product'
  limit?: number
  offset?: number
}

/** Everything sent for review and what came of it, newest first, with the reviewer's reasons. */
export function useSubmissions(params: SubmissionParams = {}) {
  return useQuery<SubmissionPage>({
    queryKey: keys.submissions(params),
    queryFn: async ({ signal }) => {
      const page = await callObject(client().GET('/v1/vendor/submissions', { params: { query: { ...params } }, signal }))
      return {
        items: (Array.isArray(page.items) ? page.items : []).map(submissionFromApi),
        total: Number.isInteger(page.total) ? page.total : 0,
        limit: Number.isInteger(page.limit) ? page.limit : (params.limit ?? 25),
        offset: Number.isInteger(page.offset) ? page.offset : (params.offset ?? 0),
      }
    },
    placeholderData: keepPreviousData,
  })
}

// ---- team (owners only) --------------------------------------------------------------------------

/** The vendor's users. 403 `forbidden` for staff. */
export function useTeam(enabled = true) {
  return useQuery<TeamUser[]>({
    queryKey: keys.team,
    enabled,
    queryFn: async ({ signal }) => {
      const users = await call(client().GET('/v1/vendor/users', { signal }))
      if (!Array.isArray(users)) throw unreadable()
      return users.map(teamUserFromApi)
    },
  })
}

/** Invites a staff member by email. Always accepted, so it never says whether the address has an account. */
export function useInviteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (email: string) => void (await call(client().POST('/v1/vendor/users', { body: { email: email.trim() } }))),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.team }),
  })
}

/** Sends an invitation again. 409 `not_invited` once the person has set a password. */
export function useResendInvite() {
  return useMutation({
    mutationFn: async (userId: string) => void (await call(client().POST('/v1/vendor/users/{user_id}/resend-invite', { params: { path: { user_id: userId } } }))),
  })
}

/** Turns a user off (they are signed out everywhere) or back on. 409 `cannot_disable_self`. */
export function useSetUserDisabled() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, disabled }: { userId: string; disabled: boolean }): Promise<TeamUser> =>
      teamUserFromApi(await callObject(client().PATCH('/v1/vendor/users/{user_id}', { params: { path: { user_id: userId } }, body: { disabled } }))),
    onSuccess: (user) => {
      qc.setQueryData<TeamUser[]>(keys.team, (team) => team?.map((u) => (u.id === user.id ? user : u)))
      void qc.invalidateQueries({ queryKey: keys.team })
    },
  })
}

