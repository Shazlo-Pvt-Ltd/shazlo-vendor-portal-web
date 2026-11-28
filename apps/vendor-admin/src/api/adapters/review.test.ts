import { describe, expect, it } from 'vitest'
import type * as M from '../model'
import type { components } from '../schema'
import { afterDecision, neighboursIn, toBrandReview, toDecision, toPolicies, toProductReview, toProductVersion, toStatus } from './review'

type Detail = components['schemas']['ReviewDetailOut']
type Event = components['schemas']['EventOut']

const event = (action: string, at: string, reason: string | null = null): Event => ({ action, actor_type: action === 'submitted' ? 'vendor' : 'admin', actor_id: null, reason, detail: null, created_at: at })

const productContent = (over: Record<string, unknown> = {}) => ({
  title: 'Kurta',
  description: 'A kurta.',
  category: 'Clothing',
  subcategory: 'Kurtas',
  gender: 'women',
  fabric: 'Cotton',
  variants: [
    { sku: 'K-S', size: 'S', color: 'Indigo', price_paise: 249_900, mrp_paise: 299_900, is_active: true },
    { sku: 'K-M', size: 'M', color: 'Indigo', price_paise: 249_900, mrp_paise: 299_900, is_active: true },
    { sku: 'K-S-MAD', size: 'S', color: 'Madder red', price_paise: 249_900, mrp_paise: 299_900, is_active: true },
  ],
  images: [
    { position: 2, asset_id: 'b', url: 'https://img/b.jpg', alt_text: null },
    { position: 1, asset_id: 'a', url: 'https://img/a.jpg', alt_text: null },
  ],
  ...over,
})

function detail(over: Partial<Detail> = {}): Detail {
  return {
    id: 'r1',
    subject: 'product',
    status: 'pending',
    vendor: { id: 'v1', name: 'Kalki Studio', slug: 'kalki-studio', status: 'approved' },
    submitted_by: 'u1',
    submitted_by_email: 'kiran@kalki.in',
    submitted_at: '2026-11-09T05:00:00Z',
    version: 2,
    title: 'Kurta',
    product_id: 'p1',
    sku: 'K-1',
    reviewer_id: null,
    decided_at: null,
    reason: null,
    reason_code: null,
    events: [event('submitted', '2026-11-09T05:00:00Z')],
    content: { version: 2, published_at: null, content: productContent() },
    base: null,
    changes: [],
    resubmission: 0,
    ...over,
  }
}

const brandContent = (over: Record<string, unknown> = {}) => ({
  brand_name: 'Nila',
  tagline: 'Handloom.',
  about: 'We weave.',
  logo: { asset_id: 'l', url: 'https://img/logo.png' },
  banner: { asset_id: 'b', url: 'https://img/banner.png' },
  website_url: 'nila.in',
  instagram_handle: 'nila',
  categories: ['Sarees'],
  price_min_paise: 1,
  price_max_paise: 2,
  ...over,
})

const brandDetail = (over: Partial<Detail> = {}): Detail => detail({ subject: 'brand_profile', product_id: null, sku: null, content: { version: 3, published_at: null, content: brandContent() }, ...over })

