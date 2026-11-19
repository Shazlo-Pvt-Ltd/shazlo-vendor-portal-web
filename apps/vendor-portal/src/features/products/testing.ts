import { http, HttpResponse } from 'msw'
import { BASE, apiErrorResponse } from '../../test/msw'
import type { Revision } from './form'
import type { ProductDetail, ProductSummary } from './status'

export function product(n: number, overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: `p${n}`,
    sku: `SKU-${n}`,
    status: 'approved',
    version: 1,
    title: `Product ${n}`,
    category: 'kurtas',
    has_pending_changes: false,
    updated_at: '2026-11-10T09:30:00Z',
    ...overrides,
  }
}

export function detail(id: string, overrides: Partial<ProductDetail> = {}): ProductDetail {
  return { id, sku: 'SKU', status: 'draft', version: 1, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-10T09:30:00Z', live: null, working: null, ...overrides } as ProductDetail
}

export const revision = (version: number, submittedAt: string | null) =>
  ({ id: `r${version}`, version, submitted_at: submittedAt, state: 'draft' }) as unknown as NonNullable<ProductDetail['working']>

/** A fake list endpoint that filters and pages like the real one, and records each query it was sent. */
export function listHandler(all: ProductSummary[], seen: URLSearchParams[] = []) {
  return http.get(`${BASE}/v1/vendor/products`, ({ request }) => {
    const params = new URL(request.url).searchParams
    seen.push(params)
    const status = params.get('status')
    const category = params.get('category')
    const q = params.get('q')?.toLowerCase()
    const limit = Number(params.get('limit') ?? 25)
    const offset = Number(params.get('offset') ?? 0)
    const matches = all.filter(
      (item) =>
        (status ? item.status === status : item.status !== 'archived') &&
        (!category || item.category === category) &&
        (!q || item.title.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q)),
    )
    return HttpResponse.json({ items: matches.slice(offset, offset + limit), total: matches.length, limit, offset })
  })
}

export const detailHandler = (byId: Record<string, ProductDetail>, seen: string[] = []) =>
  http.get(`${BASE}/v1/vendor/products/:id`, ({ params }) => {
    seen.push(String(params.id))
    const found = byId[String(params.id)]
    return found ? HttpResponse.json(found) : apiErrorResponse(404, 'not_found')
  })

/** A whole revision, as `GET /v1/vendor/products/{id}` returns it. */
export const fullRevision = (overrides: Partial<Revision> = {}): Revision => ({
  id: 'r1',
  version: 1,
  state: 'editing',
  title: 'Block-print kurta',
  description: null,
  category: 'kurtas',
  subcategory: null,
  gender: 'women',
  fabric: null,
  weight_grams: null,
  returnable: false,
  return_window_days: null,
  variants: [{ id: 'v1', sku: 'K-M', size: 'M', color: 'Indigo', price_paise: 149900, mrp_paise: 199900, is_active: true }],
  images: [],
  submitted_at: null,
  review: null,
  updated_at: '2026-11-10T09:30:00Z',
  ...overrides,
})
