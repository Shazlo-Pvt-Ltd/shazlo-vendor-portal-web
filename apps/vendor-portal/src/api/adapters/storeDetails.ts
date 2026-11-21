/**
 * Store details: vendor-api (proposed) answers in sections (`brand`, `contact`, `delivery`,
 * `returns`, `payment`, `payout`, `business`); Build 2's screens read one flat object where the
 * payment section is "pay on delivery". Section bodies are the same shapes both ways.
 */
import { SELLS } from '../../lib/catalog'
import { DELIVERY_DAYS, REFUND_DAYS, RETURN_CONDITIONS, RETURN_WINDOWS, STORE_TOPICS } from '../../lib/storeDetails'
import { remapFieldErrors } from '../errors'
import type { BusinessDetails, Contact, Delivery, PayOnDelivery, Payout, Returns, StoreDetails, StoreTopic } from '../model'
import type { StoreDetailsOut } from '../wire'
import { asArray, isoOrNull, oneOf } from './common'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const TOPIC_FOR_SECTION: Record<string, StoreTopic> = {
  brand: 'brand',
  contact: 'contact',
  delivery: 'delivery',
  returns: 'returns',
  payment: 'pay_on_delivery',
  payout: 'payout',
}

function contactOf(value: unknown): Contact | null {
  if (!isObject(value)) return null
  const name = str(value.name)
  const phone = str(value.phone)
  const email = str(value.email)
  return name !== null && phone !== null && email !== null ? { name, phone, email } : null
}

function deliveryOf(value: unknown): Delivery | null {
  if (!isObject(value)) return null
  if (value.mode === 'shazlo' && isObject(value.pickup_address)) {
    const a = value.pickup_address
    const [line1, area, city, pin] = [str(a.line1), str(a.area), str(a.city), str(a.pin)]
    if (line1 === null || area === null || city === null || pin === null) return null
    return { mode: 'shazlo', pickup_address: { line1, area, city, pin } }
  }
  if (value.mode === 'own' && isObject(value.areas)) {
    const days = oneOf(DELIVERY_DAYS, value.delivery_days)
    if (!days) return null
    const places = asArray(value.areas.places).filter((p): p is string => typeof p === 'string')
    return { mode: 'own', areas: { all_india: value.areas.all_india === true, places }, delivery_days: days }
  }
  return null
}

function returnsOf(value: unknown): Returns | null {
  if (!isObject(value)) return null
  const window = oneOf(RETURN_WINDOWS, value.window_days)
  if (window === undefined) return null
  return {
    window_days: window,
    condition: oneOf(RETURN_CONDITIONS, value.condition) ?? null,
    refund_days: oneOf(REFUND_DAYS, value.refund_days) ?? null,
  }
}

function paymentOf(value: unknown): PayOnDelivery | null {
  if (!isObject(value)) return null
  return { cash: value.cash === true, upi: value.upi === true }
}

function payoutOf(value: unknown): Payout | null {
  if (!isObject(value)) return null
  if (value.method === 'bank') {
    const [holder, bank, last4, ifsc] = [str(value.holder_name), str(value.bank_name), str(value.account_last4), str(value.ifsc)]
    if (holder === null || bank === null || last4 === null || ifsc === null) return null
    return { method: 'bank', holder_name: holder, bank_name: bank, account_last4: last4, ifsc }
  }
  if (value.method === 'upi') {
    const upi = str(value.upi_id)
    return upi === null ? null : { method: 'upi', upi_id: upi }
  }
  return null
}

function businessOf(value: unknown): BusinessDetails {
  if (!isObject(value)) return { legal_name: null, gstin: null }
  return { legal_name: str(value.legal_name), gstin: str(value.gstin) }
}

export function storeDetailsFromApi(out: StoreDetailsOut): StoreDetails {
  const brand: Record<string, unknown> = isObject(out.brand) ? out.brand : {}
  const missingTopics = new Set(asArray(out.missing).map((section) => TOPIC_FOR_SECTION[String(section)]).filter((t): t is StoreTopic => t !== undefined))
  const missing = STORE_TOPICS.filter((topic) => missingTopics.has(topic))
  return {
    brand_name: str(brand.brand_name) ?? '',
    sells: oneOf(SELLS, brand.sells) ?? null,
    city: str(brand.city),
    instagram_or_website: str(brand.instagram_or_website),
    contact: contactOf(out.contact),
    delivery: deliveryOf(out.delivery),
    returns: returnsOf(out.returns),
    pay_on_delivery: paymentOf(out.payment),
    payout: payoutOf(out.payout),
    business: businessOf(out.business),
    missing,
    complete: out.complete === true && missing.length === 0,
    updated_at: isoOrNull(out.updated_at),
  }
}

const UNION_TAGS = new Set(['shazlo', 'own', 'bank', 'upi'])

/**
 * A section's 422 keys, as the section form names its fields ("pickup_address.pin"). Pydantic puts
 * the union member's tag first for a delivery or payout body ("shazlo.pickup_address.pin").
 */
export function storeFieldKey(key: string): string {
  const [head, ...rest] = key.split('.')
  return head !== undefined && UNION_TAGS.has(head) && rest.length > 0 ? rest.join('.') : key
}

export function storeErrors(error: unknown): unknown {
  return remapFieldErrors(error, storeFieldKey)
}
