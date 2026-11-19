import { describe, expect, it } from 'vitest'
import {
  filtersFromSearch,
  fixLink,
  isNewSince,
  isSuperseded,
  itemName,
  queryFromFilters,
  relativeTime,
  reviewKey,
  searchFromFilters,
  statusChanges,
} from './rules'
import { submission } from './testing'

const brand = submission({ subject: 'brand_profile', id: 'b1', sku: null, title: null, version: 3 })

describe('submission rules', () => {
  it('names the brand page and products, and links to the right editor', () => {
    expect(itemName(brand)).toBe('Brand page')
    expect(itemName(submission())).toBe('Indigo kurta')
    expect(itemName(submission({ title: '  ' }))).toBe('KRT-001')
    expect(fixLink(brand)).toBe('/brand')
    expect(fixLink(submission({ id: 'p7' }))).toBe('/products/p7')
  })

  it('knows a rejection that a later version replaced', () => {
    const rejected = submission({ status: 'rejected', version: 1 })
    expect(isSuperseded(rejected, [rejected])).toBe(false)
    expect(isSuperseded(rejected, [rejected, submission({ version: 2, status: 'pending' })])).toBe(true)
    // The same version number of something else does not count.
    expect(isSuperseded(rejected, [rejected, submission({ id: 'other', version: 2 })])).toBe(false)
  })

  it('describes the statuses that changed, and only those', () => {
    const before = new Map([
      [reviewKey(submission({ status: 'pending' })), 'pending'],
      [reviewKey(brand), 'approved'],
    ])
    const now = [submission({ status: 'rejected' }), brand, submission({ id: 'new', title: 'New kurta', status: 'pending' })]
    expect(statusChanges(before, now)).toEqual(['Indigo kurta, version 1: not approved.'])
    expect(statusChanges(new Map(), now)).toEqual([])
  })

  it('marks decisions made after the last visit', () => {
    const since = Date.parse('2026-11-11T00:00:00Z')
    expect(isNewSince(submission({ decided_at: '2026-11-11T12:00:00Z' }), since)).toBe(true)
    expect(isNewSince(submission({ decided_at: '2026-11-10T12:00:00Z' }), since)).toBe(false)
    expect(isNewSince(submission({ status: 'pending', decided_at: null }), since)).toBe(false)
    expect(isNewSince(submission(), null)).toBe(false)
  })

  it('reads filters from the address, ignoring anything invalid, and writes them back', () => {
    expect(filtersFromSearch(new URLSearchParams('status=rejected&subject=product&page=2'))).toEqual({ status: 'rejected', subject: 'product', page: 2 })
    expect(filtersFromSearch(new URLSearchParams('status=lost&subject=x&page=-1'))).toEqual({ status: '', subject: '', page: 1 })
    expect(searchFromFilters({ status: '', subject: 'brand_profile', page: 1 }).toString()).toBe('subject=brand_profile')
    expect(queryFromFilters({ status: '', subject: '', page: 3 })).toEqual({ status: 'all', limit: 20, offset: 40 })
  })

  it('says how long ago', () => {
    const now = Date.parse('2026-11-19T12:00:00Z')
    expect(relativeTime('2026-11-19T11:59:30Z', now)).toBe('just now')
    expect(relativeTime('2026-11-18T12:00:00Z', now)).toBe('yesterday')
    expect(relativeTime('2026-11-05T12:00:00Z', now)).toBe('2 weeks ago')
  })
})
