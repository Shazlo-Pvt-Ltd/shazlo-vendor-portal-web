import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { getResponse, http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { addAsset, DEMO_LOGIN } from '../mocks/db'
import { createHandlers } from '../mocks/handlers'
import type { SessionStore } from '../session/store'
import { validApplication } from '../test/fixtures'
import { setupMockApi } from '../test/server'
import { signInDemoUser } from '../test/session'
import { ApiError, NetworkError } from './errors'
import {
  useAddProductImage,
  useBrandPage,
  useMoveProductImage,
  useMe,
  useProduct,
  useProducts,
  useReviews,
  useSaveStoreSection,
  useSignUp,
  useTeam,
  useUpdateProduct,
} from './queries'

// Trying to break the API layer: answers vendor-api should never send but a proxy, a bug or a newer
// API might; sessions that end mid-request; edits that race; limits; empty accounts.

const { server, db } = setupMockApi()
let store: SessionStore | undefined

afterEach(() => {
  store?.close()
  store = undefined
})

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

async function signedIn(credentials = DEMO_LOGIN) {
  store = await signInDemoUser(credentials)
  return wrapper()
}

const bySku = (sku: string) => db().products.find((p) => p.sku === sku)!

describe('malformed and partial answers', () => {
  it('a body that is not JSON becomes bad_response, not a crash', async () => {
    const w = await signedIn()
    server.use(http.get('*/v1/vendor/me', () => new HttpResponse('<html>502 Bad Gateway</html>', { headers: { 'Content-Type': 'application/json' } })))
    const { result } = renderHook(() => useMe(), { wrapper: w })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 502, code: 'bad_response' })
  })

  it('JSON that is not an object (null, a list) is bad_response too', async () => {
    const w = await signedIn()
    server.use(http.get('*/v1/vendor/products/:id', () => HttpResponse.json(null)))
    const { result } = renderHook(() => useProduct(bySku('KS-AJR-014').id), { wrapper: w })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ code: 'bad_response' })
  })

  it('a product with fields missing or unknown still opens', async () => {
    const w = await signedIn()
    server.use(
      http.get('*/v1/vendor/products/:id', ({ params }) =>
        HttpResponse.json({
          id: params.id,
          sku: 'ODD-1',
          status: 'quarantined',
          created_at: '2026-11-01T10:00:00Z',
          updated_at: '2026-11-01T10:00:00Z',
          live: null,
          working: { state: 'editing', title: 'Odd', category: 'spacesuits', gender: 'kids', variants: [{ size: 'M', stock: 'lots' }], images: [{ asset_id: 'a', url: 'https://res.cloudinary.com/x/a.jpg', angle: 'sideways' }] },
        }),
      ),
    )
    const { result } = renderHook(() => useProduct('00000000-0000-4000-8000-00000000abcd'), { wrapper: w })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ status: 'draft', category: null, gender: null, variants: [{ size: 'M', stock: 0 }], images: [{ angle: 'extra' }] })
  })

  it('unknown states from the server are read safely: commission, submissions, team members', async () => {
    const w = await signedIn()
    server.use(
      http.get('*/v1/vendor/me', () => HttpResponse.json({ user: { id: 'u', email: DEMO_LOGIN.email, role: 'owner', last_login_at: null }, vendor: { id: 'v', name: 'Kalki Studio', slug: 'k', status: 'approved', commission: { state: 'renegotiating', agreed_bps: 1200 } } })),
      http.get('*/v1/vendor/users', () => HttpResponse.json([{ id: 'u', email: 'x@y.in', role: 'admin', status: 'frozen', last_login_at: null, created_at: '2026-11-01T10:00:00Z' }])),
      http.get('*/v1/vendor/submissions', () => HttpResponse.json({ items: [{ subject: 'product', id: 's', sku: 'KS-AJR-014', title: 'x', version: 1, status: 'escalated', reason: null, submitted_at: '2026-11-01T10:00:00Z', decided_at: null }], total: 1, limit: 50, offset: 0 })),
    )
    const me = renderHook(() => useMe(), { wrapper: w })
    await waitFor(() => expect(me.result.current.isSuccess).toBe(true))
    expect(me.result.current.data!.vendor.commission).toMatchObject({ state: 'not_set', agreed_bps: 1200 })
    const team = renderHook(() => useTeam(), { wrapper: w })
    await waitFor(() => expect(team.result.current.isSuccess).toBe(true))
    expect(team.result.current.data).toMatchObject([{ role: 'staff', status: 'disabled' }])
    const reviews = renderHook(() => useReviews(), { wrapper: w })
    await waitFor(() => expect(reviews.result.current.isSuccess).toBe(true))
    expect(reviews.result.current.data!.items).toEqual([])
  })

  it('vendor-api as it is today, without the proposed routes, still gives a Home', async () => {
    const w = await signedIn()
    const missing = () => HttpResponse.json({ error: { code: 'not_found', message: 'Not Found', request_id: 'r' } }, { status: 404 })
    server.use(http.get('*/v1/vendor/store-details', missing), http.get('*/v1/vendor/me', () => HttpResponse.json({ user: { id: 'u', email: DEMO_LOGIN.email, role: 'owner', last_login_at: null }, vendor: { id: 'v', name: 'Kalki Studio', slug: 'k', status: 'approved' } })))
    const me = renderHook(() => useMe(), { wrapper: w })
    await waitFor(() => expect(me.result.current.isSuccess).toBe(true))
    expect(me.result.current.data).toMatchObject({ vendor: { commission: { state: 'not_set', agreed_bps: null } }, setup: { store_details: false }, user: { name: DEMO_LOGIN.email } })
  })
})

