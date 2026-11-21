import type { Schemas } from '../api/model'
import { catalogCopy } from '../copy/catalog'
import { isMeasurementOf, isSize, isSizeChartGroup, isValidMeasurement, MEASUREMENTS, sortSizes, type SizeChartGroup } from './catalog'
import { checkCommissionBps } from './commission'
import {
  accountLast4,
  isValidAccountNumber,
  isValidEmail,
  isValidGstin,
  isValidIfsc,
  isValidLink,
  isValidPin,
  isValidUpiId,
  maskUpiId,
  normaliseAccountNumber,
  normaliseGstin,
  normaliseIfsc,
  normalisePhone,
  normalisePin,
  normaliseUpiId,
} from './validators'

// Store details: the sign-up topics a brand keeps up to date after approval (spec §5). The checks
// here run in the screens (on Continue / Save) and in the mock API (422), with the same messages.
// Field keys are dot paths into the body being checked: a section check returns "pickup_address.pin",
// the application check returns "delivery.pickup_address.pin". A rule about a whole group uses the
// group's name ("areas", "pay_on_delivery").

export type FieldErrors = Record<string, string>
export type StoreTopic = Schemas['StoreTopic']
export type StoreSection = 'brand' | 'contact' | 'delivery' | 'returns' | 'payment' | 'payout' | 'business'

// Required topics in page order; a topic is missing until it is saved and passes its check.
export const STORE_TOPICS = ['brand', 'contact', 'delivery', 'returns', 'pay_on_delivery', 'payout'] as const satisfies readonly StoreTopic[]
export const STORE_SECTIONS = ['brand', 'contact', 'delivery', 'returns', 'payment', 'payout', 'business'] as const satisfies readonly StoreSection[]

// The PUT store-details/{section} that saves each topic.
export const SECTION_FOR_TOPIC: Record<StoreTopic, StoreSection> = {
  brand: 'brand',
  contact: 'contact',
  delivery: 'delivery',
  returns: 'returns',
  pay_on_delivery: 'payment',
  payout: 'payout',
}

export const DELIVERY_DAYS = ['1_2', '2_3', '3_5', '5_7'] as const satisfies readonly Schemas['DeliveryDays'][]
export const RETURN_WINDOWS = [0, 7, 14, 30] as const satisfies readonly Schemas['ReturnWindowDays'][]
export const RETURN_CONDITIONS = ['unworn_with_tags', 'any_reason', 'damaged_or_wrong'] as const satisfies readonly Schemas['ReturnCondition'][]
export const REFUND_DAYS = [2, 5, 7] as const satisfies readonly Schemas['RefundDays'][]
export const DELIVERY_MODES = ['shazlo', 'own'] as const satisfies readonly Schemas['Delivery']['mode'][]
export const PAYOUT_METHODS = ['bank', 'upi'] as const satisfies readonly Schemas['PayoutInput']['method'][]
export const MAX_DELIVERY_PLACES = 50
export const STORE_NAME_MAX = 80
export const LEGAL_NAME_MAX = 120

const e = catalogCopy.errors

// The mock reads untrusted JSON, so every check copes with missing or mistyped fields.
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const prefixed = (prefix: string, errors: FieldErrors): FieldErrors =>
  Object.fromEntries(Object.entries(errors).map(([k, v]) => [k === '' ? prefix : `${prefix}.${k}`, v]))

// ---- one check per section --------------------------------------------------------------------

export function checkBrand(body: unknown): FieldErrors {
  const input = obj(body)
  const out: FieldErrors = {}
  if (!['women', 'men', 'both'].includes(input.sells as string)) out.sells = e.brand.sellsRequired
  if (text(input.city).length < 2) out.city = e.brand.cityRequired
  const link = text(input.instagram_or_website)
  if (link && !isValidLink(link)) out.instagram_or_website = e.brand.linkFormat
  return out
}

