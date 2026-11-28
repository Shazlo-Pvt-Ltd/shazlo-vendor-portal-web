import { describe, expect, it } from 'vitest'
import { ApiError } from '../errors'
import type { BrandProfileOut, DraftOut, SubmissionOut } from '../wire'
import { brandErrors, brandPageFromApi, draftBodyFromProfile, draftReadyForReview, profileFromApi, publishedAsBody } from './brand'

const published: BrandProfileOut = {
  id: 'b-1',
  version: 1,
  state: 'published',
  brand_name: 'Kalki Studio',
  based_in: 'Ahmedabad, Gujarat',
  tagline: 'Hand block-printed.',
  about: 'We work with Ajrakh printers.',
  logo_asset_id: null,
  logo_url: null,
  banner_asset_id: 'asset-cover-1',
  banner_url: 'https://res.cloudinary.com/demo/cover-1.jpg',
  website_url: 'https://kalkistudio.in',
  instagram_handle: 'kalki.studio',
  categories: ['kurtas'],
  price_min_paise: 0,
  price_max_paise: 0,
  submitted_at: '2026-10-01T10:00:00Z',
  published_at: '2026-10-02T10:00:00Z',
  review: { status: 'approved', reason: null, reason_code: null, decided_at: '2026-10-02T10:00:00Z', submitted_at: '2026-10-01T10:00:00Z' },
  updated_at: '2026-10-02T10:00:00Z',
}

const draft: DraftOut = {
  ...published,
  id: 'b-2',
  version: 2,
  state: 'draft',
  about: 'We work with Ajrakh printers. Small batches.',
  banner_asset_id: 'asset-cover-2',
  banner_url: 'https://res.cloudinary.com/demo/cover-2.jpg',
  submitted_at: null,
  published_at: null,
  review: null,
  updated_at: '2026-11-20T09:20:00Z',
  in_review_version: null,
}

function submission(overrides: Partial<SubmissionOut>): SubmissionOut {
  return { subject: 'brand_profile', id: 'r-1', sku: null, title: null, version: 1, status: 'approved', reason: null, reason_code: null, submitted_at: '2026-10-01T10:00:00Z', decided_at: '2026-10-02T10:00:00Z', ...overrides }
}

describe('profileFromApi', () => {
  it('reads vendor-api\'s names as the brand editor\'s', () => {
    expect(profileFromApi(published)).toEqual({
      brand_name: 'Kalki Studio',
      based_in: 'Ahmedabad, Gujarat',
      story: 'We work with Ajrakh printers.',
      logo_url: null,
      cover_url: 'https://res.cloudinary.com/demo/cover-1.jpg',
      return_policy: '7_day',
      dispatch_time: '2_3_days',
      instagram: '@kalki.studio',
      website: 'https://kalkistudio.in',
    })
  })

  it('shows blanks as empty text', () => {
    expect(profileFromApi({ ...published, tagline: null, about: null, based_in: null, instagram_handle: null, website_url: null })).toMatchObject({ story: '', based_in: '', instagram: '', website: '' })
  })

  it('leaves out a tagline vendor-api still has: the brand page has none', () => {
    expect(profileFromApi(published)).not.toHaveProperty('tagline')
    expect(profileFromApi(draft)).not.toHaveProperty('tagline')
  })
})

describe('brandPageFromApi', () => {
  it('has the live page, the draft and what changed', () => {
    const page = brandPageFromApi({ draft, published, latest: submission({}) })
    expect(page.live?.story).toBe('We work with Ajrakh printers.')
    expect(page.draft?.story).toBe('We work with Ajrakh printers. Small batches.')
    expect(page.live_since).toBe('2026-10-02T10:00:00Z')
    expect(page.draft_saved_at).toBe('2026-11-20T09:20:00Z')
    expect(page.changed_fields).toEqual(['cover_url', 'story'])
    expect(page.review).toEqual({ state: 'approved', at: '2026-10-02T10:00:00Z' })
  })

  it('is waiting while a version is in review', () => {
    const page = brandPageFromApi({ draft: { ...draft, in_review_version: 2 }, published, latest: submission({ status: 'pending', version: 2, submitted_at: '2026-11-20T10:00:00Z', decided_at: null }) })
    expect(page.review).toEqual({ state: 'waiting', at: '2026-11-20T10:00:00Z' })
  })

  it('carries the reason of a sent-back version', () => {
    const page = brandPageFromApi({ draft, published: null, latest: submission({ status: 'rejected', reason: 'The cover is blurry.', decided_at: '2026-11-10T10:00:00Z' }) })
    expect(page.live).toBeNull()
    expect(page.review).toEqual({ state: 'rejected', reason: 'The cover is blurry.', at: '2026-11-10T10:00:00Z' })
  })

  it('never counts an old tagline as a change', () => {
    const page = brandPageFromApi({ draft: { ...draft, tagline: 'A different tagline.' }, published, latest: null })
    expect(page.changed_fields).toEqual(['cover_url', 'story'])
    // Nor once the editor has cleared it from the draft.
    expect(brandPageFromApi({ draft: { ...draft, tagline: null }, published, latest: null }).changed_fields).toEqual(['cover_url', 'story'])
    // A first page whose only content is a tagline has nothing of the seller's to show.
    const first = { ...draft, about: null, based_in: null, banner_asset_id: null, banner_url: null, website_url: null, instagram_handle: null }
    expect(brandPageFromApi({ draft: first, published: null, latest: null }).changed_fields).toEqual([])
  })

  it('has no review before anything is sent', () => {
    const page = brandPageFromApi({ draft, published: null, latest: null })
    expect(page.review).toEqual({ state: 'none' })
    expect(page.live_since).toBeNull()
  })
})

