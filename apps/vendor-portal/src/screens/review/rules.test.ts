import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/model'
import { clearSensitiveState } from '../../security/sensitiveState'
import { endVisit, previousVisit, resetLastVisit } from './lastVisit'
import { isNewSince, isSuperseded, sinceOf, statusChanges } from './rules'

type Item = Schemas['ReviewItem']

function item(overrides: Partial<Omit<Item, 'subject'>> & { subject?: Partial<Item['subject']> } = {}): Item {
  const { subject, ...rest } = overrides
  return {
    id: 's1',
    subject: { type: 'product', id: 'p1', title: 'Indigo kurta', detail: 'KRT-001', thumbnail_url: null, ...subject },
    kind: 'new',
    state: 'approved',
    submitted_at: '2026-11-10T09:30:00Z',
    decided_at: '2026-11-11T12:00:00Z',
    ...rest,
  }
}

describe('what is new since the last visit (main: features/submissions)', () => {
  it('marks decisions made after the last visit, never one still waiting', () => {
    const since = Date.parse('2026-11-11T00:00:00Z')
    expect(isNewSince(item({ decided_at: '2026-11-11T12:00:00Z' }), since)).toBe(true)
    expect(isNewSince(item({ decided_at: '2026-11-10T12:00:00Z' }), since)).toBe(false)
    expect(isNewSince(item({ decided_at: '2026-11-11T00:00:00Z' }), since)).toBe(false)
    expect(isNewSince(item({ state: 'waiting', decided_at: '2026-11-11T12:00:00Z' }), since)).toBe(false)
    expect(isNewSince(item({ decided_at: 'not a date' }), since)).toBe(false)
    expect(isNewSince(item(), null)).toBe(false)
  })

  it('counts from the last visit in this tab, else from signing in', () => {
    expect(sinceOf(1000, '2026-11-11T00:00:00Z')).toBe(1000)
    expect(sinceOf(null, '2026-11-11T00:00:00Z')).toBe(Date.parse('2026-11-11T00:00:00Z'))
    expect(sinceOf(null, null)).toBeNull()
    expect(sinceOf(null, 'yesterday')).toBeNull()
  })

  it('remembers the visit in memory only, and forgets it when the session ends', () => {
    resetLastVisit()
    expect(previousVisit()).toBeNull()
    endVisit(1234)
    expect(previousVisit()).toBe(1234)
    clearSensitiveState()
    expect(previousVisit()).toBeNull()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})

describe('a rejection already dealt with', () => {
  it('knows a later submission of the same product or brand page replaced it', () => {
    const rejected = item({ state: 'rejected', reason: 'Blurry.' })
    expect(isSuperseded(rejected, [rejected])).toBe(false)
    expect(isSuperseded(rejected, [rejected, item({ id: 's2', state: 'waiting', submitted_at: '2026-11-12T09:00:00Z' })])).toBe(true)
    // An older one, or another product, does not count.
    expect(isSuperseded(rejected, [rejected, item({ id: 's0', submitted_at: '2026-11-01T09:00:00Z' })])).toBe(false)
    expect(isSuperseded(rejected, [rejected, item({ id: 's3', subject: { id: 'p2' }, submitted_at: '2026-11-12T09:00:00Z' })])).toBe(false)
    const page = { type: 'brand_page', id: 'brand', title: 'Brand page' } as const
    const brand = item({ id: 'b1', state: 'rejected', subject: page })
    expect(isSuperseded(brand, [brand, item({ id: 'b2', subject: page, submitted_at: '2026-11-12T09:00:00Z' })])).toBe(true)
  })

  it('never matches products it could not identify', () => {
    const lost = item({ state: 'rejected', subject: { id: '' } })
    expect(isSuperseded(lost, [lost, item({ id: 's2', subject: { id: '' }, submitted_at: '2026-11-12T09:00:00Z' })])).toBe(false)
  })
})

describe('decisions that arrive while the page is open', () => {
  it('describes the statuses that changed, and only those', () => {
    const before = new Map<string, Item['state']>([
      ['s1', 'waiting'],
      ['b1', 'approved'],
    ])
    const brand = item({ id: 'b1', subject: { type: 'brand_page', id: 'brand', title: 'Brand page' } })
    const now = [item({ state: 'rejected' }), brand, item({ id: 'new', subject: { title: 'New kurta' }, state: 'waiting' })]
    expect(statusChanges(before, now)).toEqual(['Indigo kurta: sent back.'])
    expect(statusChanges(before, [item({ state: 'approved' })])).toEqual(['Indigo kurta: approved.'])
    expect(statusChanges(new Map(), now)).toEqual([])
  })
})