export function checkContact(body: unknown): FieldErrors {
  const input = obj(body)
  const out: FieldErrors = {}
  if (!text(input.name)) out.name = e.contact.nameRequired
  const phone = text(input.phone)
  if (!phone) out.phone = e.contact.phoneRequired
  else if (!normalisePhone(phone)) out.phone = e.contact.phoneFormat
  const email = text(input.email)
  if (!email) out.email = e.contact.emailRequired
  else if (!isValidEmail(email)) out.email = e.contact.emailFormat
  return out
}

export function checkDelivery(input: unknown): FieldErrors {
  const d = obj(input)
  const out: FieldErrors = {}
  if (d.mode === 'shazlo') {
    const a = obj(d.pickup_address)
    if (!text(a.line1)) out['pickup_address.line1'] = e.delivery.line1Required
    if (!text(a.area)) out['pickup_address.area'] = e.delivery.areaRequired
    if (!text(a.city)) out['pickup_address.city'] = e.delivery.cityRequired
    const pin = text(a.pin)
    if (!pin) out['pickup_address.pin'] = e.delivery.pinRequired
    else if (!isValidPin(pin)) out['pickup_address.pin'] = e.delivery.pinFormat
  } else if (d.mode === 'own') {
    const areas = obj(d.areas)
    const places = Array.isArray(areas.places) ? areas.places.map(text).filter(Boolean) : []
    if (areas.all_india !== true) {
      if (places.length === 0) out.areas = e.delivery.areasRequired
      else if (places.length > MAX_DELIVERY_PLACES) out['areas.places'] = e.delivery.tooManyPlaces
      else {
        // A place written only in digits is meant as a PIN code, so it must be a real one.
        const badPin = places.find((p) => /^\d[\d\s]*$/.test(p) && !isValidPin(p))
        if (badPin) out['areas.places'] = e.delivery.placePin(badPin)
      }
    }
    if (!(DELIVERY_DAYS as readonly unknown[]).includes(d.delivery_days)) out.delivery_days = e.delivery.daysRequired
  } else {
    out.mode = e.delivery.modeRequired
  }
  return out
}

export function checkReturns(input: unknown): FieldErrors {
  const r = obj(input)
  const out: FieldErrors = {}
  if (!(RETURN_WINDOWS as readonly unknown[]).includes(r.window_days)) out.window_days = e.returns.windowRequired
  else if (r.window_days !== 0) {
    if (!(RETURN_CONDITIONS as readonly unknown[]).includes(r.condition)) out.condition = e.returns.conditionRequired
    if (!(REFUND_DAYS as readonly unknown[]).includes(r.refund_days)) out.refund_days = e.returns.refundRequired
  }
  return out
}

export function checkPayOnDelivery(input: unknown): FieldErrors {
  const p = obj(input)
  return p.cash === true || p.upi === true ? {} : { pay_on_delivery: e.payOnDelivery.atLeastOne }
}

// Format only: whether the IFSC belongs to a bank is the server's call (GET /public/ifsc/{code}).
export function checkPayout(input: unknown): FieldErrors {
  const p = obj(input)
  const out: FieldErrors = {}
  if (p.method === 'bank') {
    if (!text(p.holder_name)) out.holder_name = e.payout.holderRequired
    const account = text(p.account_number)
    if (!account) out.account_number = e.payout.accountRequired
    else if (!isValidAccountNumber(account)) out.account_number = e.payout.accountFormat
    const ifsc = text(p.ifsc)
    if (!ifsc) out.ifsc = e.payout.ifscRequired
    else if (!isValidIfsc(ifsc)) out.ifsc = e.payout.ifscFormat
  } else if (p.method === 'upi') {
    const upi = text(p.upi_id)
    if (!upi) out.upi_id = e.payout.upiRequired
    else if (!isValidUpiId(upi)) out.upi_id = e.payout.upiFormat
  } else {
    out.method = e.payout.methodRequired
  }
  return out
}

