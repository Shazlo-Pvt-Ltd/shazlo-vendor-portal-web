import { describe, expect, it } from 'vitest'
import { confirmText, deleteOutcome } from './deleteOutcome'
import { detail, product, revision } from './testing'

describe('what deleting a product does', () => {
  it('archives anything that was approved or rejected, and blocks one in review', () => {
    expect(deleteOutcome({ status: 'approved' })).toBe('archived')
    expect(deleteOutcome({ status: 'rejected' })).toBe('archived')
    expect(deleteOutcome({ status: 'pending_review' })).toBe('blocked')
  })

  it('removes a draft whose first version was never submitted', () => {
    expect(deleteOutcome({ status: 'draft' }, detail('p', { working: revision(1, null) }))).toBe('removed')
  })

  it('archives a draft that is a rejected product being reworked (a later version exists)', () => {
    expect(deleteOutcome({ status: 'draft' }, detail('p', { working: revision(2, null) }))).toBe('archived')
  })

  it('archives a draft that has a live version or a submitted one', () => {
    expect(deleteOutcome({ status: 'draft' }, detail('p', { live: revision(1, '2026-11-01'), working: revision(2, null) }))).toBe('archived')
    expect(deleteOutcome({ status: 'draft' }, detail('p', { working: revision(1, '2026-11-01') }))).toBe('archived')
  })

  it('does not guess about a draft it cannot look into, or a status it does not know', () => {
    expect(deleteOutcome({ status: 'draft' })).toBe('unknown')
    expect(deleteOutcome({ status: 'archived' })).toBe('unknown')
    expect(deleteOutcome({ status: 'something_new' })).toBe('unknown')
  })
})

describe('the confirmation words', () => {
  const p = product(1, { title: 'Silk kurta', sku: 'K-1' })

  it('says "deleted for good" for a removal, and names the product', () => {
    const text = confirmText(p, 'removed')
    expect(text.title).toBe('Delete this product for good?')
    expect(text.message).toContain('"Silk kurta" (K-1)')
    expect(text.message).toMatch(/never been sent for review.*deleted and cannot be brought back/)
    expect(text.confirmLabel).toBe('Delete product')
  })

  it('says "archived, not deleted" for an archive, and that a live one goes off sale', () => {
    const live = confirmText({ ...p, status: 'approved' }, 'archived')
    expect(live.title).toBe('Archive this product?')
    expect(live.message).toMatch(/archived, not deleted.*off sale straight away.*SKU stays reserved/)
    const rejected = confirmText({ ...p, status: 'rejected' }, 'archived')
    expect(rejected.message).toMatch(/archived, not deleted/)
    expect(rejected.message).not.toMatch(/off sale/)
  })

  it('explains both possibilities when it cannot tell', () => {
    const text = confirmText({ ...p, status: 'draft' }, 'unknown')
    expect(text.message).toMatch(/never been sent for review it will be deleted for good.*has been sent before, it will be archived/)
  })

  it('explains a product in review cannot be deleted yet', () => {
    expect(confirmText({ ...p, status: 'pending_review' }, 'blocked').message).toMatch(/is in review.*Wait for the decision/)
  })
})
