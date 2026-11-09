import { z } from 'zod'
import type { Schemas } from '../../api/client'
import { brandCopy as copy } from '../../copy/brand'

export type Profile = Schemas['BrandProfile']

export const RETURN_POLICIES = ['no_returns', '7_day', '14_day'] as const satisfies readonly Profile['return_policy'][]
export const DISPATCH_TIMES = ['1_2_days', '2_3_days', '3_5_days', '5_7_days'] as const satisfies readonly Profile['dispatch_time'][]
export const LIMITS = { tagline: 60, story: 600 } as const

// Drafts may be incomplete (the server checks completeness on submit), but what is there must be well formed.
const INSTAGRAM = /^(?:@[A-Za-z0-9._]{1,30})?$/
const WEBSITE = /^(?:(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/\S*)?)?$/i

export const brandSchema = z.object({
  brand_name: z.string(),
  based_in: z.string(),
  tagline: z.string().max(LIMITS.tagline, copy.errors.tagline),
  story: z.string().max(LIMITS.story, copy.errors.story),
  logo_url: z.string().nullable(),
  cover_url: z.string().nullable(),
  return_policy: z.enum(RETURN_POLICIES),
  dispatch_time: z.enum(DISPATCH_TIMES),
  instagram: z.string().regex(INSTAGRAM, copy.errors.instagram),
  website: z.string().regex(WEBSITE, copy.errors.website),
})

export type BrandValues = z.infer<typeof brandSchema>

// The fields a seller can change; brand_name is fixed (support changes it).
export const EDITABLE = ['logo_url', 'cover_url', 'based_in', 'tagline', 'story', 'return_policy', 'dispatch_time', 'instagram', 'website'] as const satisfies readonly (keyof Profile)[]
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

export function emptyProfile(brandName: string): Profile {
  return { brand_name: brandName, based_in: '', tagline: '', story: '', logo_url: null, cover_url: null, return_policy: '7_day', dispatch_time: '2_3_days', instagram: '', website: '' }
}

// Fields whose current value differs from the live page. Nothing is "changed" before a page has gone live.
export function changedFields(values: BrandValues, live: Profile | null): ReadonlySet<EditableField> {
  if (!live) return new Set()
  return new Set(EDITABLE.filter((k) => values[k] !== live[k]))
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