export function checkBusiness(input: unknown): FieldErrors {
  const b = obj(input)
  const out: FieldErrors = {}
  if (text(b.legal_name).length > LEGAL_NAME_MAX) out.legal_name = e.business.legalNameLong
  const gstin = text(b.gstin)
  if (gstin && !isValidGstin(gstin)) out.gstin = e.business.gstinFormat
  return out
}

// The whole sign-up (V-02), keyed by dot path into the application.
export function checkApplication(input: unknown): FieldErrors {
  const a = obj(input)
  const name = text(a.brand_name)
  const brand: FieldErrors = {}
  if (!name) brand.brand_name = e.brand.storeNameRequired
  else if (name.length > STORE_NAME_MAX) brand.brand_name = e.brand.storeNameLong
  const contact = checkContact({ name: a.owner_name, phone: a.phone, email: a.email })
  const out: FieldErrors = {
    ...brand,
    ...checkBrand(a),
    ...(contact.name ? { owner_name: contact.name } : {}),
    ...(contact.phone ? { phone: contact.phone } : {}),
    ...(contact.email ? { email: contact.email } : {}),
    ...prefixed('delivery', checkDelivery(a.delivery)),
    ...prefixed('returns', checkReturns(a.returns)),
    ...checkPayOnDelivery(a.pay_on_delivery),
    ...prefixed('payout', checkPayout(a.payout)),
    ...checkBusiness({ legal_name: a.legal_name, gstin: a.gstin }),
  }
  if (a.proposed_commission_bps !== undefined && a.proposed_commission_bps !== null) {
    const problem = checkCommissionBps(a.proposed_commission_bps)
    if (problem) out.proposed_commission_bps = problem
  }
  if (a.agreed_terms !== true) out.agreed_terms = e.application.agreeTerms
  if (a.agreed_price_rule !== true) out.agreed_price_rule = e.application.agreePriceRule
  return out
}

// ---- normalising what is saved ----------------------------------------------------------------

// Trimmed and in canonical form (10-digit phone, upper-case IFSC, PIN without spaces…). Run only
// after the matching check passed.
export function normaliseBrand(input: Schemas['StoreBrandInput']): Schemas['StoreBrandInput'] {
  return { sells: input.sells, city: input.city.trim(), instagram_or_website: text(input.instagram_or_website) || null }
}

export function normaliseContact(input: Schemas['Contact']): Schemas['Contact'] {
  return { name: input.name.trim(), phone: normalisePhone(input.phone) ?? input.phone.trim(), email: input.email.trim().toLowerCase() }
}

export function normaliseDelivery(input: Schemas['Delivery']): Schemas['Delivery'] {
  if (input.mode === 'shazlo') {
    const a = input.pickup_address
    return { mode: 'shazlo', pickup_address: { line1: a.line1.trim(), area: a.area.trim(), city: a.city.trim(), pin: normalisePin(a.pin) } }
  }
  const places = input.areas.all_india ? [] : [...new Set(input.areas.places.map((p) => (/^\d[\d\s]*$/.test(p.trim()) ? normalisePin(p) : p.trim())).filter(Boolean))]
  return { mode: 'own', areas: { all_india: input.areas.all_india, places }, delivery_days: input.delivery_days }
}

// No returns means no condition and no refund time, whatever was sent.
export function normaliseReturns(input: Schemas['Returns']): Schemas['Returns'] {
  return input.window_days === 0
    ? { window_days: 0, condition: null, refund_days: null }
    : { window_days: input.window_days, condition: input.condition, refund_days: input.refund_days }
}

export function normalisePayOnDelivery(input: Schemas['PayOnDelivery']): Schemas['PayOnDelivery'] {
  return { cash: input.cash === true, upi: input.upi === true }
}

export function normalisePayout(input: Schemas['PayoutInput']): Schemas['PayoutInput'] {
  return input.method === 'bank'
    ? { method: 'bank', holder_name: input.holder_name.trim(), account_number: normaliseAccountNumber(input.account_number), ifsc: normaliseIfsc(input.ifsc) }
    : { method: 'upi', upi_id: normaliseUpiId(input.upi_id) }
}

