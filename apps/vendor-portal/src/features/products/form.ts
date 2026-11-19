import type { components } from '../../api'
import { MAX_PAISE, paiseToRupees, rupeesToPaise } from '../signup/money'
import type { ProductDetail } from './status'

export type Revision = NonNullable<ProductDetail['live']>
export type ProductBody = components['schemas']['ProductContentBody']
export type CreateBody = components['schemas']['CreateProductBody']
export type Gender = components['schemas']['Gender']

/** The limits of `ProductContentBody` (and of the contract with the central app, ADR 0003). */
export const LIMITS = {
  title: 200,
  description: 4000,
  category: 100,
  subcategory: 100,
  fabric: 80,
  sku: 64,
  size: 32,
  color: 32,
  altText: 200,
  variants: 100,
  images: 10,
  maxWeightGrams: 1_000_000,
  maxReturnDays: 30,
} as const

export const GENDERS: readonly { value: Gender; label: string }[] = [
  { value: 'women', label: 'Women' },
  { value: 'men', label: 'Men' },
  { value: 'unisex', label: 'Unisex' },
]

/** vendor-api's `SKU_PATTERN`: letters, digits, dots, underscores, dashes, slashes or spaces, starting with a letter or digit. */
const SKU = /^[A-Za-z0-9][A-Za-z0-9._/ -]*$/

export interface VariantValues {
  /** A key for React and for field ids; never sent. */
  key: string
  sku: string
  size: string
  color: string
  /** Rupees as typed. */
  price: string
  /** Rupees as typed; empty means the same as the price. */
  mrp: string
  isActive: boolean
  /**
   * The variant already exists on the server. Its SKU, size and colour are its identity there
   * (`422 variant_identity_changed`), so the form does not let them change.
   */
  saved: boolean
}

export interface ImageValues {
  assetId: string
  url: string
  alt: string
}

/** What the form holds: text as typed, prices in rupees, images in their display order (the first is the cover). */
export interface ProductValues {
  /** The product's own SKU. Set when it is created and fixed afterwards. */
  sku: string
  title: string
  description: string
  category: string
  subcategory: string
  gender: Gender | ''
  fabric: string
  weight: string
  returnable: boolean
  returnDays: string
  variants: VariantValues[]
  images: ImageValues[]
}

export type ProductField =
  | 'sku'
  | 'title'
  | 'description'
  | 'category'
  | 'subcategory'
  | 'gender'
  | 'fabric'
  | 'weight'
  | 'returnDays'
  | 'variants'
  | 'images'

export type VariantField = 'sku' | 'size' | 'color' | 'price' | 'mrp'

export interface ProductErrors {
  fields: Partial<Record<ProductField, string>>
  /** By the variant's `key`. */
  variants: Record<string, Partial<Record<VariantField | 'row', string>>>
  /** By the image's asset id. */
  images: Record<string, string>
}

export const NO_ERRORS: ProductErrors = { fields: {}, variants: {}, images: {} }

export function hasErrors(errors: ProductErrors): boolean {
  return (
    Object.values(errors.fields).some(Boolean) ||
    Object.values(errors.variants).some((row) => Object.values(row).some(Boolean)) ||
    Object.values(errors.images).some(Boolean)
  )
}

/** The order of the fields on the page, so focus can go to the first problem. */
export const FIELD_ORDER: readonly ProductField[] = [
  'sku',
  'title',
  'description',
  'category',
  'subcategory',
  'gender',
  'fabric',
  'weight',
  'returnDays',
  'variants',
  'images',
]
export const VARIANT_FIELD_ORDER: readonly VariantField[] = ['sku', 'size', 'color', 'price', 'mrp']

let nextKey = 0
export const newKey = () => `v${++nextKey}`

export function emptyVariant(): VariantValues {
  return { key: newKey(), sku: '', size: '', color: '', price: '', mrp: '', isActive: true, saved: false }
}

export const EMPTY_PRODUCT: ProductValues = {
  sku: '',
  title: '',
  description: '',
  category: '',
  subcategory: '',
  gender: '',
  fabric: '',
  weight: '',
  returnable: false,
  returnDays: '',
  variants: [],
  images: [],
}

