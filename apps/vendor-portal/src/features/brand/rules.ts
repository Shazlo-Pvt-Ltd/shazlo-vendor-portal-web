import type { components } from '../../api'
import { MAX_PAISE, paiseToRupees, rupeesToPaise } from '../signup/money'

export type BrandDraft = components['schemas']['DraftOut']
export type BrandVersion = components['schemas']['BrandProfileOut']
export type BrandBody = components['schemas']['BrandProfileBody']

/** The limits of `PUT /v1/vendor/brand-profile` (and of the contract with the central app). */
export const LIMITS = { brandName: 120, tagline: 160, about: 4000, website: 500, instagram: 30, categories: 20, category: 80 } as const

/** What the form holds: text as typed, prices in rupees, images by asset id (and their address, for the preview). */
export interface BrandValues {
  brandName: string
  tagline: string
  about: string
  website: string
  /** As typed: `@name`, a name or an Instagram address. {@link normaliseInstagram} gives the handle. */
  instagram: string
  categories: string[]
  priceMin: string
  priceMax: string
  logoAssetId: string | null
  logoUrl: string | null
  bannerAssetId: string | null
  bannerUrl: string | null
}

export type BrandField =
  | 'brandName'
  | 'tagline'
  | 'about'
  | 'logo'
  | 'banner'
  | 'website'
  | 'instagram'
  | 'categories'
  | 'priceMin'
  | 'priceMax'

export type BrandErrors = Partial<Record<BrandField, string>>

/** The order of the fields on the page: focus goes to the first one with a problem. */
export const BRAND_FIELD_ORDER: readonly BrandField[] = [
  'brandName',
  'tagline',
  'about',
  'logo',
  'banner',
  'website',
  'instagram',
  'categories',
  'priceMin',
  'priceMax',
]

export const EMPTY_BRAND: BrandValues = {
  brandName: '',
  tagline: '',
  about: '',
  website: '',
  instagram: '',
  categories: [],
  priceMin: '',
  priceMax: '',
  logoAssetId: null,
  logoUrl: null,
  bannerAssetId: null,
  bannerUrl: null,
}

export { paiseToRupees }

/** The form's starting values for a version from the API. */
export function toValues(version: BrandVersion | BrandDraft): BrandValues {
  return {
    brandName: version.brand_name,
    tagline: version.tagline ?? '',
    about: version.about ?? '',
    website: version.website_url ?? '',
    instagram: version.instagram_handle ?? '',
    categories: [...version.categories],
    priceMin: paiseToRupees(version.price_min_paise),
    priceMax: paiseToRupees(version.price_max_paise),
    logoAssetId: version.logo_asset_id,
    logoUrl: version.logo_url,
    bannerAssetId: version.banner_asset_id,
    bannerUrl: version.banner_url,
  }
}

const HANDLE = /^[A-Za-z0-9._]{1,30}$/

/**
 * The Instagram handle (without `@`) from what a vendor typed: `@atelier.rao`, `atelier.rao`,
 * `instagram.com/atelier.rao/` or `https://www.instagram.com/atelier.rao?igsh=x`. Returns `''` for
 * an empty box and `undefined` when it is not something that can be a handle.
 */