describe('sessions that end mid-request', () => {
  it('a 401 renews the token from the refresh cookie and sends the request again', async () => {
    const w = await signedIn()
    const before = store!.getAccessToken()
    db().sessions.access.clear() // every access token expires at once
    const { result } = renderHook(() => useMe(), { wrapper: w })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(store!.getAccessToken()).not.toBe(before)
  })

  it('when the refresh fails too, the request fails with 401 and the session ends as expired', async () => {
    const w = await signedIn()
    db().sessions.access.clear()
    db().sessions.refresh.clear()
    const { result } = renderHook(() => useMe(), { wrapper: w })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 401 })
    expect(store!.getSnapshot()).toMatchObject({ status: 'signedOut', expired: true })
  })

  it('a vendor suspended while signed in is blocked, not looped', async () => {
    const w = await signedIn()
    db().vendors.find((v) => v.name === 'Kalki Studio')!.status = 'suspended'
    const { result } = renderHook(() => useProducts({ limit: 5 }), { wrapper: w })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 403, code: 'vendor_not_allowed' })
    expect(store!.getSnapshot().status).toBe('blocked')
  })
})

describe('network failures', () => {
  it('a dropped connection is a NetworkError the screens can word', async () => {
    const w = await signedIn()
    db().faults.push({ path: '/v1/vendor/brand-profile', method: 'GET', network: true })
    const { result } = renderHook(() => useBrandPage(), { wrapper: w })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(NetworkError)
  })

  it('a 5xx keeps vendor-api\'s message and request id', async () => {
    const w = await signedIn()
    db().faults.push({ path: '/v1/vendor/products', method: 'GET', status: 503, code: 'unavailable', message: 'Down for a minute.' })
    const { result } = renderHook(() => useProducts({ limit: 5 }), { wrapper: w })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 503, message: 'Down for a minute.' })
    expect((result.current.error as ApiError).requestId).toBeTruthy()
  })
})

describe('422 details', () => {
  it('pydantic\'s union tag in front of a field is dropped, so the field still gets its message', async () => {
    const w = await signedIn()
    server.use(
      http.put('*/v1/vendor/store-details/delivery', () =>
        HttpResponse.json({ error: { code: 'validation_error', message: 'Request validation failed', request_id: 'r', details: [{ loc: ['body', 'shazlo', 'pickup_address', 'pin'], msg: 'Value error, Enter a 6-digit PIN code', type: 'value_error' }] } }, { status: 422 }),
      ),
    )
    const save = renderHook(() => useSaveStoreSection(), { wrapper: w })
    let error: unknown
    await act(async () => {
      error = await save.result.current.mutateAsync({ section: 'delivery', body: { mode: 'shazlo', pickup_address: { line1: 'x', area: 'y', city: 'z', pin: '1' } } }).catch((e: unknown) => e)
    })
    expect((error as ApiError).fields).toEqual({ 'pickup_address.pin': 'Enter a 6-digit PIN code' })
  })

  it('a sign-up problem deep in the store details goes to the right step', async () => {
    const save = renderHook(() => useSignUp(), { wrapper: wrapper() })
    let error: unknown
    await act(async () => {
      error = await save.result.current
        .mutateAsync({ ...validApplication, password: 'indigo-and-madder-26', payout: { method: 'bank', holder_name: 'Neel', account_number: '12', ifsc: 'HDFC0001234' } })
        .catch((e: unknown) => e)
    })
    expect(Object.keys((error as ApiError).fields)).toEqual(['payout.account_number'])
  })
})

