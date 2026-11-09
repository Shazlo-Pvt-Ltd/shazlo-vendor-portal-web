import { z } from 'zod'
import type { Schemas } from '../../api/client'
import { onboardingCopy } from '../../copy/onboarding'

const e = onboardingCopy.apply.errors

export const ABOUT_MIN = 40
export const ABOUT_MAX = 600
const PRICE_CAP_RUPEES = 1_00_00_000

// ---- phone and price parsing -------------------------------------------------------------

// Indian mobiles: ten digits starting 6–9, typed with or without +91 / 0 and spaces or dashes.
export function normalisePhone(raw: string): string | null {
  let digits = raw.replace(/[\s\-().]/g, '')
  if (digits.startsWith('+91')) digits = digits.slice(3)
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

// Whole rupees, with or without en-IN grouping ("1,25,000") or a ₹ sign.
export function parseRupees(raw: string): number | null {
  const plain = raw.replace(/[₹,\s]/g, '')
  return /^\d+$/.test(plain) ? Number(plain) : null
}

const HANDLE = /^@?(?!.*\.\.)[a-z0-9._]{1,30}$/i
const WEBSITE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i

// ---- one schema per step -----------------------------------------------------------------

export const brandSchema = z.object({
  brand_name: z.string().trim().min(1, e.brandNameRequired).max(80, e.brandNameLong),
  city: z.string().trim().min(2, e.cityRequired),
  instagram_or_website: z
    .string()
    .trim()
    .refine((v) => v === '' || HANDLE.test(v) || WEBSITE.test(v), e.linkFormat),
})

export const contactSchema = z.object({
  owner_name: z.string().trim().min(1, e.ownerNameRequired),
  email: z.string().trim().min(1, e.emailRequired).email(e.emailFormat),
  phone: z
    .string()
    .trim()
    .min(1, e.phoneRequired)
    .refine((v) => normalisePhone(v) !== null, e.phoneFormat),
})

function price(required: string) {
  return z
    .string()
    .trim()
    .min(1, required)
    .refine((v) => {
      const n = parseRupees(v)
      return n !== null && n > 0
    }, e.priceFormat)
    .refine((v) => (parseRupees(v) ?? 0) < PRICE_CAP_RUPEES, e.priceTooHigh)
}

export const catalogueSchema = z
  .object({
    product_types: z.array(z.string()).min(1, e.productTypesRequired),
    price_min: price(e.priceMinRequired),
    price_max: price(e.priceMaxRequired),
    about: z.string().trim().min(ABOUT_MIN, e.aboutShort).max(ABOUT_MAX, e.aboutLong),
  })
  .refine((v) => (parseRupees(v.price_max) ?? 0) >= (parseRupees(v.price_min) ?? 0), { path: ['price_max'], message: e.priceOrder })

export type BrandValues = z.infer<typeof brandSchema>
export type ContactValues = z.infer<typeof contactSchema>
export type CatalogueValues = z.infer<typeof catalogueSchema>

export type StepIndex = 0 | 1 | 2
export const STEP_KEYS = ['brand', 'contact', 'catalogue'] as const
export type StepKey = (typeof STEP_KEYS)[number]

export interface ApplyDraft {
  step: StepIndex
  brand: BrandValues
  contact: ContactValues
  catalogue: CatalogueValues
}

export const emptyDraft: ApplyDraft = {
  step: 0,
  brand: { brand_name: '', city: '', instagram_or_website: '' },
  contact: { owner_name: '', email: '', phone: '' },
  catalogue: { product_types: [], price_min: '', price_max: '', about: '' },
}

const SCHEMAS = [brandSchema, contactSchema, catalogueSchema] as const

// Field messages keyed by form field name (price_min, not price_min_paise).
export type FieldMessages = Record<string, string>

const FIELD_STEP: Record<string, StepIndex> = {
  brand_name: 0,
  city: 0,
  instagram_or_website: 0,
  owner_name: 1,
  email: 1,
  phone: 1,
  product_types: 2,
  price_min: 2,
  price_max: 2,
  about: 2,
}

// The API names prices in paise; the form asks in rupees.
const FROM_API: Record<string, string> = { price_min_paise: 'price_min', price_max_paise: 'price_max' }

export function fieldsFromApi(fields: Record<string, string>): FieldMessages {
  const out: FieldMessages = {}
  for (const [name, message] of Object.entries(fields)) {
    const field = FROM_API[name] ?? name
    if (field in FIELD_STEP) out[field] = message
  }
  return out
}

// The earliest step holding one of these fields, so the seller works forward through them.
export function firstStepWith(fields: FieldMessages): StepIndex | null {
  const steps = Object.keys(fields).map((f) => FIELD_STEP[f]).filter((s): s is StepIndex => s !== undefined)
  return steps.length ? (Math.min(...steps) as StepIndex) : null
}

export function fieldsOfStep(step: StepIndex, fields: FieldMessages): FieldMessages {
  return Object.fromEntries(Object.entries(fields).filter(([f]) => FIELD_STEP[f] === step))
}

// Once a step is passed, its messages are settled; the rest wait for their own step.
export function withoutStep(step: StepIndex, fields: FieldMessages): FieldMessages {
  return Object.fromEntries(Object.entries(fields).filter(([f]) => FIELD_STEP[f] !== step))
}

// Checks every step again before sending (a restored draft may predate a rule change).
export function validateDraft(draft: ApplyDraft): FieldMessages {
  const out: FieldMessages = {}
  STEP_KEYS.forEach((key, i) => {
    const result = SCHEMAS[i]!.safeParse(draft[key])
    if (!result.success) for (const issue of result.error.issues) out[String(issue.path[0])] ??= issue.message
  })
  return out
}

export function toApplication({ brand, contact, catalogue }: ApplyDraft): Schemas['VendorApplication'] {
  const link = brand.instagram_or_website.trim()
  return {
    brand_name: brand.brand_name.trim(),
    city: brand.city.trim(),
    ...(link ? { instagram_or_website: link } : {}),
    owner_name: contact.owner_name.trim(),
    email: contact.email.trim(),
    phone: `+91${normalisePhone(contact.phone) ?? ''}`,
    product_types: onboardingCopy.categories.filter((c) => catalogue.product_types.includes(c)),
    price_min_paise: (parseRupees(catalogue.price_min) ?? 0) * 100,
    price_max_paise: (parseRupees(catalogue.price_max) ?? 0) * 100,
    about: catalogue.about.trim(),
  }
}

// ---- the draft kept on this device ---------------------------------------------------------

export const DRAFT_KEY = 'shazlo.seller.application-draft'

const text = z.string().max(2000).catch('')
const storedDraft = z.object({
  step: z.union([z.literal(0), z.literal(1), z.literal(2)]).catch(0),
  brand: z.object({ brand_name: text, city: text, instagram_or_website: text }).catch(emptyDraft.brand),
  contact: z.object({ owner_name: text, email: text, phone: text }).catch(emptyDraft.contact),
  catalogue: z
    .object({ product_types: z.array(z.string()).catch([]), price_min: text, price_max: text, about: text })
    .catch(emptyDraft.catalogue),
})

export function hasAnswers(draft: ApplyDraft): boolean {
  const { brand, contact, catalogue } = draft
  return [...Object.values(brand), ...Object.values(contact), catalogue.price_min, catalogue.price_max, catalogue.about].some((v) => v.trim() !== '') || catalogue.product_types.length > 0
}

// Storage can be blocked (private mode) or hold something we did not write; both mean no draft.
export function readDraft(): ApplyDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = storedDraft.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    const draft = parsed.data
    const known = new Set<string>(onboardingCopy.categories)
    draft.catalogue.product_types = draft.catalogue.product_types.filter((c) => known.has(c))
    return hasAnswers(draft) ? draft : null
  } catch {
    return null
  }
}

export function writeDraft(draft: ApplyDraft): void {
  try {
    if (hasAnswers(draft)) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Blocked storage: the application still works, it just will not survive a reload.
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // As above.
  }
}
