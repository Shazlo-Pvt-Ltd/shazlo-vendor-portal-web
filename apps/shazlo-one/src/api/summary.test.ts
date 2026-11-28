import { describe, expect, it } from 'vitest'
import { FORMER_ADMIN, reviewerIds, toHomeSummary } from './summary'
import type { components } from './vendor-api'

type Wire = components['schemas']['AdminSummaryOut']

const decision = (over: Partial<Wire['recent'][number]> = {}): Wire['recent'][number] => ({
  id: 'r1',
  kind: 'product',
  review_id: 'r1',
  subject_id: 'p1',
  title: 'Block-print kurta',
  vendor_id: 'v1',
  vendor_name: 'Jaipur Prints',
  decision: 'approved',
  at: '2026-11-10T09:30:00Z',
  reviewer_id: 'a1',
  ...over,
})

const wire = (over: Partial<Wire> = {}): Wire => ({
  waiting: { product: 4, brand_page: 1, application: 2, over_24h: 3 },
  decisions: { decided_today: 6, median_minutes: 95 },
  resubmissions: 2,
  commission_proposals: 1,
  publishing: { delivered_24h: 38, waiting: 2, retrying: 1, failed: 0 },
  recent: [decision()],
  ...over,
})

describe('toHomeSummary', () => {
  it('adds up what waits and keeps every figure', () => {
    const summary = toHomeSummary(wire(), new Map())
    expect(summary.queue).toEqual({ all: 7, product: 4, brand_page: 1, application: 2, over_24h: 3 })
    expect(summary.decided_today).toBe(6)
    expect(summary.median_minutes).toBe(95)
    expect(summary.resubmissions).toBe(2)
    expect(summary.commission_proposals).toBe(1)
    expect(summary.publishing).toEqual({ waiting: 2, retrying: 1, failed: 0, delivered_24h: 38 })
  })

  it('has no median when nobody decided anything', () => {
    const summary = toHomeSummary(wire({ decisions: { decided_today: 0, median_minutes: null }, recent: [] }), new Map())
    expect(summary.median_minutes).toBeNull()
    expect(summary.recent).toEqual([])
  })

  it('names the reviewer from the lookup', () => {
    const [d] = toHomeSummary(wire(), new Map([['a1', 'Priya Mehta']])).recent
    expect(d).toMatchObject({ reviewer: 'Priya Mehta', reviewId: 'r1', subjectId: 'p1', vendor: { id: 'v1', name: 'Jaipur Prints' } })
  })

  it('reads "a former admin" for an id nobody answers for, and for no id at all', () => {
    const summary = toHomeSummary(wire({ recent: [decision(), decision({ id: 'r2', reviewer_id: null })] }), new Map())
    expect(summary.recent.map((d) => d.reviewer)).toEqual([FORMER_ADMIN, FORMER_ADMIN])
  })

  it('does not take an empty name for a name', () => {
    const [d] = toHomeSummary(wire(), new Map([['a1', '']])).recent
    expect(d!.reviewer).toBe(FORMER_ADMIN)
  })

  it('carries a missing review id as null', () => {
    const [d] = toHomeSummary(wire({ recent: [decision({ kind: 'application', review_id: null })] }), new Map()).recent
    expect(d!.reviewId).toBeNull()
  })
})

describe('reviewerIds', () => {
  it('lists each admin once and skips decisions without one', () => {
    const recent = [decision({ reviewer_id: 'a1' }), decision({ id: 'r2', reviewer_id: 'a2' }), decision({ id: 'r3', reviewer_id: 'a1' }), decision({ id: 'r4', reviewer_id: null })]
    expect(reviewerIds(wire({ recent }))).toEqual(['a1', 'a2'])
  })

  it('is empty when nothing was decided', () => {
    expect(reviewerIds(wire({ recent: [] }))).toEqual([])
  })
})