describe('edits that race', () => {
  it('a save in one tab keeps a change another tab made to a different field', async () => {
    const w = await signedIn()
    const kurta = bySku('KS-AJR-014')
    const open = renderHook(() => useProduct(kurta.id), { wrapper: w })
    await waitFor(() => expect(open.result.current.isSuccess).toBe(true))
    // The other tab renames it after this tab read it.
    kurta.working!.content.title = 'Renamed in the other tab'
    const update = renderHook(() => useUpdateProduct(kurta.id), { wrapper: w })
    await act(async () => {
      await update.result.current.mutateAsync({ material: 'Mulmul' })
    })
    expect(kurta.working!.content).toMatchObject({ title: 'Renamed in the other tab', fabric: 'Mulmul' })
  })

  it('a save after the other tab sent it for review gets 409, for the editor to show', async () => {
    const w = await signedIn()
    const kurta = bySku('KS-DAB-042')
    kurta.working!.state = 'in_review'
    const update = renderHook(() => useUpdateProduct(kurta.id), { wrapper: w })
    let error: unknown
    await act(async () => {
      error = await update.result.current.mutateAsync({ title: 'Too late' }).catch((e: unknown) => e)
    })
    expect(error).toMatchObject({ status: 409, code: 'product_in_review' })
  })

  it('an autosave and a photo upload at the same moment both land', async () => {
    const w = await signedIn()
    const kurta = bySku('KS-AJR-014')
    const update = renderHook(() => useUpdateProduct(kurta.id), { wrapper: w })
    const add = renderHook(() => useAddProductImage(kurta.id), { wrapper: w })
    await act(async () => {
      await Promise.all([
        add.result.current.mutateAsync({ file: new File(['x'], 'back.jpg', { type: 'image/jpeg' }), angle: 'back' }),
        update.result.current.mutateAsync({ description: 'Typed while the photo uploaded.' }),
      ])
    })
    expect(kurta.working!.content.description).toBe('Typed while the photo uploaded.')
    expect(kurta.working!.content.images.some((i) => i.angle === 'back')).toBe(true)
  })
})

describe('list rows that are only partly there', () => {
  it('a page where one row lacks the proposed fields is read the old way, not shown half empty', async () => {
    const w = await signedIn()
    let details = 0
    server.use(
      http.get('*/v1/vendor/products/:id', () => {
        details += 1
      }),
      http.get('*/v1/vendor/products', async ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('limit') === '1') return undefined
        const answer = await getResponse(createHandlers(() => db()), request.clone())
        const real = (await answer!.json()) as { items: Record<string, unknown>[]; total: number; limit: number; offset: number }
        // A proxy or an older replica drops one field from one row.
        const { thumbnail_url: _dropped, ...partial } = real.items[0]!
        return HttpResponse.json({ ...real, items: [partial, ...real.items.slice(1)] })
      }),
    )
    const { result } = renderHook(() => useProducts({ status: 'approved', limit: 5 }), { wrapper: w })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(details).toBe(5)
    expect(result.current.data!.items.every((p) => typeof p.thumbnail_url === 'string')).toBe(true)
  })
})

describe('two tabs editing the same field (product version, proposed)', () => {
  it('the save that lost the race reads the product again once and keeps the other tab\'s other changes', async () => {
    const w = await signedIn()
    const kurta = bySku('KS-AJR-014')
    let puts = 0
    server.use(
      http.put(`*/v1/vendor/products/${kurta.id}`, () => {
        puts += 1
        if (puts === 1) {
          // Tab B saves between this tab's read and its write.
          kurta.working!.content.title = 'Title from tab B'
          kurta.working!.content.description = 'Description from tab B'
          kurta.version += 1
        }
      }),
    )
    const update = renderHook(() => useUpdateProduct(kurta.id), { wrapper: w })
    await act(async () => {
      await update.result.current.mutateAsync({ title: 'Title from tab A' })
    })
    expect(puts).toBe(2)
    expect(kurta.working!.content).toMatchObject({ title: 'Title from tab A', description: 'Description from tab B' })
  })

  it('a save that loses twice stops and gives the editor a 409 version_conflict to show', async () => {
    const w = await signedIn()
    const kurta = bySku('KS-AJR-014')
    let puts = 0
    server.use(
      http.put(`*/v1/vendor/products/${kurta.id}`, () => {
        puts += 1
        // Tab B saves again and again.
        kurta.working!.content.title = `Title from tab B (${puts})`
        kurta.version += 1
      }),
    )
    const update = renderHook(() => useUpdateProduct(kurta.id), { wrapper: w })
    let error: unknown
    await act(async () => {
      error = await update.result.current.mutateAsync({ title: 'Title from tab A' }).catch((e: unknown) => e)
    })
    expect(puts).toBe(2)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'version_conflict' })
    expect(kurta.working!.content.title).toBe('Title from tab B (2)')
  })

  it('photo moves are guarded too: a move that loses once is applied to the fresh product', async () => {
    const w = await signedIn()
    const kurta = bySku('KS-AJR-014')
    const worn = kurta.working!.content.images.find((i) => i.angle === 'worn')!
    let puts = 0
    server.use(
      http.put(`*/v1/vendor/products/${kurta.id}`, () => {
        puts += 1
        if (puts === 1) {
          kurta.working!.content.fabric = 'Changed in tab B'
          kurta.version += 1
        }
      }),
    )
    const move = renderHook(() => useMoveProductImage(kurta.id), { wrapper: w })
    await act(async () => {
      await move.result.current.mutateAsync({ imageId: worn.asset_id, angle: 'back' })
    })
    expect(kurta.working!.content.fabric).toBe('Changed in tab B')
    expect(kurta.working!.content.images.find((i) => i.asset_id === worn.asset_id)!.angle).toBe('back')
  })

  it('with vendor-api as it is today (no version check) the later save wins, as before', async () => {
    const w = await signedIn()
    db().proposals.productVersions = false
    const kurta = bySku('KS-AJR-014')
    let puts = 0
    server.use(
      http.put(`*/v1/vendor/products/${kurta.id}`, () => {
        puts += 1
        kurta.working!.content.title = 'Title from tab B'
      }),
    )
    const update = renderHook(() => useUpdateProduct(kurta.id), { wrapper: w })
    await act(async () => {
      await update.result.current.mutateAsync({ title: 'Title from tab A' })
    })
    expect(puts).toBe(1)
    expect(kurta.working!.content.title).toBe('Title from tab A')
  })
})

