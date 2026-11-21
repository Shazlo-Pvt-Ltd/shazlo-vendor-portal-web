/**
 * Small, defensive readers shared by the adapters. vendor-api's answers are typed, but a newer API,
 * a proxy or a bug can still send a value the portal does not know; the adapters map it to
 * something safe instead of crashing a screen.
 */
import { GENDERS, matchProductType, PRODUCT_TYPES } from '../../lib/catalog'
import type { Gender, ProductStatus, ProductType } from '../model'
import type { ApiGender } from '../wire'

export function oneOf<T extends string | number>(list: readonly T[], value: unknown): T | undefined {
  return list.find((item) => item === value)
}

export function asArray<T>(value: T[] | null | undefined): T[]
export function asArray(value: unknown): unknown[]
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Trimmed text, or null when there is none. */
export function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text === '' ? null : text
}

export const isoOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

// ---- product type, gender, status ----------------------------------------------------------------

/** vendor-api keeps the product type as free text (`category`); the portal writes it in lower case. */
export function productTypeFromApi(value: unknown): ProductType | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const lower = value.trim().toLowerCase()
  return PRODUCT_TYPES.find((type) => type.toLowerCase() === lower) ?? matchProductType(value)
}

export function productTypeToApi(type: ProductType | null | undefined): string | null {
  return type ? type.toLowerCase() : null
}

const API_GENDERS: Record<ApiGender, Gender> = { women: 'Women', men: 'Men', unisex: 'Unisex' }

export function genderFromApi(value: unknown): Gender | null {
  return typeof value === 'string' && value in API_GENDERS ? API_GENDERS[value as ApiGender] : null
}

export function genderToApi(gender: Gender | null | undefined): ApiGender | null {
  if (!gender || !(GENDERS as readonly string[]).includes(gender)) return null
  return gender.toLowerCase() as ApiGender
}

export const PRODUCT_STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'archived'] as const satisfies readonly ProductStatus[]

/** A status this portal does not know (a newer API) reads as a draft: the server still decides what may happen. */
export function productStatusFromApi(value: unknown): ProductStatus {
  return oneOf(PRODUCT_STATUSES, value) ?? 'draft'
}

// ---- product codes -------------------------------------------------------------------------------

// Crockford's base 32: no I, L, O or U, so a code read aloud or retyped is not mistaken.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * A product code the portal makes until vendor-api makes its own (the proposal makes `sku`
 * optional). Sellers see it as "Code", never "SKU".
 */
export function newProductCode(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return `P-${Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`
}