describe('draftBodyFromProfile', () => {
  const resolve = (url: string) => (url === 'https://res.cloudinary.com/demo/new-logo.jpg' ? 'asset-logo-new' : null)

  it('writes the editor\'s fields with vendor-api\'s names and keeps what the editor does not show', () => {
    const body = draftBodyFromProfile(
      { ...profileFromApi(draft), logo_url: 'https://res.cloudinary.com/demo/new-logo.jpg', instagram: '@kalki.new', website: 'kalkistudio.in' },
      draft,
      resolve,
    )
    expect(body).toEqual({
      brand_name: 'Kalki Studio',
      based_in: 'Ahmedabad, Gujarat',
      tagline: null,
      about: 'We work with Ajrakh printers. Small batches.',
      logo_asset_id: 'asset-logo-new',
      banner_asset_id: 'asset-cover-2',
      website_url: 'https://kalkistudio.in',
      instagram_handle: 'kalki.new',
      categories: ['kurtas'],
      price_min_paise: 0,
      price_max_paise: 0,
    })
  })

  it('clears the old tagline the draft had: the brand page has none', () => {
    expect(draft.tagline).toBe('Hand block-printed.')
    const body = draftBodyFromProfile(profileFromApi(draft), draft, resolve)
    expect(body).toHaveProperty('tagline', null)
  })

  it('clears an image the seller removed', () => {
    expect(draftBodyFromProfile({ ...profileFromApi(draft), cover_url: null }, draft, resolve).banner_asset_id).toBeNull()
  })

  it('keeps an image it cannot match to an upload rather than dropping it', () => {
    expect(draftBodyFromProfile({ ...profileFromApi(draft), cover_url: 'https://elsewhere.example/x.jpg' }, draft, resolve).banner_asset_id).toBe('asset-cover-2')
  })

  it('turns the published version back into a draft (discarding changes)', () => {
    // As it is, tagline and all: the draft then matches the live page. Sending it for review clears the tagline.
    expect(publishedAsBody(published)).toMatchObject({ about: 'We work with Ajrakh printers.', banner_asset_id: 'asset-cover-1', instagram_handle: 'kalki.studio', tagline: 'Hand block-printed.' })
  })
})

describe('draftReadyForReview', () => {
  it('needs nothing for a draft with categories and no tagline', () => {
    expect(draftReadyForReview({ ...draft, tagline: null }, null)).toBeNull()
    expect(draftReadyForReview({ ...draft, tagline: '  ' }, null)).toBeNull()
  })

  it('clears an old tagline and keeps the rest of the draft', () => {
    expect(draftReadyForReview(draft, null)).toEqual({ ...publishedAsBody(draft), tagline: null })
  })

  it("adds the categories from the store details, and clears the tagline in the same PUT", () => {
    expect(draftReadyForReview({ ...draft, tagline: null, categories: [] }, ['women', 'men'])).toMatchObject({ categories: ['women', 'men'], tagline: null })
    expect(draftReadyForReview({ ...draft, categories: [] }, ['women'])).toMatchObject({ categories: ['women'], tagline: null, about: 'We work with Ajrakh printers. Small batches.' })
  })
})

describe('brandErrors', () => {
  it('names vendor-api\'s fields as the editor does', () => {
    const error = new ApiError({ status: 422, code: 'validation_error', message: 'x', fieldErrors: { about: 'Too long', instagram_handle: 'Bad', website_url: 'Use https', banner_asset_id: 'Not yours' } })
    expect((brandErrors(error) as ApiError).fields).toEqual({ story: 'Too long', instagram: 'Bad', website: 'Use https', cover_url: 'Not yours' })
  })

  it('has no field for a tagline problem: it is about the whole page', () => {
    const error = new ApiError({ status: 422, code: 'validation_error', message: 'x', fieldErrors: { tagline: 'Too long' } })
    expect((brandErrors(error) as ApiError).fields).toEqual({ _form: 'Too long' })
  })
})