describe('limits and empty accounts', () => {
  it('takes 13 photos (4 named, 4 extra, 5 try-on) and refuses a 14th under the photos key', async () => {
    const w = await signedIn()
    const coord = bySku('KS-DAB-042')
    const now = new Date().toISOString()
    for (const angle of ['extra', 'extra', 'extra', 'tryon', 'tryon', 'tryon', 'tryon', 'tryon'] as const) {
      coord.working!.content.images.push({ asset_id: addAsset(db(), coord.vendor_id, 'product_image', 'blob:test/x', now).id, alt_text: null, angle })
    }
    expect(coord.working!.content.images).toHaveLength(12)
    const add = renderHook(() => useAddProductImage(coord.id), { wrapper: w })
    await act(async () => {
      await add.result.current.mutateAsync({ file: new File(['x'], 'extra.jpg', { type: 'image/jpeg' }), angle: 'extra' })
    })
    expect(coord.working!.content.images).toHaveLength(13)
    let error: unknown
    await act(async () => {
      error = await add.result.current.mutateAsync({ file: new File(['x'], 'more.jpg', { type: 'image/jpeg' }), angle: 'extra' }).catch((e: unknown) => e)
    })
    expect(error).toMatchObject({ status: 422 })
    expect(Object.keys((error as ApiError).fields)).toEqual(['photos'])
  })

  it('a brand-new seller with nothing yet gets empty lists, zero counts and an empty brand page', async () => {
    const signUp = renderHook(() => useSignUp(), { wrapper: wrapper() })
    await act(async () => {
      await signUp.result.current.mutateAsync({ ...validApplication, password: 'indigo-and-madder-26' })
    })
    const owner = db().users.find((u) => u.email === validApplication.email)!
    owner.verified = true
    const w = await signedIn({ email: validApplication.email, password: 'indigo-and-madder-26' })
    const products = renderHook(() => useProducts({ limit: 10 }), { wrapper: w })
    await waitFor(() => expect(products.result.current.isSuccess).toBe(true))
    expect(products.result.current.data).toEqual({ items: [], total: 0, next_cursor: null, counts: { all: 0, approved: 0, pending_review: 0, rejected: 0, draft: 0, archived: 0 } })
    const reviews = renderHook(() => useReviews(), { wrapper: w })
    await waitFor(() => expect(reviews.result.current.isSuccess).toBe(true))
    expect(reviews.result.current.data).toEqual({ items: [], counts: { all: 0, waiting: 0, rejected: 0, approved: 0 } })
    const me = renderHook(() => useMe(), { wrapper: w })
    await waitFor(() => expect(me.result.current.isSuccess).toBe(true))
    expect(me.result.current.data).toMatchObject({ vendor: { status: 'pending', commission: { state: 'not_set' } }, setup: { brand_page: false, first_product: false, live_products: 0 } })
    const brand = renderHook(() => useBrandPage(), { wrapper: w })
    await waitFor(() => expect(brand.result.current.isSuccess).toBe(true))
    expect(brand.result.current.data).toMatchObject({ live: null, review: { state: 'none' }, draft: { brand_name: 'Neel Threads', based_in: 'Surat' } })
  })
})
