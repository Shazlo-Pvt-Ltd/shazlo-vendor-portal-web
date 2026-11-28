import { mockModuleToken } from '@shazlo/mock-vendor-api'
import { describe, expect, it } from 'vitest'
import type { components } from './schema'

type Detail = components['schemas']['ReviewDetailOut']

// The demo-mode mock must answer the review routes in the shape vendor-api's openapi.json declares
// (ReviewDetailOut), with the same refusals, or the screens would work on the mock and break on the service.
const token = mockModuleToken({ id: 'a1', name: 'Admin' }, Math.floor(Date.now() / 1000) + 3600)
const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
  const res = await fetch(`http://mock.test${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, body: (await res.json()) as Detail & { error?: { code: string; request_id: string; details?: unknown[] } } }
}

const DETAIL_KEYS = ['base', 'changes', 'content', 'decided_at', 'events', 'id', 'product_id', 'reason', 'reason_code', 'resubmission', 'reviewer_id', 'sku', 'status', 'subject', 'submitted_at', 'submitted_by', 'submitted_by_email', 'title', 'vendor', 'version']
const EVENT_KEYS = ['action', 'actor_id', 'actor_type', 'created_at', 'detail', 'reason']

describe('mock vendor-api: GET /v1/admin/reviews/{id}', () => {
  it('has the shape of ReviewDetailOut for a product and for a brand page', async () => {
    for (const [id, subject] of [['rev_p_handloom', 'product'], ['rev_brand_v_nila', 'brand_profile']] as const) {
      const { status, body } = await call('GET', `/v1/admin/reviews/${id}`)
      expect(status).toBe(200)
      expect(Object.keys(body).sort()).toEqual(DETAIL_KEYS)
      expect(body.subject).toBe(subject)
      expect(body.status).toBe('pending')
      expect(Object.keys(body.vendor).sort()).toEqual(['id', 'name', 'slug', 'status'])
      expect(Object.keys(body.content).sort()).toEqual(['content', 'published_at', 'version'])
      expect(body.base).not.toBeNull()
      expect(Object.keys(body.base!).sort()).toEqual(['content', 'published_at', 'version'])
      for (const e of body.events) expect(Object.keys(e).sort()).toEqual(EVENT_KEYS)
      expect(body.changes.length).toBeGreaterThan(0)
    }
  })

  it('has no base for a first submission, and never the version sent back', async () => {
    expect((await call('GET', '/v1/admin/reviews/rev_p_dabu_skirt')).body.base).toBeNull()
    expect((await call('GET', '/v1/admin/reviews/rev_p_ajrakh')).body.base).toBeNull()
  })

  it('stores no photo slots, try-on photos or stock, like the service', async () => {
    const { body } = await call('GET', '/v1/admin/reviews/rev_p_ajrakh')
    const content = body.content.content as { variants: Record<string, unknown>[]; images: Record<string, unknown>[] }
    expect(Object.keys(content.variants[0]!).sort()).toEqual(['color', 'is_active', 'mrp_paise', 'price_paise', 'size', 'sku'])
    expect(Object.keys(content.images[0]!).sort()).toEqual(['alt_text', 'asset_id', 'position', 'url'])
    expect(content).not.toHaveProperty('try_on_photos')
  })

  it('is a 404 in the error envelope for an unknown review, and needs a token', async () => {
    const missing = await call('GET', '/v1/admin/reviews/rev_nope')
    expect(missing.status).toBe(404)
    expect(missing.body.error).toMatchObject({ code: 'review_not_found' })
    expect(missing.body.error!.request_id).toBeTruthy()
    expect((await fetch('http://mock.test/v1/admin/reviews/rev_p_ajrakh')).status).toBe(401)
  })
})

describe('mock vendor-api: approve and reject', () => {
  it('approves the version it is given and answers with the decided review', async () => {
    const detail = (await call('GET', '/v1/admin/reviews/rev_p_dabu_skirt')).body
    const { status, body } = await call('POST', '/v1/admin/reviews/rev_p_dabu_skirt/approve', { version: detail.content.version })
    expect(status).toBe(200)
    expect(body.status).toBe('approved')
    expect(Object.keys(body).sort()).toEqual(DETAIL_KEYS)
  })

  it('refuses a version that is not the one it holds: 409 stale_review', async () => {
    const stale = await call('POST', '/v1/admin/reviews/rev_p_handloom/approve', { version: 99 })
    expect(stale.status).toBe(409)
    expect(stale.body.error?.code).toBe('stale_review')
    expect((await call('GET', '/v1/admin/reviews/rev_p_handloom')).body.status).toBe('pending')
  })

  it('refuses a second decision: 409 review_already_decided', async () => {
    const version = (await call('GET', '/v1/admin/reviews/rev_p_patola')).body.content.version
    expect((await call('POST', '/v1/admin/reviews/rev_p_patola/approve', { version })).status).toBe(200)
    const again = await call('POST', '/v1/admin/reviews/rev_p_patola/reject', { version, reason: 'Too late' })
    expect(again.status).toBe(409)
    expect(again.body.error?.code).toBe('review_already_decided')
  })

  it('needs a version, a reason and a category from the list: 422', async () => {
    const version = (await call('GET', '/v1/admin/reviews/rev_p_potli')).body.content.version
    for (const bad of [{}, { version }, { version, reason: '   ' }, { version: 0, reason: 'x' }, { version, reason: 'x'.repeat(2001) }, { version, reason: 'ok', reason_code: 'nonsense' }]) {
      const res = await call('POST', '/v1/admin/reviews/rev_p_potli/reject', bad)
      expect(res.status, JSON.stringify(bad).slice(0, 60)).toBe(422)
      expect(res.body.error?.code).toBe('validation_error')
    }
    expect((await call('POST', '/v1/admin/reviews/rev_p_potli/approve', { version, reason_code: 'photos' })).status).toBe(422)
    expect((await call('GET', '/v1/admin/reviews/rev_p_potli')).body.status).toBe('pending')
  })

  it('records a rejection with its category, and a missing category is allowed', async () => {
    const version = (await call('GET', '/v1/admin/reviews/rev_p_potli')).body.content.version
    const done = await call('POST', '/v1/admin/reviews/rev_p_potli/reject', { version, reason: 'Price is above the MRP.', reason_code: 'price' })
    expect(done.status).toBe(200)
    expect(done.body).toMatchObject({ status: 'rejected', reason_code: 'price' })
    const other = (await call('GET', '/v1/admin/reviews/rev_p_dabu_set')).body.content.version
    expect((await call('POST', '/v1/admin/reviews/rev_p_dabu_set/reject', { version: other, reason: 'Needs work.' })).body.reason_code).toBeNull()
  })

  it('answers 404 for an unknown review', async () => {
    expect((await call('POST', '/v1/admin/reviews/rev_nope/approve', { version: 1 })).status).toBe(404)
    expect((await call('POST', '/v1/admin/reviews/rev_nope/reject', { version: 1, reason: 'x' })).status).toBe(404)
  })
})

describe('mock vendor-api: store details', () => {
  it('has the fields the admin reads, and 404s for an unknown vendor', async () => {
    const { status, body } = await call('GET', '/v1/admin/vendors/v_nila/store-details')
    expect(status).toBe(200)
    expect(body).toMatchObject({ brand_name: 'Nila Handloom', complete: true, returns: { window_days: 14 }, delivery: { mode: 'own', delivery_days: '2_3' } })
    expect((await call('GET', '/v1/admin/vendors/v_nope/store-details')).status).toBe(404)
  })
})