export function newProductValues(): ProductValues {
  return { ...EMPTY_PRODUCT, variants: [emptyVariant()], images: [] }
}

const isGender = (value: string): value is Gender => GENDERS.some((g) => g.value === value)

/** The form's values for a revision from the API. */
export function toValues(sku: string, revision: Revision): ProductValues {
  return {
    sku,
    title: revision.title,
    description: revision.description ?? '',
    category: revision.category,
    subcategory: revision.subcategory ?? '',
    gender: isGender(revision.gender) ? revision.gender : '',
    fabric: revision.fabric ?? '',
    weight: revision.weight_grams === null ? '' : String(revision.weight_grams),
    returnable: revision.returnable,
    returnDays: revision.return_window_days === null ? '' : String(revision.return_window_days),
    variants: revision.variants.map((variant) => ({
      key: newKey(),
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      price: paiseToRupees(variant.price_paise),
      mrp: paiseToRupees(variant.mrp_paise),
      isActive: variant.is_active,
      saved: true,
    })),
    images: [...revision.images]
      .sort((a, b) => a.position - b.position)
      .map((image) => ({ assetId: image.asset_id, url: image.url, alt: image.alt_text ?? '' })),
  }
}

const WHOLE = /^\d+$/

function wholeNumber(text: string): number | null {
  const trimmed = text.trim()
  return WHOLE.test(trimmed) ? Number(trimmed) : null
}

/** A variant's MRP in paise: the price when left empty. */
function mrpPaise(variant: VariantValues): number | null {
  return variant.mrp.trim() === '' ? rupeesToPaise(variant.price) : rupeesToPaise(variant.mrp)
}

const priceHint = `Enter an amount in rupees with up to two decimals, at most ₹${(MAX_PAISE / 100).toLocaleString('en-IN')}.`

/**
 * The problems with the form. A draft can be saved without variants or images, so `forSubmit`
 * adds what only a submission needs (an active variant and an image, the API's `product_incomplete`).
 */