export function normaliseBusiness(input: Partial<Schemas['BusinessDetails']>): Schemas['BusinessDetails'] {
  const gstin = text(input.gstin)
  return { legal_name: text(input.legal_name) || null, gstin: gstin ? normaliseGstin(gstin) : null }
}

// What the API returns for a saved payout: never the full account number or UPI ID.
export function maskPayout(input: Schemas['PayoutInput'], bankName: string): Schemas['Payout'] {
  return input.method === 'bank'
    ? { method: 'bank', holder_name: input.holder_name, bank_name: bankName, account_last4: accountLast4(input.account_number), ifsc: normaliseIfsc(input.ifsc) }
    : { method: 'upi', upi_id: maskUpiId(input.upi_id) }
}

// ---- completeness -----------------------------------------------------------------------------

// The topics of StoreDetails (read data or the server's own record): payout may be masked or not.
export type StoreTopicsLike = Pick<Schemas['StoreDetails'], 'sells' | 'city' | 'instagram_or_website' | 'contact' | 'delivery' | 'returns' | 'pay_on_delivery'> & {
  payout: Schemas['Payout'] | Schemas['PayoutInput'] | null
}

// Required topics not yet complete, in page order. Used for StoreDetails.missing, Me.setup and the
// submit check; screens can call it on unsaved answers too.
export function storeDetailsMissing(s: StoreTopicsLike): StoreTopic[] {
  const missing: StoreTopic[] = []
  if (!s.sells || Object.keys(checkBrand({ sells: s.sells, city: s.city ?? '', instagram_or_website: s.instagram_or_website })).length) missing.push('brand')
  if (!s.contact || Object.keys(checkContact(s.contact)).length) missing.push('contact')
  if (!s.delivery || Object.keys(checkDelivery(s.delivery)).length) missing.push('delivery')
  if (!s.returns || Object.keys(checkReturns(s.returns)).length) missing.push('returns')
  if (!s.pay_on_delivery || Object.keys(checkPayOnDelivery(s.pay_on_delivery)).length) missing.push('pay_on_delivery')
  if (!s.payout) missing.push('payout')
  return missing
}

export function isStoreDetailsComplete(s: StoreTopicsLike): boolean {
  return storeDetailsMissing(s).length === 0
}

// ---- size charts ------------------------------------------------------------------------------

// Checks a size chart's measurements for a group: known sizes, the group's measurements, values in
// centimetres. Keys: "measurements.M.bust", or "measurements.M" for an unknown size.
export function checkSizeChart(group: SizeChartGroup, input: unknown): FieldErrors {
  const out: FieldErrors = {}
  if (!isSizeChartGroup(group)) return out
  const body = obj(input)
  const rows = obj(body.measurements)
  for (const [size, row] of Object.entries(rows)) {
    if (!isSize(size)) {
      out[`measurements.${size}`] = e.sizeChart.sizeUnknown(size)
      continue
    }
    for (const [name, value] of Object.entries(obj(row))) {
      if (!isMeasurementOf(group, name)) out[`measurements.${size}.${name}`] = e.sizeChart.measurementUnknown(name)
      else if (value !== null && !isValidMeasurement(value)) out[`measurements.${size}.${name}`] = e.sizeChart.value
    }
  }
  if (body.photo_url !== null && body.photo_url !== undefined && typeof body.photo_url !== 'string') out.photo_url = e.sizeChart.value
  return out
}

// Every saved size gets every measurement of the group (null when blank); wholly blank sizes go.
export function normaliseSizeChart(group: SizeChartGroup, measurements: Schemas['SizeChartMeasurements']): Schemas['SizeChartMeasurements'] {
  const out: Schemas['SizeChartMeasurements'] = {}
  for (const [size, row] of sortSizes(Object.entries(measurements), ([s]) => s)) {
    const full = Object.fromEntries(MEASUREMENTS[group].map((m) => [m, row?.[m] ?? null]))
    if (Object.values(full).some((v) => v !== null)) out[size] = full
  }
  return out
}
