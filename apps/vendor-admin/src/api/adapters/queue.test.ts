import { describe, expect, it } from 'vitest'
import type { components } from '../schema'
import { joinSlices, nextOffset, toQueueItem, toQueueSlice, type QueueSlice } from './queue'

type Wire = components['schemas']['QueueItemOut']
type WirePage = components['schemas']['QueuePageOut']

const vendor = { id: 'v1', name: 'Kalki Studio' }
const wire = (over: Partial<Wire> = {}): Wire => ({
  id: 'r1',
  kind: 'product',
  subject_id: 'p1',
  title: 'Handloom Shirt',
  detail: 'KS-1',
  vendor,
  submitted_at: '2026-11-01T10:00:00Z',
  change: 'new',
  resubmission: 0,
  thumbnail_url: null,
  ...over,
})
const page = (over: Partial<WirePage> = {}): WirePage => ({
  items: [wire()],
  total: 1,
  limit: 50,
  offset: 0,
  counts: { all: 1, product: 1, brand_page: 0, application: 0 },
  vendors: [vendor],
  ...over,
})
const slice = (ids: string[], over: Partial<QueueSlice> = {}): QueueSlice => ({
  ...toQueueSlice(page({ items: ids.map((id) => wire({ id })), total: ids.length })),
  ...over,
})

describe('toQueueItem', () => {
  it('keeps what the server sent', () => {
    expect(toQueueItem(wire({ thumbnail_url: 'https://cdn/x.jpg', resubmission: 2, change: 'edit' }))).toEqual({
      id: 'r1', kind: 'product', subject_id: 'p1', title: 'Handloom Shirt', detail: 'KS-1', vendor,
      submitted_at: '2026-11-01T10:00:00Z', change: 'edit', resubmission: 2, thumbnail_url: 'https://cdn/x.jpg',
    })
  })

  it('leaves out a kind this screen does not know', () => {
    expect(toQueueItem(wire({ kind: 'bundle' as Wire['kind'] }))).toBeNull()
  })

  it('does not let a blank title or vendor name make a broken row', () => {
    const item = toQueueItem(wire({ title: '  ', vendor: { id: 'v2', name: '' } }))!
    expect(item.title).toBe('Untitled')
    expect(item.vendor).toEqual({ id: 'v2', name: 'Unnamed vendor' })
  })

  it('falls back on the change the kind implies', () => {
    expect(toQueueItem(wire({ change: 'rewrite' as Wire['change'] }))!.change).toBe('new')
    expect(toQueueItem(wire({ kind: 'application', change: 'rewrite' as Wire['change'] }))!.change).toBe('application')
  })

  it('never shows a negative or fractional resubmission count', () => {
    expect(toQueueItem(wire({ resubmission: -3 }))!.resubmission).toBe(0)
    expect(toQueueItem(wire({ resubmission: 2.9 }))!.resubmission).toBe(2)
    expect(toQueueItem(wire({ resubmission: Number.NaN }))!.resubmission).toBe(0)
  })
})

describe('toQueueSlice', () => {
  it('drops unknown kinds but keeps the rest and the paging position', () => {
    const s = toQueueSlice(page({ items: [wire({ id: 'a' }), wire({ id: 'b', kind: 'bundle' as Wire['kind'] })], total: 2, limit: 10, offset: 20 }))
    expect(s.items.map((i) => i.id)).toEqual(['a'])
    expect([s.total, s.limit, s.offset]).toEqual([2, 10, 20])
  })

  it('reads an empty queue', () => {
    const s = toQueueSlice(page({ items: [], total: 0, counts: { all: 0, product: 0, brand_page: 0, application: 0 }, vendors: [] }))
    expect(s.items).toEqual([])
    expect(s.counts.all).toBe(0)
  })

  it('turns bad counts into zero', () => {
    const s = toQueueSlice(page({ total: -1, counts: { all: Number.NaN, product: -5, brand_page: 2.7, application: 'x' as unknown as number } }))
    expect(s.total).toBe(0)
    expect(s.counts).toEqual({ all: 0, product: 0, brand_page: 2, application: 0 })
  })
})

describe('nextOffset', () => {
  it('points past the page while more is waiting', () => {
    expect(nextOffset({ total: 120, limit: 50, offset: 0 })).toBe(50)
    expect(nextOffset({ total: 120, limit: 50, offset: 50 })).toBe(100)
  })

  it('stops at the last page, at exactly the total, and on an empty list', () => {
    expect(nextOffset({ total: 120, limit: 50, offset: 100 })).toBeUndefined()
    expect(nextOffset({ total: 100, limit: 50, offset: 50 })).toBeUndefined()
    expect(nextOffset({ total: 0, limit: 50, offset: 0 })).toBeUndefined()
  })

  it('cannot loop when the server reports no page size', () => {
    expect(nextOffset({ total: 10, limit: 0, offset: 0 })).toBeUndefined()
  })
})

describe('joinSlices', () => {
  it('joins pages in order', () => {
    const joined = joinSlices([slice(['a', 'b'], { offset: 0, limit: 2, total: 4 }), slice(['c', 'd'], { offset: 2, limit: 2, total: 4 })])
    expect(joined.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(joined.loaded).toBe(4)
  })

  it('shows an item once when it moved to the next page while the list was open', () => {
    const joined = joinSlices([slice(['a', 'b']), slice(['b', 'c'])])
    expect(joined.items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('takes the total and counts from the newest page', () => {
    const newest = slice(['c'], { total: 7 })
    expect(joinSlices([slice(['a'], { total: 9 }), newest]).total).toBe(7)
  })
})
