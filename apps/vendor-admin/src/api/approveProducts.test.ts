import { mockModuleToken } from '@shazlo/mock-vendor-api'
import { beforeEach, describe, expect, it } from 'vitest'
import { VENDOR_API_URL } from '../test/render'
import { resetMockDb } from '../test/server'

// The mock's POST /api/v1/admin/vendors/{id}/products/approve (x-proposal): the rules the real
// vendor-api route should keep.

let db = resetMockDb()
beforeEach(() => {
  db = resetMockDb()
})

const token = () => mockModuleToken({ id: 'a_priya', name: 'Priya Mehta' }, Math.floor(Date.now() / 1000) + 300)

async function approve(vendorId: string, body: unknown, { auth = true } = {}) {
  const response = await fetch(`${VENDOR_API_URL}/api/v1/admin/vendors/${vendorId}/products/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token()}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> & { extra?: { code: string; fields?: Record<string, string> } } }
}

const product = (id: string) => db.products.find((p) => p.id === id)!
const seen = (id: string) => ({ id, submitted_at: product(id).submittedAt })
const waiting = () => db.products.filter((p) => p.status === 'pending_review').map((p) => p.id)

describe('mock vendor-api: approve several products', () => {
  it('approves each listed product as approving it alone would', async () => {
    const decisions = db.decisions.length
    const events = db.outbox.length
    const { status, body } = await approve('v_kalki', { products: [seen('p_ajrakh'), seen('p_handloom')] })
    expect(status).toBe(200)
    expect(body.failed).toEqual([])
    expect(body.approved).toEqual([
      { id: 'p_ajrakh', at: expect.any(String) },
      { id: 'p_handloom', at: expect.any(String) },
    ])
    for (const id of ['p_ajrakh', 'p_handloom']) {
      expect(product(id).status).toBe('approved')
      expect(product(id).history[0]).toMatchObject({ event: 'approved', by: 'Priya Mehta' })
    }
    expect(db.decisions).toHaveLength(decisions + 2)
    expect(db.outbox).toHaveLength(events + 2)
    // A new product is published; an edit to a live one updates it.
    expect(db.outbox.slice(0, 2).map((e) => e.event)).toEqual(['product.updated', 'product.published'])
  })

  it('gives the version the reviewer saw in the vendor detail', async () => {
    const response = await fetch(`${VENDOR_API_URL}/api/v1/admin/vendors/v_kalki`, { headers: { Authorization: `Bearer ${token()}` } })
    const vendor = (await response.json()) as { products: { id: string; submitted_at: string }[] }
    expect(vendor.products.find((p) => p.id === 'p_ajrakh')!.submitted_at).toBe(product('p_ajrakh').submittedAt)
  })

  // By the review page's rule: front, back, detail and worn photos, and 5 try-on photos.
  it('counts the required photos each product lacks in the vendor detail', async () => {
    const photosMissing = async (vendorId: string, id: string) => {
      const response = await fetch(`${VENDOR_API_URL}/api/v1/admin/vendors/${vendorId}`, { headers: { Authorization: `Bearer ${token()}` } })
      const vendor = (await response.json()) as { products: { id: string; photos_missing: number }[] }
      return vendor.products.find((p) => p.id === id)!.photos_missing
    }
    expect(await photosMissing('v_kalki', 'p_ajrakh')).toBe(0)
    // 2 of 5 try-on photos.
    expect(await photosMissing('v_indigo', 'p_dabu_set')).toBe(3)
    // No back photo as well.
    product('p_dabu_set').submitted.photos = product('p_dabu_set').submitted.photos.filter((p) => p.slot !== 'back')
    expect(await photosMissing('v_indigo', 'p_dabu_set')).toBe(4)
  })

  // Missing photos are the reviewer's call, as on the single-product route: they do not stop it.
  it('approves a product that lacks photos', async () => {
    const { status, body } = await approve('v_indigo', { products: [seen('p_dabu_set')] })
    expect(status).toBe(200)
    expect(body).toEqual({ approved: [{ id: 'p_dabu_set', at: expect.any(String) }], failed: [] })
  })

  // Approving here publishes; a suspended or rejected brand's products are hidden from the app.
  it.each(['suspended', 'rejected'] as const)('answers 409 for a %s brand and approves nothing', async (state) => {
    db.vendors.find((v) => v.id === 'v_kalki')!.status = state
    const decisions = db.decisions.length
    const { status, body } = await approve('v_kalki', { products: [seen('p_ajrakh')] })
    expect(status).toBe(409)
    expect(body.extra?.code).toBe('invalid_transition')
    expect(product('p_ajrakh').status).toBe('pending_review')
    expect(db.decisions).toHaveLength(decisions)
  })

  it('reports already decided, changed and unknown products, and approves the rest', async () => {
    product('p_dabu_skirt').status = 'rejected'
    const { status, body } = await approve('v_kalki', {
      products: [seen('p_ajrakh'), seen('p_dabu_skirt'), { id: 'p_handloom', submitted_at: new Date(0).toISOString() }, { id: 'p_nope', submitted_at: new Date().toISOString() }],
    })
    expect(status).toBe(200)
    expect(body.approved).toEqual([{ id: 'p_ajrakh', at: expect.any(String) }])
    expect(body.failed).toEqual([
      { id: 'p_dabu_skirt', code: 'not_pending', message: 'This product was already sent back.' },
      { id: 'p_handloom', code: 'changed', message: expect.stringMatching(/changed this product after you looked/) },
      { id: 'p_nope', code: 'not_found', message: expect.any(String) },
    ])
    expect(product('p_handloom').status).toBe('pending_review')
  })

  it('never approves another vendor’s product through this vendor’s URL', async () => {
    const { status, body } = await approve('v_kalki', { products: [seen('p_phulkari')] })
    expect(status).toBe(200)
    expect(body).toEqual({ approved: [], failed: [{ id: 'p_phulkari', code: 'not_found', message: expect.any(String) }] })
    expect(product('p_phulkari').status).toBe('pending_review')
  })

  it('answers 404 for an unknown vendor', async () => {
    const { status, body } = await approve('v_nope', { products: [seen('p_ajrakh')] })
    expect(status).toBe(404)
    expect(body.extra?.code).toBe('not_found')
    expect(product('p_ajrakh').status).toBe('pending_review')
  })

  // Built after the reset, so a valid item carries the version the db holds.
  const now = () => new Date().toISOString()
  it.each<[string, () => unknown]>([
    ['an empty list', () => ({ products: [] })],
    ['no list', () => ({})],
    ['a body that is not JSON', () => 'not json'],
    ['more than 50', () => ({ products: Array.from({ length: 51 }, (_, i) => ({ id: `p_${i}`, submitted_at: now() })) })],
    // A product listed twice stops the whole request, even at the version that waits.
    ['a product twice', () => ({ products: [seen('p_ajrakh'), seen('p_dabu_skirt'), seen('p_ajrakh')] })],
    ['a product without the version seen', () => ({ products: [seen('p_dabu_skirt'), { id: 'p_ajrakh' }] })],
    ['a version that is not a date', () => ({ products: [{ id: 'p_ajrakh', submitted_at: 'yesterday' }] })],
    ['an empty id', () => ({ products: [{ id: '', submitted_at: now() }] })],
  ])('answers 422 for %s and approves nothing', async (_, body) => {
    const before = waiting()
    const decisions = db.decisions.length
    const { status, body: answer } = await approve('v_kalki', body())
    expect(status).toBe(422)
    expect(answer.extra).toMatchObject({ code: 'validation_error', fields: { products: expect.any(String) } })
    expect(waiting()).toEqual(before)
    expect(db.decisions).toHaveLength(decisions)
  })

  it('answers 401 without the module token', async () => {
    const { status } = await approve('v_kalki', { products: [seen('p_ajrakh')] }, { auth: false })
    expect(status).toBe(401)
    expect(product('p_ajrakh').status).toBe('pending_review')
  })
})