export function normaliseInstagram(input: string): string | undefined {
  let text = input.trim()
  if (text === '') return ''
  const address = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/(.*)$/i.exec(text)
  if (address) {
    text = (address[1] ?? '').split(/[/?#]/)[0] ?? ''
  }
  text = text.replace(/^@/, '')
  return HANDLE.test(text) ? text : undefined
}

const HTTPS_URL = /^https:\/\/[^\s]+$/

/** Trims, and drops duplicates a vendor typed twice (case matters to the API, so it does here). */
function cleanCategories(categories: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of categories) {
    const category = raw.trim()
    if (category !== '' && !seen.has(category)) {
      seen.add(category)
      result.push(category)
    }
  }
  return result
}

/**
 * The problems with the form, by field. A draft can be saved with a few things missing, so
 * `forSubmit` adds what only a submission needs (a category).
 */
export function validateBrand(values: BrandValues, options: { forSubmit?: boolean } = {}): BrandErrors {
  const errors: BrandErrors = {}
  const name = values.brandName.trim()
  if (name === '') errors.brandName = 'Enter your brand name.'
  else if (name.length > LIMITS.brandName) errors.brandName = `Use at most ${LIMITS.brandName} characters.`
  if (values.tagline.trim().length > LIMITS.tagline) errors.tagline = `Use at most ${LIMITS.tagline} characters.`
  if (values.about.trim().length > LIMITS.about) errors.about = `Use at most ${LIMITS.about} characters.`

  const website = values.website.trim()
  if (website !== '' && (!HTTPS_URL.test(website) || website.length > LIMITS.website)) {
    errors.website = 'Use a full address that starts with https://, without spaces.'
  }
  if (normaliseInstagram(values.instagram) === undefined) {
    errors.instagram = 'Use your Instagram name, like @atelier.rao: letters, digits, dots or underscores, up to 30.'
  }

  const categories = cleanCategories(values.categories)
  if (categories.length > LIMITS.categories) errors.categories = `Choose at most ${LIMITS.categories} categories.`
  else if (categories.some((category) => category.length > LIMITS.category)) {
    errors.categories = `Each category can have at most ${LIMITS.category} characters.`
  } else if (options.forSubmit && categories.length === 0) {
    errors.categories = 'Add at least one category before you submit, for example kurtas.'
  }

  const min = rupeesToPaise(values.priceMin)
  const max = rupeesToPaise(values.priceMax)
  const priceHint = `Enter an amount in rupees with up to two decimals, at most ₹${(MAX_PAISE / 100).toLocaleString('en-IN')}.`
  if (min === null) errors.priceMin = values.priceMin.trim() === '' ? 'Enter your lowest price.' : priceHint
  if (max === null) errors.priceMax = values.priceMax.trim() === '' ? 'Enter your highest price.' : priceHint
  if (min !== null && max !== null && max < min) errors.priceMax = 'The highest price cannot be below the lowest.'
  return errors
}

/** The whole draft for `PUT`: the API replaces, so every field is sent. Call only for valid values. */
export function toBody(values: BrandValues): BrandBody {
  const text = (value: string) => (value.trim() === '' ? null : value.trim())
  return {
    brand_name: values.brandName.trim(),
    tagline: text(values.tagline),
    about: text(values.about),
    logo_asset_id: values.logoAssetId,
    banner_asset_id: values.bannerAssetId,
    website_url: text(values.website),
    instagram_handle: normaliseInstagram(values.instagram) || null,
    categories: cleanCategories(values.categories),
    price_min_paise: rupeesToPaise(values.priceMin) ?? 0,
    price_max_paise: rupeesToPaise(values.priceMax) ?? 0,
  }
}

/** Whether two forms would save the same page. Picture addresses are not part of it. */
export function sameContent(a: BrandValues, b: BrandValues): boolean {
  const key = (values: BrandValues) =>
    JSON.stringify([
      values.brandName.trim(),
      values.tagline.trim(),
      values.about.trim(),
      values.website.trim(),
      normaliseInstagram(values.instagram) ?? values.instagram.trim(),
      cleanCategories(values.categories),
      rupeesToPaise(values.priceMin) ?? values.priceMin.trim(),
      rupeesToPaise(values.priceMax) ?? values.priceMax.trim(),
      values.logoAssetId,
      values.bannerAssetId,
    ])
  return key(a) === key(b)
}

const SERVER_FIELD: Record<string, BrandField> = {
  brand_name: 'brandName',
  tagline: 'tagline',
  about: 'about',
  logo_asset_id: 'logo',
  banner_asset_id: 'banner',
  website_url: 'website',
  instagram_handle: 'instagram',
  categories: 'categories',
  price_min_paise: 'priceMin',
  price_max_paise: 'priceMax',
}

/** Puts a `422`'s messages next to their inputs. Anything that is not one of ours is returned as `form`. */
export function serverErrorsToFields(fieldErrors: Record<string, string>, fallback: string): { fields: BrandErrors; form?: string } {
  const fields: BrandErrors = {}
  let form: string | undefined
  for (const [path, message] of Object.entries(fieldErrors)) {
    const field = SERVER_FIELD[path.split('.')[0] ?? '']
    if (field) fields[field] ??= message
    else form ??= message
  }
  if (Object.keys(fields).length === 0 && form === undefined) form = fallback
  return form === undefined ? { fields } : { fields, form }
}
