import type { PillStatus } from '@shazlo/ui'
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../api/client'
import { brandReviewPill, reviewPill } from './status'

type Item = Pick<Schemas['ReviewItem'], 'state' | 'kind' | 'publishing'>

describe('reviewPill', () => {
  it.each<[Item, PillStatus]>([
    [{ state: 'waiting', kind: 'new' }, 'pending'],
    [{ state: 'waiting', kind: 'edit' }, 'editInReview'],
    // Publishing only matters once approved.
    [{ state: 'waiting', kind: 'new', publishing: true }, 'pending'],
    [{ state: 'rejected', kind: 'new' }, 'sentBack'],
    [{ state: 'rejected', kind: 'edit' }, 'sentBack'],
    [{ state: 'rejected', kind: 'new', publishing: true }, 'sentBack'],
    [{ state: 'approved', kind: 'new', publishing: true }, 'publishing'],
    [{ state: 'approved', kind: 'edit', publishing: false }, 'live'],
    [{ state: 'approved', kind: 'new' }, 'live'],
  ])('%o is %s', (item, pill) => {
    expect(reviewPill(item)).toBe(pill)
  })
})

// The brand page shows one state on Overview and in its editor (#267).
describe('brandReviewPill', () => {
  it.each<[Schemas['ReviewState']['state'], boolean, PillStatus | null]>([
    ['waiting', true, 'editInReview'],
    ['waiting', false, 'pending'],
    ['rejected', true, 'sentBack'],
    ['rejected', false, 'sentBack'],
    ['approved', true, null],
    ['approved', false, null],
    ['none', true, null],
    ['none', false, null],
  ])('%s with a live page: %s → %s', (state, live, pill) => {
    expect(brandReviewPill(state, live)).toBe(pill)
  })
})
