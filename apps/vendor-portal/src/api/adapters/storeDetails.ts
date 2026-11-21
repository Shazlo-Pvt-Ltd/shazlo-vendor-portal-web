/**
 * Store details (`GET /v1/vendor/store-details`, vendor-api since PR 281). The answer is flat, as
 * Build 2 drew it, but its topics are loosely typed objects, so each is read defensively. Payouts
 * come back masked: the bank (null for a bank vendor-api does not list) and the last four digits,
 * or a masked UPI ID; the number itself never comes back and is never sent again.
 */
import { SELLS } from '../../lib/catalog'
import { DELIVERY_DAYS, REFUND_DAYS, RETURN_CONDITIONS, RETURN_WINDOWS, STORE_TOPICS } from '../../lib/storeDetails'
import { remapFieldErrors } from '../errors'
import type { BusinessDetails, Contact, Delivery, IfscBank, PayOnDelivery, Payout, Returns, StoreDetails, StoreTopic } from '../model'
import type { IfscOut, StoreDetailsOut } from '../wire'
import { asArray, isoOrNull, oneOf, textOrNull } from './common'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)


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
    const [holder, last4, ifsc] = [str(value.holder_name), str(value.account_last4), str(value.ifsc)]
    if (holder === null || last4 === null || ifsc === null) return null
    // A bank vendor-api does not list has no name; the payout is still good.
    return { method: 'bank', holder_name: holder, bank_name: textOrNull(value.bank_name), account_last4: last4, ifsc }
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
  // vendor-api names the missing topics as the screens do; one it may add later is left out.
  const named = new Set(asArray(out.missing).map(String))
  const missing = STORE_TOPICS.filter((topic: StoreTopic) => named.has(topic))
  return {
    brand_name: str(out.brand_name) ?? '',
    sells: oneOf(SELLS, out.sells) ?? null,
    city: str(out.city),
    instagram_or_website: str(out.instagram_or_website),
    contact: contactOf(out.contact),
    delivery: deliveryOf(out.delivery),
    returns: returnsOf(out.returns),
    pay_on_delivery: paymentOf(out.pay_on_delivery),
    payout: payoutOf(out.payout),
    business: businessOf(out.business),
    missing,
    complete: out.complete === true && missing.length === 0,
    updated_at: isoOrNull(out.updated_at),
  }
}

/** The bank behind an IFSC. vendor-api has no branch names yet (`branch` is null). */
export function ifscFromApi(out: IfscOut): IfscBank {
  return { ifsc: str(out.ifsc) ?? '', bank: str(out.bank) ?? '', branch: textOrNull(out.branch) }
}

const UNION_TAGS = new Set(['shazlo', 'own', 'bank', 'upi'])

/**
 * A section's 422 keys, as the section form names its fields. vendor-api's are dot paths into the
 * body ("pickup_address.pin", "pay_on_delivery"), the form's own; a problem with one delivery place
 * ("areas.places.2", like hidden characters in it) goes on the places field. A union tag in front
 * ("shazlo.pickup_address.pin", pydantic's way for a union body) is dropped, should one appear.
 */
export function storeFieldKey(key: string): string {
  const [head, ...rest] = key.split('.')
  const path = head !== undefined && UNION_TAGS.has(head) && rest.length > 0 ? rest.join('.') : key
  return /^areas\.places\.\d+$/.test(path) ? 'areas.places' : path
}

export function storeErrors(error: unknown): unknown {
  return remapFieldErrors(error, storeFieldKey)
}