export function validateProduct(values: ProductValues, options: { forSubmit?: boolean; creating?: boolean } = {}): ProductErrors {
  const fields: ProductErrors['fields'] = {}
  const variants: ProductErrors['variants'] = {}
  const images: ProductErrors['images'] = {}

  if (options.creating) {
    const sku = values.sku.trim()
    if (sku === '') fields.sku = 'Enter a SKU for the product, for example KURTA-001.'
    else if (sku.length > LIMITS.sku || !SKU.test(sku)) fields.sku = skuHint
  }
  const title = values.title.trim()
  if (title === '') fields.title = 'Enter a title.'
  else if (title.length > LIMITS.title) fields.title = `Use at most ${LIMITS.title} characters.`
  if (values.description.trim().length > LIMITS.description) fields.description = `Use at most ${LIMITS.description} characters.`
  const category = values.category.trim()
  if (category === '') fields.category = 'Enter a category, for example kurtas.'
  else if (category.length > LIMITS.category) fields.category = `Use at most ${LIMITS.category} characters.`
  if (values.subcategory.trim().length > LIMITS.subcategory) fields.subcategory = `Use at most ${LIMITS.subcategory} characters.`
  if (values.gender === '') fields.gender = 'Choose who the product is for.'
  if (values.fabric.trim().length > LIMITS.fabric) fields.fabric = `Use at most ${LIMITS.fabric} characters.`
  if (values.weight.trim() !== '') {
    const grams = wholeNumber(values.weight)
    if (grams === null || grams < 1 || grams > LIMITS.maxWeightGrams) {
      fields.weight = `Enter the weight in whole grams, from 1 to ${LIMITS.maxWeightGrams.toLocaleString('en-IN')}.`
    }
  }
  if (values.returnable) {
    const days = wholeNumber(values.returnDays)
    if (values.returnDays.trim() === '') fields.returnDays = 'Enter how many days shoppers have to return it.'
    else if (days === null || days > LIMITS.maxReturnDays) fields.returnDays = `Enter a whole number of days, from 0 to ${LIMITS.maxReturnDays}.`
  }

  // Variants: each one's own rules, then the ones across the product.
  if (values.variants.length > LIMITS.variants) fields.variants = `A product can have at most ${LIMITS.variants} variants.`
  const skuSeen = new Map<string, string>()
  const lookSeen = new Map<string, string>()
  for (const variant of values.variants) {
    const problems: ProductErrors['variants'][string] = {}
    const sku = variant.sku.trim()
    if (sku === '') problems.sku = 'Enter a SKU.'
    else if (sku.length > LIMITS.sku || !SKU.test(sku)) problems.sku = skuHint
    else {
      const key = sku.toLowerCase()
      if (skuSeen.has(key)) problems.sku = 'Another variant of this product has this SKU (letter case does not count).'
      else skuSeen.set(key, variant.key)
    }
    if (variant.size.trim().length > LIMITS.size) problems.size = `Use at most ${LIMITS.size} characters.`
    if (variant.color.trim().length > LIMITS.color) problems.color = `Use at most ${LIMITS.color} characters.`
    const look = `${variant.size.trim().toLowerCase()}\u0000${variant.color.trim().toLowerCase()}`
    if (lookSeen.has(look)) problems.row = 'Another variant has the same size and colour. Change one of them.'
    else lookSeen.set(look, variant.key)

    const price = rupeesToPaise(variant.price)
    if (price === null) problems.price = variant.price.trim() === '' ? 'Enter the price.' : priceHint
    else if (price === 0) problems.price = 'The price must be more than ₹0.'
    if (variant.mrp.trim() !== '') {
      const mrp = rupeesToPaise(variant.mrp)
      if (mrp === null) problems.mrp = priceHint
      else if (price !== null && mrp < price) problems.mrp = 'The MRP cannot be below the price.'
    }
    if (Object.keys(problems).length > 0) variants[variant.key] = problems
  }

  if (values.images.length > LIMITS.images) fields.images = `A product can have at most ${LIMITS.images} images. Remove ${values.images.length - LIMITS.images}.`
  for (const image of values.images) {
    if (image.alt.trim().length > LIMITS.altText) images[image.assetId] = `Use at most ${LIMITS.altText} characters.`
  }

  if (options.forSubmit) {
    const missing = missingForSubmit(values)
    if (missing.variant && !fields.variants) fields.variants = 'Add at least one active variant before you submit.'
    if (missing.image && !fields.images) fields.images = 'Add at least one image before you submit.'
  }
  return { fields, variants, images }
}

const skuHint = `Use letters, digits, dots, dashes, underscores, slashes or spaces, starting with a letter or digit; at most ${LIMITS.sku} characters.`

/** What a submission still needs (the API's `422 product_incomplete`). */
export function missingForSubmit(values: ProductValues): { variant: boolean; image: boolean } {
  return { variant: !values.variants.some((variant) => variant.isActive), image: values.images.length === 0 }
}

/** The words for {@link missingForSubmit}: "an active variant and an image". */
export function describeMissing(missing: { variant: boolean; image: boolean }): string {
  const parts = [missing.variant ? 'an active variant' : '', missing.image ? 'an image' : ''].filter(Boolean)
  return parts.join(' and ')
}

/** The whole revision for `PUT` (the API replaces it). Call only for valid values. */
export function toBody(values: ProductValues): ProductBody {
  const text = (value: string) => (value.trim() === '' ? null : value.trim())
  return {
    title: values.title.trim(),
    description: text(values.description),
    category: values.category.trim(),
    subcategory: text(values.subcategory),
    gender: values.gender as Gender,
    fabric: text(values.fabric),
    weight_grams: values.weight.trim() === '' ? null : Number(values.weight.trim()),
    returnable: values.returnable,
    // A window means nothing for a product that cannot be returned; the API clears it too.
    return_window_days: values.returnable ? Number(values.returnDays.trim()) : null,
    variants: values.variants.map((variant) => ({
      sku: variant.sku.trim(),
      size: variant.size.trim(),
      color: variant.color.trim(),
      price_paise: rupeesToPaise(variant.price) ?? 0,
      mrp_paise: mrpPaise(variant) ?? 0,
      is_active: variant.isActive,
    })),
    images: values.images.map((image) => ({ asset_id: image.assetId, alt_text: text(image.alt) })),
  }
}

