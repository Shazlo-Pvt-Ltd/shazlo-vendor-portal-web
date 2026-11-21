import { z } from 'zod'
import type { Schemas } from '../../api/model'
import { brandCopy as copy } from '../../copy/brand'
import { safeHttpsUrl } from '../../security/safeUrl'

export type Profile = Schemas['BrandProfile']

// Returns and delivery moved to Store details (spec §5). The API still takes these two deprecated
// fields, so the form carries them through unchanged; nothing on the page edits them.
const RETURN_POLICIES = ['no_returns', '7_day', '14_day'] as const satisfies readonly Profile['return_policy'][]
const DISPATCH_TIMES = ['1_2_days', '2_3_days', '3_5_days', '5_7_days'] as const satisfies readonly Profile['dispatch_time'][]
/** Build 2's limits for what shoppers read, and vendor-api's for the rest (PUT /brand-profile). */
export const LIMITS = { tagline: 60, story: 600, basedIn: 120, website: 500 } as const

// Drafts may be incomplete (the server checks completeness on submit), but what is there must be well formed.
const WEBSITE = /^(?:(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/\S*)?)?$/i
const HANDLE = /^[A-Za-z0-9._]{1,30}$/

/**
 * The Instagram handle (without `@`) from what a seller typed: `@kalki.studio`, `kalki.studio`,
 * `instagram.com/kalki.studio/` or `https://www.instagram.com/kalki.studio?igsh=x` (main's
 * features/brand/rules.ts). `''` for an empty box, `undefined` for something that cannot be a handle.
 */
export function normaliseInstagram(input: string): string | undefined {
  let text = input.trim()
  if (text === '') return ''
  const address = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/(.*)$/i.exec(text)
  if (address) text = (address[1] ?? '').split(/[/?#]/)[0] ?? ''
  text = text.replace(/^@/, '')
  return HANDLE.test(text) ? text : undefined
}

/** The address a website is saved as: vendor-api takes only https. */
export function savedWebsite(value: string): string {
  const text = value.trim()
  if (text === '') return ''
  return /^https?:\/\//i.test(text) ? text.replace(/^http:/i, 'https:') : `https://${text}`
}

/** The website as a link, or undefined when it is empty or not a web address. */
export function websiteHref(value: string): string | undefined {
  return value.trim() && WEBSITE.test(value.trim()) ? safeHttpsUrl(savedWebsite(value)) : undefined
}

/** The Instagram profile as a link, or undefined when there is no handle. */
export function instagramHref(value: string): string | undefined {
  const handle = normaliseInstagram(value)
  return handle ? `https://www.instagram.com/${handle}` : undefined
}

export const brandSchema = z.object({
  brand_name: z.string(),
  based_in: z.string().max(LIMITS.basedIn, copy.errors.basedIn),
  tagline: z.string().max(LIMITS.tagline, copy.errors.tagline),
  story: z.string().max(LIMITS.story, copy.errors.story),
  logo_url: z.string().nullable(),
  cover_url: z.string().nullable(),
  return_policy: z.enum(RETURN_POLICIES),
  dispatch_time: z.enum(DISPATCH_TIMES),
  instagram: z.string().refine((v) => normaliseInstagram(v) !== undefined, copy.errors.instagram),
  website: z
    .string()
    .regex(WEBSITE, copy.errors.website)
    .refine((v) => savedWebsite(v).length <= LIMITS.website, copy.errors.websiteLong),
})

export type BrandValues = z.infer<typeof brandSchema>

// The fields a seller can change; brand_name is fixed (support changes it).
export const EDITABLE = ['logo_url', 'cover_url', 'based_in', 'tagline', 'story', 'instagram', 'website'] as const satisfies readonly (keyof Profile)[]
export type EditableField = (typeof EDITABLE)[number]

export const isEditableField = (key: string): key is EditableField => (EDITABLE as readonly string[]).includes(key)

// Fixed key order, so the autosave's JSON comparison does not depend on how the server ordered keys.
export function toValues(p: Profile): BrandValues {
  return {
    brand_name: p.brand_name,
    based_in: p.based_in,
    tagline: p.tagline,
    story: p.story,
    logo_url: p.logo_url,
    cover_url: p.cover_url,
    return_policy: p.return_policy,
    dispatch_time: p.dispatch_time,
    instagram: p.instagram,
    website: p.website,
  }
}

/** The values as they are saved: the Instagram name as `@handle`, however it was typed. Valid values only. */
export function forSaving(values: BrandValues): BrandValues {
  const handle = normaliseInstagram(values.instagram)
  return { ...values, instagram: handle ? `@${handle}` : '' }
}

export function emptyProfile(brandName: string): Profile {
  return { brand_name: brandName, based_in: '', tagline: '', story: '', logo_url: null, cover_url: null, return_policy: '7_day', dispatch_time: '2_3_days', instagram: '', website: '' }
}

const comparable = (key: EditableField, value: string | null) => (key === 'instagram' && value !== null ? (normaliseInstagram(value) ?? value) : value)

// Fields whose current value differs from the live page. Nothing is "changed" before a page has gone live.
export function changedFields(values: BrandValues, live: Profile | null): ReadonlySet<EditableField> {
  if (!live) return new Set()
  return new Set(EDITABLE.filter((k) => comparable(k, values[k]) !== comparable(k, live[k])))
}

// "Ahmedabad, Gujarat" → "Ahmedabad" for the preview's location line.
export const cityOf = (basedIn: string) => basedIn.split(',')[0]?.trim() ?? ''

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
