/**
 * The brand page: vendor-api keeps one draft (`GET/PUT /v1/vendor/brand-profile`), the published
 * version (`…/published`, 404 until one is approved) and the reviews (`/v1/vendor/submissions`).
 * Build 2's editor sees `{live, draft, changed_fields, review}` with its own field names.
 */
import { remapFieldErrors } from '../errors'
import type { BrandPage, BrandProfile, ReviewState } from '../model'
import type { BrandProfileBody, BrandProfileOut, DraftOut, SubmissionOut } from '../wire'
import { asArray, isoOrNull, textOrNull } from './common'

/**
 * The fields the editor lets a seller change (its `EDITABLE`), in the editor's order. The brand
 * page has no tagline any more: vendor-api's `tagline` is never read, so an old one neither shows
 * nor counts as a change.
 */
const EDITABLE: readonly (keyof BrandProfile)[] = ['logo_url', 'cover_url', 'based_in', 'story', 'instagram', 'website']

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export function profileFromApi(p: BrandProfileOut | DraftOut): BrandProfile {
  const handle = textOrNull(p.instagram_handle)
  return {
    brand_name: text(p.brand_name),
    based_in: text(p.based_in),
    story: text(p.about),
    logo_url: textOrNull(p.logo_url),
    cover_url: textOrNull(p.banner_url),
    // Returns and delivery live in the store details now; the editor carries these through unseen.
    return_policy: '7_day',
    dispatch_time: '2_3_days',
    instagram: handle ? `@${handle.replace(/^@/, '')}` : '',
    website: text(p.website_url),
  }
}

function reviewOf(draft: DraftOut, latest: SubmissionOut | null): ReviewState {
  if (draft.in_review_version !== null && draft.in_review_version !== undefined) {
    const at = latest?.status === 'pending' ? isoOrNull(latest.submitted_at) : null
    return at ? { state: 'waiting', at } : { state: 'waiting' }
  }
  if (latest?.status === 'rejected') {
    const reason = textOrNull(latest.reason)
    const at = isoOrNull(latest.decided_at)
    return { state: 'rejected', ...(reason ? { reason } : {}), ...(at ? { at } : {}) }
  }
  if (latest?.status === 'approved') {
    const at = isoOrNull(latest.decided_at)
    return at ? { state: 'approved', at } : { state: 'approved' }
  }
  return { state: 'none' }
}

export interface BrandParts {
  draft: DraftOut
  published: BrandProfileOut | null
  /** The newest brand-page submission, if any. */
  latest: SubmissionOut | null
}

export function brandPageFromApi({ draft, published, latest }: BrandParts): BrandPage {
  const live = published ? profileFromApi(published) : null
  const current = profileFromApi(draft)
  const changed = live ? EDITABLE.filter((key) => current[key] !== live[key]) : EDITABLE.filter((key) => Boolean(current[key]))
  return {
    live,
    live_since: published ? isoOrNull(published.published_at) : null,
    draft: current,
    draft_saved_at: isoOrNull(draft.updated_at),
    changed_fields: [...changed],
    review: reviewOf(draft, latest),
  }
}

function imageId(url: string | null, currentUrl: string | null | undefined, currentId: string | null | undefined, resolve: (url: string) => string | null): string | null {
  if (url === null) return null
  if (url === currentUrl) return currentId ?? null
  // A new upload is known by its URL; anything else keeps the image the draft has.
  return resolve(url) ?? currentId ?? null
}

function websiteUrl(value: string): string | null {
  const text = value.trim()
  if (text === '') return null
  return /^https?:\/\//i.test(text) ? text.replace(/^http:/i, 'https:') : `https://${text}`
}

/**
 * The PUT body for the editor's values. A PUT replaces the whole draft, so what the editor does
 * not show (categories, price range, the store name) is copied from the draft as the server has it.
 * Images go by asset id: `resolve` finds the id of an image uploaded in this session.
 * The tagline is the exception: the brand page has none, so every save clears an old one.
 */
export function draftBodyFromProfile(profile: BrandProfile, current: DraftOut, resolve: (url: string) => string | null): BrandProfileBody {
  return {
    brand_name: text(current.brand_name) || profile.brand_name,
    based_in: textOrNull(profile.based_in),
    tagline: null,
    about: textOrNull(profile.story),
    logo_asset_id: imageId(profile.logo_url, current.logo_url, current.logo_asset_id, resolve),
    banner_asset_id: imageId(profile.cover_url, current.banner_url, current.banner_asset_id, resolve),
    website_url: websiteUrl(profile.website),
    instagram_handle: textOrNull(profile.instagram.replace(/^@/, '')),
    categories: asArray(current.categories).filter((c): c is string => typeof c === 'string'),
    ...(Number.isInteger(current.price_min_paise) ? { price_min_paise: current.price_min_paise } : {}),
    ...(Number.isInteger(current.price_max_paise) ? { price_max_paise: current.price_max_paise } : {}),
  }
}

/** The published version as a draft body: what "Discard changes" saves. */
export function publishedAsBody(p: BrandProfileOut): BrandProfileBody {
  return {
    brand_name: p.brand_name,
    based_in: p.based_in ?? null,
    tagline: p.tagline ?? null,
    about: p.about ?? null,
    logo_asset_id: p.logo_asset_id ?? null,
    banner_asset_id: p.banner_asset_id ?? null,
    website_url: p.website_url ?? null,
    instagram_handle: p.instagram_handle ?? null,
    categories: asArray(p.categories),
    price_min_paise: p.price_min_paise,
    price_max_paise: p.price_max_paise,
  }
}

/**
 * What the draft still needs before it goes for review, as the PUT body that gives it, or null when
 * it needs nothing: the `categories` vendor-api asks for (passed when the draft has none), and no
 * tagline. The brand page has no tagline any more and every editor save clears it, but a draft not
 * saved since may still carry an old one, which must not go for review unseen.
 */
export function draftReadyForReview(draft: DraftOut, categories: string[] | null): BrandProfileBody | null {
  const addCategories = categories !== null && categories.length > 0
  const oldTagline = textOrNull(draft.tagline) !== null
  if (!addCategories && !oldTagline) return null
  return { ...publishedAsBody(draft), tagline: null, ...(addCategories ? { categories } : {}) }
}

const FIELD: Record<string, string> = {
  about: 'story',
  instagram_handle: 'instagram',
  website_url: 'website',
  logo_asset_id: 'logo_url',
  banner_asset_id: 'cover_url',
  based_in: 'based_in',
  brand_name: 'brand_name',
}

export function brandErrors(error: unknown): unknown {
  return remapFieldErrors(error, (key) => FIELD[key.split('.')[0] ?? ''] ?? '_form')
}
