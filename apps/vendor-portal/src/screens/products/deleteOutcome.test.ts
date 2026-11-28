import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/model'
import { bulkDeleteText, deleteOutcome, deleteText } from './deleteOutcome'

// Main's delete rules (once features/products/deleteOutcome.ts) on the portal's products: what deleting
// does, which the confirmation must say before it happens.

type Working = Schemas['WorkingVersion']
const working = (version: number, submitted_at: string | null = null, state: Working['state'] = 'editing'): Working => ({ version, state, submitted_at })
const LIVE = {} as Schemas['ProductVersion']

describe('what deleting a product does', () => {
  it('archives anything that was approved or sent back, and blocks one in review', () => {
    expect(deleteOutcome({ status: 'approved' })).toBe('archived')
    expect(deleteOutcome({ status: 'rejected' })).toBe('archived')
    expect(deleteOutcome({ status: 'pending_review' })).toBe('blocked')
  })

  it('blocks a live product whose changes are in review (vendor-api refuses it)', () => {
    expect(deleteOutcome({ status: 'approved', edit_in_review: true })).toBe('blocked')
    expect(deleteOutcome({ status: 'approved', live: LIVE, working: working(2, '2026-11-01', 'in_review') })).toBe('blocked')
  })

  it('removes a draft whose first version was never sent', () => {
    expect(deleteOutcome({ status: 'draft', live: null, working: working(1) })).toBe('removed')
  })

  it('archives a draft that is a sent-back product being reworked (a later version exists)', () => {
    expect(deleteOutcome({ status: 'draft', live: null, working: working(2) })).toBe('archived')
  })

  it('archives a draft that has a live version or was sent', () => {
    expect(deleteOutcome({ status: 'draft', live: LIVE, working: working(2) })).toBe('archived')
    expect(deleteOutcome({ status: 'draft', live: null, working: working(1, '2026-11-01') })).toBe('archived')
  })

  it('does not guess about a draft it has not read in full, and has nothing to do for an archived one', () => {
    expect(deleteOutcome({ status: 'draft' })).toBe('unknown')
    expect(deleteOutcome({ status: 'archived' })).toBe('none')
  })
})

describe('the confirmation words', () => {
  const name = 'Silk kurta'

  it('says "deleted for good" for a removal', () => {
    const text = deleteText(name, 'removed', 'draft')
    expect(text).toMatchObject({ title: 'Delete Silk kurta?', confirm: 'Delete product' })
    expect(text.body).toMatch(/never been sent for review.*deleted for good.*cannot be undone/)
  })

  it('says "archived, not deleted" for an archive, and that a live one leaves the app at once', () => {
    const live = deleteText(name, 'archived', 'approved')
    expect(live).toMatchObject({ title: 'Archive Silk kurta?', confirm: 'Archive product' })
    expect(live.body).toMatch(/archived, not deleted.*leaves the app straight away/)
    expect(deleteText(name, 'archived', 'rejected').body).not.toMatch(/leaves the app/)
  })

  it('never promises a restore vendor-api cannot do, and never says SKU', () => {
    for (const outcome of ['removed', 'archived', 'blocked', 'unknown'] as const) {
      const { title, body } = deleteText(name, outcome, 'draft')
      expect(`${title} ${body}`).not.toMatch(/restore|SKU/i)
    }
  })

  it('explains a product in review cannot be deleted yet', () => {
    const text = deleteText(name, 'blocked', 'pending_review')
    expect(text.body).toMatch(/is in review.*Wait for our decision/)
    expect(text.confirm).toBeNull()
  })

  it('explains both possibilities when it cannot tell', () => {
    expect(deleteText(name, 'unknown', 'draft').body).toMatch(/never been sent for review.*deleted for good.*sent before.*archived/)
  })
})

describe('the words for a selection', () => {
  it('says what happens to each kind of product chosen', () => {
    const text = bulkDeleteText([{ status: 'approved' }, { status: 'rejected' }])
    expect(text.title).toBe('Archive 2 products?')
    expect(text.body).toMatch(/archived, not deleted.*Live ones leave the app straight away/)
    expect(text.body).not.toMatch(/Drafts|in review/)

    const mixed = bulkDeleteText([{ status: 'approved' }, { status: 'draft' }, { status: 'pending_review' }])
    expect(mixed.title).toBe('Archive or delete 3 products?')
    expect(mixed.body).toMatch(/Drafts never sent for review are deleted for good/)
    expect(mixed.body).toMatch(/1 product is in review.*skipped/)
  })
})