describe('toProductVersion', () => {
  it('reads the product fields, the colours of the variants and the photos in order', () => {
    const v = toProductVersion(productContent())
    expect(v).toMatchObject({ title: 'Kurta', description: 'A kurta.', gender: 'women', product_type: 'Kurtas', material: 'Cotton', price_paise: 249_900, mrp_paise: 299_900 })
    expect(v.main_colour).toEqual({ name: 'Indigo', hex: '#2E3F6E' })
    expect(v.other_colours.map((c) => c.name)).toEqual(['Madder red'])
    expect(v.photos.map((p) => p.url)).toEqual(['https://img/a.jpg', 'https://img/b.jpg'])
    expect(v.variants.map((x) => x.sku)).toEqual(['K-S', 'K-M', 'K-S-MAD'])
  })

  it('leaves out what vendor-api does not keep: photo slots, try-on photos, stock, size chart', () => {
    const v = toProductVersion(productContent())
    expect(v.photos.every((p) => p.slot === null)).toBe(true)
    expect(v.try_on_photos).toBeNull()
    expect(v.variants.every((x) => x.stock === null)).toBe(true)
    expect(v.size_chart).toBeNull()
  })

  it('shows the lowest price with its MRP, and skips variants that are switched off', () => {
    const v = toProductVersion(productContent({ variants: [{ sku: 'A', size: 'S', color: 'Rust', price_paise: 100, mrp_paise: 150, is_active: false }, { sku: 'B', size: 'M', color: 'Rust', price_paise: 300, mrp_paise: 400, is_active: true }, { sku: 'C', size: 'L', color: 'Rust', price_paise: 200, mrp_paise: null, is_active: true }] }))
    expect(v.price_paise).toBe(200)
    expect(v.mrp_paise).toBeNull()
    expect(v.variants.map((x) => x.sku)).toEqual(['B', 'C'])
  })

  it('copes with no variants, no photos and no colours', () => {
    const v = toProductVersion(productContent({ variants: [], images: [] }))
    expect(v.price_paise).toBe(0)
    expect(v.mrp_paise).toBeNull()
    expect(v.variants).toEqual([])
    expect(v.photos).toEqual([])
    expect(v.main_colour.name).toBe('—')
    expect(v.other_colours).toEqual([])
  })

  it('copes with a malformed body: nothing throws', () => {
    const v = toProductVersion({ title: 5, variants: 'x', images: [null, 3, { url: 4 }, { url: '' }], gender: 'robot' })
    expect(v).toMatchObject({ title: '', gender: 'unisex', variants: [], photos: [] })
  })

  it('leaves out a photo with no address (a deleted asset)', () => {
    expect(toProductVersion(productContent({ images: [{ position: 1, asset_id: 'a', url: '' }, { position: 2, asset_id: 'b', url: 'https://img/b.jpg' }] })).photos.map((p) => p.id)).toEqual(['b'])
  })

  it('keeps a very long description whole', () => {
    expect(toProductVersion(productContent({ description: 'x'.repeat(50_000) })).description).toHaveLength(50_000)
  })

  it('keeps 13 photos', () => {
    expect(toProductVersion(productContent({ images: Array.from({ length: 13 }, (_, i) => ({ position: i + 1, asset_id: `a${i}`, url: `https://img/${i}.jpg` })) })).photos).toHaveLength(13)
  })

  it('gives a multicolour product the striped swatch and an unknown colour a neutral one', () => {
    expect(toProductVersion(productContent({ variants: [{ sku: 'A', size: 'S', color: 'Multicolour', price_paise: 1, is_active: true }] })).main_colour.hex).toBeNull()
    expect(toProductVersion(productContent({ variants: [{ sku: 'A', size: 'S', color: 'Peacock', price_paise: 1, is_active: true }] })).main_colour.hex).toMatch(/^#/)
  })
})

describe('toProductReview', () => {
  it('maps the review: its id, version, status, vendor and the resubmission count', () => {
    const r = toProductReview(detail({ resubmission: 2 }))!
    expect(r).toMatchObject({ id: 'r1', version: 2, sku: 'K-1', status: 'pending_review', resubmission: 2, vendor: { id: 'v1', name: 'Kalki Studio' } })
  })

  it('is a first submission with nothing to compare with when there is no base', () => {
    const r = toProductReview(detail())!
    expect(r.compare_to).toBeNull()
    expect(r.compare_label).toBeNull()
  })

  it('compares with the live version when there is a base', () => {
    const r = toProductReview(detail({ base: { version: 1, published_at: '2026-10-01T00:00:00Z', content: productContent({ title: 'Old kurta' }) } }))!
    expect(r.compare_label).toBe('live')
    expect(r.compare_to?.title).toBe('Old kurta')
  })

  it('is not a product review when the review is a brand page', () => {
    expect(toProductReview(brandDetail())).toBeNull()
  })

  it('tells the history: who submitted, the decision and the reason, and drops steps it cannot show', () => {
    const r = toProductReview(detail({ events: [event('submitted', '2026-11-09T05:00:00Z'), event('reopened', '2026-11-09T06:00:00Z'), event('rejected', '2026-11-09T07:00:00Z', 'Blurry photos.'), event('something_new', '2026-11-09T08:00:00Z')] }))!
    expect(r.history).toEqual([
      { at: '2026-11-09T05:00:00Z', event: 'submitted', by: 'kiran@kalki.in' },
      { at: '2026-11-09T07:00:00Z', event: 'rejected', by: 'Reviewer', note: 'Blurry photos.' },
    ])
  })

  it('names a withdrawn review as such', () => {
    const r = toProductReview(detail({ status: 'withdrawn', events: [event('submitted', '2026-11-09T05:00:00Z'), event('withdrawn', '2026-11-09T06:00:00Z')] }))!
    expect(r.status).toBe('withdrawn')
    expect(r.history.map((e) => e.event)).toEqual(['submitted', 'withdrawn'])
  })

  it('shows a vendor that was suspended, and one with no name', () => {
    expect(toProductReview(detail({ vendor: { id: 'v1', name: '  ', slug: 's', status: 'suspended' } }))!.vendor.name).toBe('Unnamed vendor')
  })

  it('treats a status it does not know as waiting', () => {
    expect(toStatus('on_hold')).toBe('pending_review')
    expect(toStatus('approved')).toBe('approved')
  })

  it('carries the neighbours it is given, and clamps a bad resubmission count', () => {
    const nav = { prev: { kind: 'product' as const, id: 'a' }, next: null }
    expect(toProductReview(detail({ resubmission: -4 }), nav)).toMatchObject({ prev: nav.prev, next: null, resubmission: 0 })
  })
})

describe('toBrandReview', () => {
  it('maps the brand fields to the screen’s names', () => {
    const r = toBrandReview(brandDetail(), undefined, { return_policy: '7_day', dispatch_time: '2_3_days' })!
    expect(r.draft).toEqual({ tagline: 'Handloom.', story: 'We weave.', based_in: '', cover_url: 'https://img/banner.png', logo_url: 'https://img/logo.png', return_policy: '7_day', dispatch_time: '2_3_days', instagram: '@nila', website: 'nila.in' })
    expect(r.live).toBeNull()
    expect(r.version).toBe(3)
  })

  it('has a live page when there is a base, and lists the changed fields under the screen’s names', () => {
    const r = toBrandReview(brandDetail({ base: { version: 2, published_at: '2026-10-01T00:00:00Z', content: brandContent({ tagline: 'Old.' }) }, changes: [{ field: 'tagline', before: 'Old.', after: 'Handloom.' }, { field: 'about', before: 'a', after: 'b' }, { field: 'banner', before: null, after: {} }, { field: 'categories', before: [], after: ['x'] }, { field: 'brand_name', before: 'a', after: 'b' }, { field: 'tagline', before: 'x', after: 'y' }] }))!
    expect(r.live?.tagline).toBe('Old.')
    expect(r.changed_fields).toEqual(['tagline', 'story', 'cover_url'])
  })

  it('has no images when the banner and the logo are gone', () => {
    const r = toBrandReview(brandDetail({ content: { version: 1, published_at: null, content: brandContent({ logo: null, banner: { asset_id: 'x' } }) } }))!
    expect(r.draft.cover_url).toBeNull()
    expect(r.draft.logo_url).toBeNull()
  })

  it('keeps an Instagram handle that already starts with @', () => {
    expect(toBrandReview(brandDetail({ content: { version: 1, published_at: null, content: brandContent({ instagram_handle: '@nila' }) } }))!.draft.instagram).toBe('@nila')
  })

  it('is not a brand review when the review is a product', () => {
    expect(toBrandReview(detail())).toBeNull()
  })
})

describe('toPolicies', () => {
  const details = (returns: unknown, delivery: unknown) => ({ returns, delivery }) as components['schemas']['StoreDetailsOut']

  it('turns the returns window and the delivery time into the brand page’s labels', () => {
    expect(toPolicies(details({ window_days: 7 }, { mode: 'own', areas: { all_india: true, places: [] }, delivery_days: '2_3' }))).toEqual({ return_policy: '7_day', dispatch_time: '2_3_days' })
    expect(toPolicies(details({ window_days: 0 }, { mode: 'own', areas: { all_india: false, places: ['Pune'] }, delivery_days: '5_7' }))).toEqual({ return_policy: 'no_returns', dispatch_time: '5_7_days' })
    expect(toPolicies(details({ window_days: 30 }, null)).return_policy).toBe('30_day')
  })

  it('has nothing to say when the details are missing or empty', () => {
    expect(toPolicies(undefined)).toEqual({ return_policy: '', dispatch_time: '' })
    expect(toPolicies(details(null, { mode: 'shazlo', pickup_address: {} }))).toEqual({ return_policy: '', dispatch_time: '' })
    // The mock's old application shape (`days`) is not vendor-api's: it must not be read as a delivery time.
    expect(toPolicies(details(null, { by: 'own', days: '2_3' })).dispatch_time).toBe('')
  })
})

describe('toDecision', () => {
  it('says approved, or sent back for anything else, with where to go next', () => {
    const next: M.ReviewRef = { kind: 'product', id: 'n' }
    expect(toDecision(detail({ status: 'approved', decided_at: '2026-11-09T06:00:00Z' }), next)).toEqual({ id: 'r1', decision: 'approved', at: '2026-11-09T06:00:00Z', next })
    expect(toDecision(detail({ status: 'rejected', decided_at: '2026-11-09T06:00:00Z' }), null).decision).toBe('rejected')
  })
})

describe('moving through the queue', () => {
  const item = (id: string, kind: M.ItemKind): M.QueueItem => ({ id, kind, subject_id: `s-${id}`, title: id, detail: '', vendor: { id: 'v', name: 'V' }, submitted_at: '2026-11-09T00:00:00Z', change: 'new', resubmission: 0, thumbnail_url: null })
  const order = [item('app', 'application'), item('a', 'product'), item('b', 'brand_page'), item('c', 'product')]

  it('finds the items either side, skipping applications, with the kind of page each opens', () => {
    expect(neighboursIn(order, 'b')).toEqual({ prev: { kind: 'product', id: 'a' }, next: { kind: 'product', id: 'c' } })
    expect(neighboursIn(order, 'a')).toEqual({ prev: null, next: { kind: 'brand_page', id: 'b' } })
    expect(neighboursIn(order, 'c').next).toBeNull()
  })

  it('has no neighbours for an item that is not in the queue, or an empty queue', () => {
    expect(neighboursIn(order, 'zzz')).toEqual({ prev: null, next: null })
    expect(neighboursIn([], 'a')).toEqual({ prev: null, next: null })
  })

  it('offers the next item after a decision, else the oldest still waiting, else nothing', () => {
    expect(afterDecision(order, 'a')).toEqual({ kind: 'brand_page', id: 'b' })
    expect(afterDecision(order, 'c')).toEqual({ kind: 'product', id: 'a' })
    expect(afterDecision([item('a', 'product')], 'a')).toBeNull()
    expect(afterDecision([], 'a')).toBeNull()
    expect(afterDecision([item('app', 'application')], 'a')).toBeNull()
  })
})
