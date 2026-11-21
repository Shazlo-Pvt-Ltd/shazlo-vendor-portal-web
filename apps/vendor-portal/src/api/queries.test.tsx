import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEMO_LOGIN, DEMO_STAFF, REASONS } from '../mocks/db'
import type { SessionStore } from '../session/store'
import { validApplication } from '../test/fixtures'
import { setupMockApi } from '../test/server'
import { signInDemoUser } from '../test/session'
import { ApiError } from './errors'
import {
  useAddProductImage,
  useBrandPage,
  useBulkProducts,
  useCommitImport,
  useCreateProduct,
  useImportJob,
  useInviteUser,
  useMe,
  useProduct,
  useProducts,
  useProposeCommission,
  useReviews,
  useSaveBrandDraft,
  useSaveStoreSection,
  useSetUserDisabled,
  useSignUp,
  useStartImport,
  useSubmissions,
  useSubmitBrandPage,
  useSubmitProduct,
  useSummary,
  useTeam,
  useUpdateProduct,
  useVerifyEmail,
} from './queries'

// The hooks against the mock vendor-api, through main's real client and session: every request
// leaves through createApiClient with the access token, and is answered by src/mocks.

const { db, server } = setupMockApi({ now: () => new Date() })

/** Every request the hooks make from now on (the mock still answers them). */
function recordRequests() {
  const log: URL[] = []
  server.use(
    http.all('*', ({ request }) => {
      log.push(new URL(request.url))
    }),
  )
  const isList = (u: URL) => u.pathname === '/v1/vendor/products' && u.searchParams.get('limit') !== '1'
  return {
    /** Product list pages (not the `limit=1` counts). */
    lists: () => log.filter(isList),
    /** Single products read in full. */
    details: () => log.filter((u) => /^\/v1\/vendor\/products\/[0-9a-f-]{36}$/.test(u.pathname)),
  }
}
let store: SessionStore | undefined

afterEach(() => {
  store?.close()
  store = undefined
})

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return { queryClient, wrapper }
}

async function signedIn(credentials = DEMO_LOGIN) {
  store = await signInDemoUser(credentials)
  return setup()
}

const bySku = (sku: string) => db().products.find((p) => p.sku === sku)!