/** `POST /v1/vendor/products`: the content and the product's SKU. */
export function toCreateBody(values: ProductValues): CreateBody {
  return { ...toBody(values), sku: values.sku.trim() }
}

/** Whether two forms would save the same revision. */
export function sameContent(a: ProductValues, b: ProductValues): boolean {
  const key = (values: ProductValues) => {
    const body = toBody(values)
    // Keep what the vendor typed where it is not a valid amount, so a half-typed price still counts as a change.
    return JSON.stringify([
      values.sku.trim(),
      body,
      values.variants.map((v) => [v.price.trim(), v.mrp.trim()]),
      values.weight.trim(),
      values.returnable ? values.returnDays.trim() : '',
    ])
  }
  return key(a) === key(b)
}

/** Moves the item at `from` to `to`, returning a new array. Out-of-range moves return the array unchanged. */
export function move<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items]
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item as T)
  return next
}

const SERVER_FIELD: Record<string, ProductField> = {
  sku: 'sku',
  title: 'title',
  description: 'description',
  category: 'category',
  subcategory: 'subcategory',
  gender: 'gender',
  fabric: 'fabric',
  weight_grams: 'weight',
  return_window_days: 'returnDays',
  returnable: 'returnDays',
  variants: 'variants',
  images: 'images',
}

const SERVER_VARIANT_FIELD: Record<string, VariantField> = {
  sku: 'sku',
  size: 'size',
  color: 'color',
  price_paise: 'price',
  mrp_paise: 'mrp',
}

/**
 * Puts a `422`'s messages next to their inputs: `title`, `variants.2.price_paise`,
 * `images.0.alt_text`. A check across fields (the API's model rules) has no field and comes back as `form`.
 */
export function serverErrorsToFields(
  fieldErrors: Record<string, string>,
  values: ProductValues,
  fallback: string,
): { errors: ProductErrors; form?: string } {
  const errors: ProductErrors = { fields: {}, variants: {}, images: {} }
  let form: string | undefined
  for (const [path, message] of Object.entries(fieldErrors)) {
    const [head = '', index, sub] = path.split('.')
    const position = index === undefined ? NaN : Number(index)
    if (head === 'variants' && Number.isInteger(position)) {
      const variant = values.variants[position]
      if (variant) {
        const row = (errors.variants[variant.key] ??= {})
        // A variant's own model check (MRP below price) has no field of its own: it belongs to the MRP.
        const field = sub === undefined ? (message.includes('mrp_paise') ? 'mrp' : 'row') : (SERVER_VARIANT_FIELD[sub] ?? 'row')
        row[field] ??= friendlyServerMessage(message)
        continue
      }
    }
    if (head === 'images' && Number.isInteger(position)) {
      const image = values.images[position]
      if (image) {
        errors.images[image.assetId] ??= message
        continue
      }
    }
    const field = SERVER_FIELD[head]
    if (field) errors.fields[field] ??= message
    else form ??= friendlyServerMessage(message)
  }
  if (!hasErrors(errors) && form === undefined) form = fallback
  return form === undefined ? { errors } : { errors, form }
}

/** The API's model checks are worded with field names; say them in the form's words. */
function friendlyServerMessage(message: string): string {
  if (message.includes('mrp_paise must not be below price_paise')) return 'The MRP cannot be below the price.'
  if (message.includes('return_window_days is required')) return 'Enter how many days shoppers have to return it.'
  return message
}

/** "₹1,499" or "₹1,499.50". */
const wholeRupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const withPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })
export function formatPaise(paise: number): string {
  return paise % 100 === 0 ? wholeRupees.format(paise / 100) : withPaise.format(paise / 100)
}
