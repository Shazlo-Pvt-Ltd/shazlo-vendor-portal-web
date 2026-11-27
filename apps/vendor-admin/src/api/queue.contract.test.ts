import { mockModuleToken } from '@shazlo/mock-vendor-api'
import { describe, expect, it } from 'vitest'
import type { components } from './schema'

type Page = components['schemas']['QueuePageOut']

// The demo-mode mock must answer `GET /v1/admin/queue` in the shape vendor-api's openapi.json
// declares (QueuePageOut), or the screen would work on the mock and break on the real service.
const token = mockModuleToken({ id: 'a1', name: 'Admin' }, Math.floor(Date.now() / 1000) + 3600)
const get = async (query = ''): Promise<{ status: number; body: Page }> => {
  const res = await fetch(`http://mock.test/v1/admin/queue${query}`, { headers: { authorization: `Bearer ${token}` } })
  return { status: res.status, body: (await res.json()) as Page }
}

const PAGE_KEYS = ['counts', 'items', 'limit', 'offset', 'total', 'vendors']
const ITEM_KEYS = ['change', 'detail', 'id', 'kind', 'resubmission', 'subject_id', 'submitted_at', 'thumbnail_url', 'title', 'vendor']

describe('mock vendor-api: GET /v1/admin/queue', () => {
  it('has the page shape of QueuePageOut and the item shape of QueueItemOut', async () => {
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(Object.keys(body).sort()).toEqual(PAGE_KEYS)
    expect(Object.keys(body.counts).sort()).toEqual(['all', 'application', 'brand_page', 'product'])
    expect(body.items.length).toBeGreaterThan(0)
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS)
      expect(Object.keys(item.vendor).sort()).toEqual(['id', 'name'])
    }
    expect(body.limit).toBe(50)
    expect(body.offset).toBe(0)
    expect(body.total).toBe(body.counts.all)
  })

  it('pages: no item repeats or is skipped, and counts do not follow the page', async () => {
    const first = await get('?limit=5&offset=0')
    const second = await get('?limit=5&offset=5')
    const third = await get('?limit=5&offset=10')
    const ids = [...first.body.items, ...second.body.items, ...third.body.items].map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(first.body.total)
    expect(second.body.counts).toEqual(first.body.counts)
    expect(second.body.vendors).toEqual(first.body.vendors)
  })

  it('rejects a page size or offset the real service rejects, in the error envelope', async () => {
    for (const bad of ['?limit=0', '?limit=101', '?offset=-1', '?limit=abc']) {
      const res = await get(bad)
      expect(res.status, bad).toBe(422)
      expect(Object.keys((res.body as unknown as { error: object }).error)).toEqual(expect.arrayContaining(['code', 'message', 'request_id']))
    }
  })

  it('needs a token', async () => {
    const res = await fetch('http://mock.test/v1/admin/queue')
    expect(res.status).toBe(401)
  })
})
