import { describe, expect, it } from 'vitest'
import type { SubmissionOut } from '../wire'
import { BRAND_PAGE_TITLE, reviewItemFromSubmission, reviewStateToStatus, submissionFromApi } from './reviews'

function submission(overrides: Partial<SubmissionOut> = {}): SubmissionOut {
  return {
    subject: 'product',
    id: 'r-1',
    sku: 'KS-AJR-014',
    title: 'Ajrakh Kurta',
    version: 1,
    status: 'rejected',
    reason: 'Back photo is missing.',
    submitted_at: '2026-11-01T10:00:00Z',
    decided_at: '2026-11-02T10:00:00Z',
    ...overrides,
  }
}

const products = new Map([['KS-AJR-014', { id: 'p-1', thumbnail: 'https://res.cloudinary.com/x/front.jpg' }]])

describe('reviewItemFromSubmission', () => {
  it('turns a product decision into a review item that links to the product', () => {
    expect(reviewItemFromSubmission(submission(), { products, brandThumbnail: null })).toEqual({
      id: 'r-1',
      subject: { type: 'product', id: 'p-1', title: 'Ajrakh Kurta', detail: 'KS-AJR-014', thumbnail_url: 'https://res.cloudinary.com/x/front.jpg' },
      kind: 'new',
      state: 'rejected',
      submitted_at: '2026-11-01T10:00:00Z',
      decided_at: '2026-11-02T10:00:00Z',
      reason: 'Back photo is missing.',
    })
  })

  it('links by the product id the submission names, when vendor-api sends it (proposed)', () => {
    const item = reviewItemFromSubmission({ ...submission(), product_id: 'p-from-api' }, { products, brandThumbnail: null })
    expect(item?.subject).toMatchObject({ id: 'p-from-api' })
    const unknown = reviewItemFromSubmission({ ...submission({ sku: 'GONE-1' }), product_id: 'p-gone' }, { products, brandThumbnail: null })
    expect(unknown?.subject).toMatchObject({ id: 'p-gone', thumbnail_url: null })
  })

  it('calls a later version an edit and a pending one waiting', () => {
    const item = reviewItemFromSubmission(submission({ version: 3, status: 'pending', reason: null, decided_at: null }), { products, brandThumbnail: null })
    expect(item).toMatchObject({ kind: 'edit', state: 'waiting' })
    expect(item).not.toHaveProperty('decided_at')
    expect(item).not.toHaveProperty('reason')
  })

  it('names the brand page', () => {
    const item = reviewItemFromSubmission(submission({ subject: 'brand_profile', sku: null, title: null, status: 'approved', reason: null }), { products, brandThumbnail: 'https://res.cloudinary.com/x/cover.jpg' })
    expect(item?.subject).toEqual({ type: 'brand_page', id: 'brand', title: BRAND_PAGE_TITLE, thumbnail_url: 'https://res.cloudinary.com/x/cover.jpg' })
  })

  it('still shows a product it cannot find, by its code', () => {
    const item = reviewItemFromSubmission(submission({ sku: 'GONE-1', title: null }), { products, brandThumbnail: null })
    expect(item?.subject).toMatchObject({ type: 'product', id: '', title: 'GONE-1', thumbnail_url: null })
  })

  it('leaves out withdrawn submissions and statuses it does not know', () => {
    expect(reviewItemFromSubmission(submission({ status: 'withdrawn' }), { products, brandThumbnail: null })).toBeNull()
    expect(reviewItemFromSubmission(submission({ status: 'escalated' as never }), { products, brandThumbnail: null })).toBeNull()
  })
})

describe('the review filter', () => {
  it('asks vendor-api for its own status words', () => {
    expect(reviewStateToStatus('waiting')).toBe('pending')
    expect(reviewStateToStatus('rejected')).toBe('rejected')
    expect(reviewStateToStatus(undefined)).toBe('all')
  })
})

describe('submissionFromApi', () => {
  it('carries the product id when vendor-api sends it (proposed)', () => {
    expect(submissionFromApi({ ...submission(), product_id: 'p-1' }).productId).toBe('p-1')
  })

  it('is main\'s submission with camel-case names', () => {
    expect(submissionFromApi(submission())).toEqual({
      id: 'r-1',
      subject: 'product',
      code: 'KS-AJR-014',
      productId: null,
      title: 'Ajrakh Kurta',
      version: 1,
      status: 'rejected',
      reason: 'Back photo is missing.',
      submittedAt: '2026-11-01T10:00:00Z',
      decidedAt: '2026-11-02T10:00:00Z',
    })
  })
})