describe('reads', () => {
  it('useMe puts the session, store details, brand page and counts together', async () => {
    const { wrapper } = await signedIn()
    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({
      vendor: { brand_name: 'Kalki Studio', status: 'approved', commission_bps: 1200, commission: { state: 'agreed', agreed_bps: 1200 } },
      user: { name: 'Kiran Shah', email: DEMO_LOGIN.email },
      role: 'vendor_owner',
      setup: { brand_page: true, first_product: true, store_details: false, live_products: 18, live_target: 10 },
    })
  })

  it('useProducts gives Build 2\'s rows (photo, price, stock) and the counts', async () => {
    const { wrapper } = await signedIn()
    const { result } = renderHook(() => useProducts({ limit: 10 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const page = result.current.data!
    expect(page.counts).toEqual({ all: 27, approved: 18, pending_review: 4, rejected: 2, draft: 3, archived: 0 })
    expect(page.total).toBe(27)
    expect(page.items).toHaveLength(10)
    expect(page.next_cursor).toBe('10')
    const kurta = page.items.find((p) => p.sku === 'KS-AJR-014')!
    expect(kurta).toMatchObject({ title: 'Ajrakh Block-Print Kurta', category: 'Kurtas', status: 'rejected', price_paise: 249900, mrp_paise: 299900, stock: 28, main_colour: 'Indigo' })
    expect(kurta.thumbnail_url).toMatch(/^blob:/)
  })

  it('filters and sorts what vendor-api cannot, here', async () => {
    const { wrapper } = await signedIn()
    const { result } = renderHook(() => useProducts({ stock: 'out', limit: 10 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data!.items.map((p) => p.sku)).toEqual(['KS-CHK-018'])
    const sorted = renderHook(() => useProducts({ status: 'approved', sort: 'price_desc', limit: 3 }), { wrapper })
    await waitFor(() => expect(sorted.result.current.isSuccess).toBe(true))
    expect(sorted.result.current.data!.items.map((p) => p.price_paise)).toEqual([599900, 449900, 349900])
    expect(sorted.result.current.data!.total).toBe(18)
  })

  it('useProduct shows a live product with a change in review', async () => {
    const { wrapper } = await signedIn()
    const { result } = renderHook(() => useProduct(bySku('KS-HCS-003').id), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ status: 'approved', edit_in_review: true, price_paise: 119900, review: { state: 'waiting' } })
  })

  it('useReviews links each decision to its product, with the reason', async () => {
    const { wrapper } = await signedIn()
    const { result } = renderHook(() => useReviews('rejected'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const page = result.current.data!
    expect(page.counts).toEqual({ all: 26, waiting: 5, rejected: 2, approved: 19 })
    const kurta = page.items.find((i) => i.subject.detail === 'KS-AJR-014')!
    expect(kurta).toMatchObject({ state: 'rejected', reason: REASONS['KS-AJR-014'], subject: { type: 'product', id: bySku('KS-AJR-014').id } })
    expect(kurta.subject.thumbnail_url).toMatch(/^blob:/)
  })

  it('useSummary counts what waits and what was sent back', async () => {
    const { wrapper } = await signedIn()
    const { result } = renderHook(() => useSummary(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ reviews_waiting: 5, sent_back: 2, products: { all: 27 } })
    expect(result.current.data!.oldest_waiting_hours).toBeGreaterThanOrEqual(29)
  })

  it('useSubmissions is main\'s list, newest first', async () => {
    const { wrapper } = await signedIn()
    const { result } = renderHook(() => useSubmissions({ status: 'pending', limit: 2 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data!.total).toBe(5)
    expect(result.current.data!.items).toHaveLength(2)
    expect(result.current.data!.items[0]).toMatchObject({ status: 'pending', subject: 'product' })
  })
})

describe('products', () => {
  it('creates a draft with a portal-made code, saves Build 2\'s fields and reads them back', async () => {
    const { wrapper } = await signedIn()
    const create = renderHook(() => useCreateProduct(), { wrapper })
    let id = ''
    await act(async () => {
      id = (await create.result.current.mutateAsync({ title: 'Kala Cotton Kurta' })).id
    })
    expect(db().products.find((p) => p.id === id)?.sku).toMatch(/^P-/)
    const update = renderHook(() => useUpdateProduct(id), { wrapper })
    await act(async () => {
      await update.result.current.mutateAsync({ category: 'Kurtas', gender: 'Women', material: 'Kala cotton', main_colour: 'Indigo', other_colours: ['Red'], variants: [{ size: 'M', sku: '', stock: 4 }], price_paise: 189900 })
    })
    const saved = db().products.find((p) => p.id === id)!.working!.content
    expect(saved).toMatchObject({ category: 'kurtas', gender: 'women', fabric: 'Kala cotton', main_colour: 'Indigo', other_colours: ['Red'] })
    expect(saved.variants).toMatchObject([{ size: 'M', stock: 4, price_paise: 189900 }])
    const read = renderHook(() => useProduct(id), { wrapper })
    await waitFor(() => expect(read.result.current.data?.material).toBe('Kala cotton'))
  })

  it('a refused submit lists every missing requirement under the editor\'s keys', async () => {
    const { wrapper } = await signedIn()
    const submit = renderHook(() => useSubmitProduct(bySku('KS-KAL-011').id), { wrapper })
    let error: unknown
    await act(async () => {
      error = await submit.result.current.mutateAsync().catch((e: unknown) => e)
    })
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('product_incomplete')
    expect(Object.keys((error as ApiError).fields)).toEqual(['gender', 'main_colour', 'material', 'description', 'photos', 'tryon', 'variants', 'price_paise', 'store_details'])
  })

  it('uploads a photo through sign → Cloudinary → register and puts it in its slot', async () => {
    const { wrapper } = await signedIn()
    const id = bySku('KS-AJR-014').id
    const add = renderHook(() => useAddProductImage(id), { wrapper })
    let product: Awaited<ReturnType<typeof add.result.current.mutateAsync>> | undefined
    await act(async () => {
      product = await add.result.current.mutateAsync({ file: new File(['jpeg-bytes'], 'back.jpg', { type: 'image/jpeg' }), angle: 'back' })
    })
    expect(product!.images.filter((i) => i.angle === 'back')).toHaveLength(1)
    const back = product!.images.find((i) => i.angle === 'back')!
    expect(db().assets.get(back.id)).toMatchObject({ status: 'ready', kind: 'product_image' })
  })

  it('reports a photo upload\'s progress, and a cancelled one adds nothing', async () => {
    const { wrapper } = await signedIn()
    const id = bySku('KS-AJR-014').id
    const add = renderHook(() => useAddProductImage(id), { wrapper })
    const progress: number[] = []
    await act(async () => {
      await add.result.current.mutateAsync({ file: new File(['jpeg-bytes'], 'back.jpg', { type: 'image/jpeg' }), angle: 'back', onProgress: (f) => progress.push(f) })
    })
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1)

    const before = db().products.find((p) => p.id === id)!.working!.content.images.length
    const cancel = new AbortController()
    cancel.abort()
    let error: unknown
    await act(async () => {
      error = await add.result.current.mutateAsync({ file: new File(['jpeg-bytes'], 'worn.jpg', { type: 'image/jpeg' }), angle: 'extra', signal: cancel.signal }).catch((e: unknown) => e)
    })
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
    expect(db().products.find((p) => p.id === id)!.working!.content.images).toHaveLength(before)
  })
})

describe('after a change', () => {
  it('the list shows fresh counts once a product is archived or sent', async () => {
    const { wrapper } = await signedIn()
    const list = renderHook(() => useProducts({ status: 'approved' }), { wrapper })
    await waitFor(() => expect(list.result.current.data?.counts).toMatchObject({ approved: 18, archived: 0 }))
    const bulk = renderHook(() => useBulkProducts(), { wrapper })
    await act(async () => {
      await bulk.result.current.mutateAsync({ action: 'archive', ids: [bySku('KS-BDN-022').id] })
    })
    await waitFor(() => expect(list.result.current.data?.counts).toMatchObject({ approved: 17, archived: 1 }))
    expect(list.result.current.data?.items).toHaveLength(17)
  })
})

describe('store details, commission and the brand page', () => {
  it('saving the payout completes the store details and Home\'s setup', async () => {
    const { wrapper } = await signedIn()
    const me = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(me.result.current.data?.setup.store_details).toBe(false))
    const save = renderHook(() => useSaveStoreSection(), { wrapper })
    let details: Awaited<ReturnType<typeof save.result.current.mutateAsync>> | undefined
    await act(async () => {
      details = await save.result.current.mutateAsync({ section: 'payout', body: { method: 'bank', holder_name: 'Kalki Studio LLP', account_number: '5010 0123 4567 4821', ifsc: 'hdfc0001234' } })
    })
    expect(details).toMatchObject({ complete: true, missing: [], payout: { method: 'bank', bank_name: 'HDFC Bank', account_last4: '4821' } })
    await waitFor(() => expect(me.result.current.data?.setup.store_details).toBe(true))
  })

  it('a section\'s 422 is keyed like the section body', async () => {
    const { wrapper } = await signedIn()
    const save = renderHook(() => useSaveStoreSection(), { wrapper })
    let error: unknown
    await act(async () => {
      error = await save.result.current.mutateAsync({ section: 'delivery', body: { mode: 'shazlo', pickup_address: { line1: '', area: 'Ambawadi', city: 'Ahmedabad', pin: '012' } } }).catch((e: unknown) => e)
    })
    expect(Object.keys((error as ApiError).fields).sort()).toEqual(['pickup_address.line1', 'pickup_address.pin'])
  })

  it('proposing a commission keeps the agreed rate until Shazlo decides', async () => {
    const { wrapper } = await signedIn()
    const propose = renderHook(() => useProposeCommission(), { wrapper })
    await act(async () => {
      await propose.result.current.mutateAsync(1000)
    })
    const me = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(me.result.current.data?.vendor.commission).toMatchObject({ state: 'proposed', agreed_bps: 1200, proposed_bps: 1000 }))
  })

  it('the brand page has the live version, the draft and what changed; saving and sending work', async () => {
    const { wrapper } = await signedIn()
    const page = renderHook(() => useBrandPage(), { wrapper })
    await waitFor(() => expect(page.result.current.isSuccess).toBe(true))
    expect(page.result.current.data).toMatchObject({ changed_fields: ['cover_url', 'story'], review: { state: 'approved' }, live: { based_in: 'Ahmedabad, Gujarat', instagram: '@kalki.studio' } })
    const save = renderHook(() => useSaveBrandDraft(), { wrapper })
    await act(async () => {
      await save.result.current.mutateAsync({ ...page.result.current.data!.draft!, tagline: 'Indigo, always.' })
    })
    expect(db().brands.values().next().value!.find((v) => v.state === 'draft')!.content.tagline).toBe('Indigo, always.')
    const submit = renderHook(() => useSubmitBrandPage(), { wrapper })
    let after: Awaited<ReturnType<typeof submit.result.current.mutateAsync>> | undefined
    await act(async () => {
      after = await submit.result.current.mutateAsync()
    })
    expect(after!.review.state).toBe('waiting')
  })
})

describe('bulk import', () => {
  it('checks the file first, then makes the drafts and names them for the photos', async () => {
    const { wrapper } = await signedIn()
    const csv = [
      'product_name,gender,product_type,main_colour,other_colours,selling_price,sizes_stock,description,material,mrp',
      'Relaxed Linen Shirt,Men,Shirts,Beige,White,1899,"S:4, M:6",Washed linen.,100% linen,2499',
      'Broken Row,Men,Spacesuits,Beige,,1899,"S:4",Nope.,Linen,',
    ].join('\n')
    const start = renderHook(() => useStartImport(), { wrapper })
    let jobId = ''
    await act(async () => {
      jobId = (await start.result.current.mutateAsync(new File([csv], 'products.csv', { type: 'text/csv' }))).job_id
    })
    const job = renderHook(() => useImportJob(jobId), { wrapper })
    await waitFor(() => expect(job.result.current.data?.status).toBe('ready'))
    expect(job.result.current.data).toMatchObject({ total_rows: 2, ok_rows: 1, ok_products: 1, error_rows: 1, errors: [{ row: 3, field: 'product_type', column: 'Product type' }] })
    expect(db().products.some((p) => p.working?.content.title === 'Relaxed Linen Shirt')).toBe(false)
    const commit = renderHook(() => useCommitImport(), { wrapper })
    let made: Awaited<ReturnType<typeof commit.result.current.mutateAsync>> | undefined
    await act(async () => {
      made = await commit.result.current.mutateAsync(jobId)
    })
    expect(made).toMatchObject({ created: 1, products: [{ title: 'Relaxed Linen Shirt' }] })
  })

  it('a file without the template\'s columns is a failed check, not an error', async () => {
    const { wrapper } = await signedIn()
    const start = renderHook(() => useStartImport(), { wrapper })
    let jobId = ''
    await act(async () => {
      jobId = (await start.result.current.mutateAsync(new File(['name,price\nShirt,100'], 'wrong.csv', { type: 'text/csv' }))).job_id
    })
    const job = renderHook(() => useImportJob(jobId), { wrapper })
    await waitFor(() => expect(job.result.current.data?.status).toBe('failed'))
    expect(job.result.current.data!.errors[0]!.message).toMatch(/no column named/)
  })
})

describe('team', () => {
  it('lists the team, invites someone and turns a user off', async () => {
    const { wrapper } = await signedIn()
    const team = renderHook(() => useTeam(), { wrapper })
    await waitFor(() => expect(team.result.current.data).toHaveLength(3))
    const invite = renderHook(() => useInviteUser(), { wrapper })
    await act(async () => {
      await invite.result.current.mutateAsync('new.person@kalkistudio.in')
    })
    await waitFor(() => expect(team.result.current.data).toHaveLength(4))
    const meera = team.result.current.data!.find((u) => u.email === DEMO_STAFF.email)!
    const toggle = renderHook(() => useSetUserDisabled(), { wrapper })
    await act(async () => {
      await toggle.result.current.mutateAsync({ userId: meera.id, disabled: true })
    })
    await waitFor(() => expect(team.result.current.data!.find((u) => u.id === meera.id)?.status).toBe('disabled'))
  })

  it('is for owners only', async () => {
    const { wrapper } = await signedIn(DEMO_STAFF)
    const team = renderHook(() => useTeam(), { wrapper })
    await waitFor(() => expect(team.result.current.isError).toBe(true))
    expect(team.result.current.error).toMatchObject({ status: 403, code: 'forbidden' })
  })
})

describe('list rows that carry their own fields (proposed)', () => {
  it('a list of 18 products is one request, with no product read in full', async () => {
    const { wrapper } = await signedIn()
    const requests = recordRequests()
    const { result } = renderHook(() => useProducts({ status: 'approved', limit: 25 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data!.items).toHaveLength(18)
    expect(requests.lists()).toHaveLength(1)
    expect(requests.details()).toHaveLength(0)
    const shirt = result.current.data!.items.find((p) => p.sku === 'KS-HCS-003')!
    expect(shirt).toMatchObject({ edit_in_review: true, price_paise: 119900, stock: 22, main_colour: 'Rust' })
    expect(shirt.thumbnail_url).toMatch(/^blob:/)
  })

  it('without them (vendor-api today) it reads each product in full, and shows the same list', async () => {
    const { wrapper } = await signedIn()
    const fast = renderHook(() => useProducts({ status: 'approved', limit: 25 }), { wrapper })
    await waitFor(() => expect(fast.result.current.isSuccess).toBe(true))
    db().proposals.productSummaries = false
    const requests = recordRequests()
    const slow = renderHook(() => useProducts({ status: 'approved', limit: 25 }), { wrapper: setup().wrapper })
    await waitFor(() => expect(slow.result.current.isSuccess).toBe(true))
    expect(requests.details()).toHaveLength(18)
    expect(slow.result.current.data).toEqual(fast.result.current.data)
  })

  it('filters by gender and sold-out stock, and sorts by price, on the server in one request each', async () => {
    const { wrapper } = await signedIn()
    const requests = recordRequests()
    const unisex = renderHook(() => useProducts({ gender: 'Unisex', limit: 25 }), { wrapper })
    await waitFor(() => expect(unisex.result.current.isSuccess).toBe(true))
    expect(unisex.result.current.data!.items.map((p) => p.sku).sort()).toEqual(['KS-HCS-003', 'KS-KHD-015', 'KS-KMJ-007', 'KS-KNT-012'])
    const out = renderHook(() => useProducts({ stock: 'out', limit: 25 }), { wrapper })
    await waitFor(() => expect(out.result.current.isSuccess).toBe(true))
    expect(out.result.current.data!.items.map((p) => p.sku)).toEqual(['KS-CHK-018'])
    const sorted = renderHook(() => useProducts({ status: 'approved', sort: 'price_desc', limit: 3 }), { wrapper })
    await waitFor(() => expect(sorted.result.current.isSuccess).toBe(true))
    expect(sorted.result.current.data!.items.map((p) => p.price_paise)).toEqual([599900, 449900, 349900])
    expect(sorted.result.current.data!.total).toBe(18)
    const lists = requests.lists()
    expect(lists).toHaveLength(3)
    expect(lists[0]!.searchParams.get('gender')).toBe('unisex')
    expect(lists[1]!.searchParams.get('in_stock')).toBe('false')
    expect(lists[2]!.searchParams.get('sort')).toBe('price_desc')
    expect(requests.details()).toHaveLength(0)
  })

  it('works out "low stock" from the rows, without reading any product in full', async () => {
    const { wrapper } = await signedIn()
    const requests = recordRequests()
    const { result } = renderHook(() => useProducts({ stock: 'low', limit: 25 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data!.items.map((p) => p.sku).sort()).toEqual(['KS-JMD-005', 'KS-KLM-002'])
    expect(result.current.data!.total).toBe(2)
    expect(requests.details()).toHaveLength(0)
    expect(requests.lists()[0]!.searchParams.get('in_stock')).toBe('true')
  })
})

describe('decisions that name their product (proposed)', () => {
  it('link to the product without reading the product list', async () => {
    const { wrapper } = await signedIn()
    const requests = recordRequests()
    const { result } = renderHook(() => useReviews('rejected'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data!.items.find((i) => i.subject.detail === 'KS-KMJ-007')!.subject.id).toBe(bySku('KS-KMJ-007').id)
    expect(requests.lists()).toHaveLength(0)
  })

  it('without the product id (vendor-api today) read the product list to link them, with the same result', async () => {
    const { wrapper } = await signedIn()
    const withIds = renderHook(() => useReviews('rejected'), { wrapper })
    await waitFor(() => expect(withIds.result.current.isSuccess).toBe(true))
    db().proposals.submissionProductIds = false
    const requests = recordRequests()
    const withoutIds = renderHook(() => useReviews('rejected'), { wrapper: setup().wrapper })
    await waitFor(() => expect(withoutIds.result.current.isSuccess).toBe(true))
    expect(requests.lists().length).toBeGreaterThan(0)
    expect(withoutIds.result.current.data).toEqual(withIds.result.current.data)
  })
})

describe('the product version (proposed)', () => {
  it('every save sends the version it has just read, and the version moves on', async () => {
    const { wrapper } = await signedIn()
    const kurta = bySku('KS-DAB-042')
    const sent: unknown[] = []
    server.use(
      http.put(`*/v1/vendor/products/${kurta.id}`, async ({ request }) => {
        sent.push(((await request.clone().json()) as { version?: number }).version)
      }),
    )
    const before = kurta.version
    const update = renderHook(() => useUpdateProduct(kurta.id), { wrapper })
    await act(async () => {
      await update.result.current.mutateAsync({ title: 'Indigo Dabu Co-ord Set' })
      await update.result.current.mutateAsync({ material: 'Cotton mul' })
    })
    expect(sent).toEqual([before, before + 1])
    expect(kurta.version).toBe(before + 2)
  })
})

describe('signed out', () => {
  it('signs up with the store details, then verifies the email', async () => {
    const { wrapper } = setup()
    const signUp = renderHook(() => useSignUp(), { wrapper })
    await act(async () => {
      await signUp.result.current.mutateAsync({ ...validApplication, password: 'indigo-and-madder-26' })
    })
    const vendor = db().vendors.find((v) => v.name === 'Neel Threads')!
    expect(vendor.status).toBe('pending')
    expect(db().stores.get(vendor.id)).toMatchObject({ sells: 'both', city: 'Surat', payment: { cash: true, upi: true }, payout: { method: 'bank', ifsc: 'HDFC0001234' } })
    const token = db().emails.find((e) => e.kind === 'verify')!.token!
    const verify = renderHook(() => useVerifyEmail(), { wrapper })
    await act(async () => {
      await verify.result.current.mutateAsync(token)
    })
    expect(db().users.find((u) => u.email === 'asha@neelthreads.in')?.verified).toBe(true)
  })

  it('a sign-up 422 comes back under the steps\' names', async () => {
    const { wrapper } = setup()
    const signUp = renderHook(() => useSignUp(), { wrapper })
    let error: unknown
    await act(async () => {
      error = await signUp.result.current
        .mutateAsync({ ...validApplication, password: 'indigo-and-madder-26', owner_name: '', returns: { window_days: 7, condition: null, refund_days: null } })
        .catch((e: unknown) => e)
    })
    expect(Object.keys((error as ApiError).fields).sort()).toEqual(['owner_name', 'returns.condition', 'returns.refund_days'])
  })
})
