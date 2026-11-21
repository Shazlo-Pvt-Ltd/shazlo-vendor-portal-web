// vendor-api's rules for store details, commission, size charts and the IFSC lookup (PR 281),
// ported so the mock answers what vendor-api answers: the same 422 keys, types and messages, the
// same normal forms, the same masks. Sources: services/vendor-api/vendor_api/services/
// {store_details,commission,size_charts,indian_formats,ifsc_directory}.py and core/validation.py.
// Messages are vendor-api's own text, which the screens show as they come.

import type { Contact, Delivery, PayOnDelivery, PayoutInput, Returns } from '../api/model'
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
} from '../lib/validators'

export type Problems = Record<string, string>
/** One item of a 422's `details`, as FastAPI sends it. */
export interface Detail {
  loc: (string | number)[]
  msg: string
  type: string
}

// ---- text people type (core/validation.py: VisibleText) ----------------------------------------

// Controls, format characters (bidi overrides, zero-width spaces, byte order marks), lone
// surrogates, line and paragraph separators. Zero-width (non-)joiners shape Indic scripts: allowed.
const REFUSED = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u
const ALLOWED_FORMAT = new Set(['‌', '‍'])
// Letters that draw nothing: the Hangul fillers and the blank braille cell.
const BLANK_LOOKING = new Set(['ᅟ', 'ᅠ', 'ㅤ', 'ﾠ', '⠀', ...ALLOWED_FORMAT])

export function hasHiddenCharacters(value: string): boolean {
  for (const char of value) {
    if (ALLOWED_FORMAT.has(char)) continue
    if (REFUSED.test(char)) return true
  }
  return false
}

/** Something is there, but a reader sees nothing. Empty and all-space text are each field's own check. */
export function looksBlank(value: string): boolean {
  if (value === '' || value.trim() === '') return false
  return [...value].every((char) => char.trim() === '' || BLANK_LOOKING.has(char))
}

const HIDDEN: Omit<Detail, 'loc'> = { msg: 'Remove hidden or control characters from this text.', type: 'hidden_characters' }
const BLANK: Omit<Detail, 'loc'> = { msg: 'This looks empty. Type the text itself.', type: 'blank_text' }

// ---- the request models (pydantic): shape, types, unknown fields, length caps ---------------------

type Field = { kind: 'text'; max: number; optional?: boolean } | { kind: 'bool' } | { kind: 'int'; optional?: boolean } | { kind: 'enum'; values: readonly string[] } | { kind: 'object'; fields: Model; optional?: boolean } | { kind: 'list'; max: number; itemMax: number }
type Model = Record<string, Field & { required?: boolean }>

const SHORT = { kind: 'text', max: 400 } as const
const CODE = { kind: 'text', max: 64 } as const

const MODELS: Record<string, Model> = {
  brand: { sells: { kind: 'enum', values: ['women', 'men', 'both'], required: true }, city: { ...SHORT, required: true }, instagram_or_website: { ...SHORT, optional: true } },
  contact: { name: { ...SHORT, required: true }, phone: { ...CODE, required: true }, email: { ...SHORT, required: true } },
  delivery: {
    mode: { kind: 'enum', values: ['shazlo', 'own'], required: true },
    pickup_address: { kind: 'object', optional: true, fields: { line1: { ...SHORT, required: true }, area: { ...SHORT, required: true }, city: { ...SHORT, required: true }, pin: { ...CODE, required: true } } },
    areas: { kind: 'object', optional: true, fields: { all_india: { kind: 'bool', required: true }, places: { kind: 'list', max: 200, itemMax: 200 } } },
    delivery_days: { ...CODE, optional: true },
  },
  returns: { window_days: { kind: 'int', required: true }, condition: { ...CODE, optional: true }, refund_days: { kind: 'int', optional: true } },
  payment: { cash: { kind: 'bool', required: true }, upi: { kind: 'bool', required: true } },
  payout: { method: { kind: 'enum', values: ['bank', 'upi'], required: true }, holder_name: { ...SHORT, optional: true }, account_number: { ...CODE, optional: true }, ifsc: { ...CODE, optional: true }, upi_id: { ...SHORT, optional: true } },
  business: { legal_name: { ...SHORT, optional: true }, gstin: { ...CODE, optional: true } },
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function readModel(model: Model, body: unknown, loc: (string | number)[]): Detail[] {
  if (!isObject(body)) return [{ loc, msg: 'Input should be a valid dictionary or object to extract fields from', type: 'model_attributes_type' }]
  const out: Detail[] = []
  for (const key of Object.keys(body)) if (!(key in model)) out.push({ loc: [...loc, key], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' })
  for (const [key, field] of Object.entries(model)) {
    const value = body[key]
    const at = [...loc, key]
    if (value === undefined) {
      if (field.required) out.push({ loc: at, msg: 'Field required', type: 'missing' })
      continue
    }
    if (value === null && 'optional' in field && field.optional) continue
    out.push(...readField(field, value, at))
  }
  return out
}

function readText(value: unknown, max: number, at: (string | number)[]): Detail[] {
  if (typeof value !== 'string') return [{ loc: at, msg: 'Input should be a valid string', type: 'string_type' }]
  if ([...value].length > max) return [{ loc: at, msg: `String should have at most ${max} characters`, type: 'string_too_long' }]
  if (hasHiddenCharacters(value)) return [{ loc: at, ...HIDDEN }]
  if (looksBlank(value)) return [{ loc: at, ...BLANK }]
  return []
}

function readField(field: Field, value: unknown, at: (string | number)[]): Detail[] {
  switch (field.kind) {
    case 'text':
      return readText(value, field.max, at)
    case 'bool':
      return typeof value === 'boolean' ? [] : [{ loc: at, msg: 'Input should be a valid boolean', type: 'bool_type' }]
    case 'int':
      return Number.isInteger(value) && typeof value === 'number' ? [] : [{ loc: at, msg: 'Input should be a valid integer', type: 'int_type' }]
    case 'enum':
      return field.values.includes(value as string) ? [] : [{ loc: at, msg: `Input should be ${field.values.map((v) => `'${v}'`).join(', ').replace(/, ([^,]*)$/, ' or $1')}`, type: 'literal_error' }]
    case 'object':
      return readModel(field.fields, value, at)
    case 'list': {
      if (!Array.isArray(value)) return [{ loc: at, msg: 'Input should be a valid list', type: 'list_type' }]
      if (value.length > field.max) return [{ loc: at, msg: `List should have at most ${field.max} items after validation, not ${value.length}`, type: 'too_long' }]
      return value.flatMap((item, i) => readText(item, field.itemMax, [...at, i]))
    }
  }
}

/** The pydantic stage of `PUT /v1/vendor/store-details/{section}`: what FastAPI refuses before the rules run. */
export function readSection(section: string, body: unknown): Detail[] {
  const model = MODELS[section]
  return model ? readModel(model, body, ['body']) : []
}

// ---- the rules (services/store_details.py: check_*) ----------------------------------------------

const CITY_MAX = 80
const NAME_MAX = 200
const ADDRESS_LINE_MAX = 200
const PLACE_MAX = 80
const MAX_DELIVERY_PLACES = 50
const LEGAL_NAME_MAX = 120
const LINK_MAX = 300
export const DELIVERY_DAYS = ['1_2', '2_3', '3_5', '5_7'] as const
const RETURN_WINDOWS = [0, 7, 14, 30]
const RETURN_CONDITIONS = ['unworn_with_tags', 'any_reason', 'damaged_or_wrong']
const REFUND_DAYS = [2, 5, 7]

const s = (v: unknown) => (typeof v === 'string' ? v : '')
const blank = (v: unknown) => v === null || v === undefined || s(v).trim() === ''
const isPinLike = (place: string) => /^[0-9][0-9\s]*$/.test(place)

function checkBrand(b: Record<string, unknown>): Problems {
  const out: Problems = {}
  const city = s(b.city).trim()
  if (city.length < 2) out.city = 'Enter the city or area you ship from.'
  else if (city.length > CITY_MAX) out.city = `Keep the city to ${CITY_MAX} characters.`
  const link = s(b.instagram_or_website).trim()
  if (link && (link.length > LINK_MAX || !isValidLink(link))) out.instagram_or_website = 'Enter an Instagram handle like @yourbrand or a website.'
  return out
}

function checkContact(b: Record<string, unknown>): Problems {
  const out: Problems = {}
  if (blank(b.name)) out.name = 'Enter your name.'
  else if (s(b.name).trim().length > NAME_MAX) out.name = `Keep the name to ${NAME_MAX} characters.`
  if (blank(b.phone)) out.phone = 'Enter a mobile number.'
  else if (normalisePhone(s(b.phone)) === null) out.phone = 'Enter a 10-digit Indian mobile number.'
  if (blank(b.email)) out.email = 'Enter an email address.'
  else if (s(b.email).trim().toLowerCase().length > 320 || !isValidEmail(s(b.email).trim().toLowerCase())) out.email = 'Enter an email address like name@example.com.'
  return out
}

function checkDelivery(b: Record<string, unknown>): Problems {
  const out: Problems = {}
  if (b.mode === 'shazlo') {
    if (!isObject(b.pickup_address)) return { pickup_address: 'Enter the pickup address.' }
    const a = b.pickup_address
    for (const [key, label] of [['line1', 'the address'], ['area', 'the area'], ['city', 'the city']] as const) {
      const value = s(a[key]).trim()
      if (!value) out[`pickup_address.${key}`] = `Enter ${label}.`
      else if (value.length > ADDRESS_LINE_MAX) out[`pickup_address.${key}`] = `Keep it to ${ADDRESS_LINE_MAX} characters.`
    }
    if (blank(a.pin)) out['pickup_address.pin'] = 'Enter the PIN code.'
    else if (!isValidPin(s(a.pin))) out['pickup_address.pin'] = 'Enter a 6-digit PIN code.'
    return out
  }
  if (!isObject(b.areas)) out.areas = 'Choose where you deliver.'
  else if (b.areas.all_india !== true) {
    const places = (Array.isArray(b.areas.places) ? b.areas.places : []).map((p) => s(p).trim()).filter(Boolean)
    if (places.length === 0) out.areas = 'Add the cities or PIN codes you deliver to, or choose All of India.'
    else if (places.length > MAX_DELIVERY_PLACES) out['areas.places'] = `Add at most ${MAX_DELIVERY_PLACES} places.`
    else if (places.some((p) => p.length > PLACE_MAX)) out['areas.places'] = `Keep each place to ${PLACE_MAX} characters.`
    else if (places.some((p) => isPinLike(p) && !isValidPin(p))) out['areas.places'] = 'A PIN code has 6 digits and does not start with 0.'
  }
  if (!(DELIVERY_DAYS as readonly unknown[]).includes(b.delivery_days)) out.delivery_days = 'Choose how long delivery takes.'
  return out
}

function checkReturns(b: Record<string, unknown>): Problems {
  if (!RETURN_WINDOWS.includes(b.window_days as number)) return { window_days: 'Choose a return window.' }
  const out: Problems = {}
  if (b.window_days !== 0) {
    if (!RETURN_CONDITIONS.includes(b.condition as string)) out.condition = 'Choose which returns you accept.'
    if (!REFUND_DAYS.includes(b.refund_days as number)) out.refund_days = 'Choose how soon you refund.'
  }
  return out
}

function checkPayment(b: Record<string, unknown>): Problems {
  return b.cash === true || b.upi === true ? {} : { pay_on_delivery: 'Choose at least one way to pay on delivery.' }
}

function checkPayout(b: Record<string, unknown>): Problems {
  const out: Problems = {}
  if (b.method === 'bank') {
    if (blank(b.holder_name)) out.holder_name = "Enter the account holder's name."
    else if (s(b.holder_name).trim().length > NAME_MAX) out.holder_name = `Keep the name to ${NAME_MAX} characters.`
    if (blank(b.account_number)) out.account_number = 'Enter the account number.'
    else if (!isValidAccountNumber(s(b.account_number))) out.account_number = 'An account number has 9 to 18 digits.'
    if (blank(b.ifsc)) out.ifsc = 'Enter the IFSC.'
    else if (!isValidIfsc(s(b.ifsc))) out.ifsc = 'Enter an IFSC like HDFC0001234.'
    if (b.upi_id !== undefined && b.upi_id !== null) out.upi_id = 'Send a UPI ID only with the UPI method.'
  } else {
    if (blank(b.upi_id)) out.upi_id = 'Enter the UPI ID.'
    else if (!isValidUpiId(s(b.upi_id))) out.upi_id = 'Enter a UPI ID like name@okhdfcbank.'
    for (const key of ['holder_name', 'account_number', 'ifsc']) if (b[key] !== undefined && b[key] !== null) out[key] = 'Send bank details only with the bank method.'
  }
  return out
}

function checkBusiness(b: Record<string, unknown>): Problems {
  const out: Problems = {}
  if (s(b.legal_name).trim().length > LEGAL_NAME_MAX) out.legal_name = `Keep the legal name to ${LEGAL_NAME_MAX} characters.`
  const gstin = s(b.gstin).trim()
  if (gstin && !isValidGstin(gstin)) out.gstin = 'Check the GST number: 15 characters, like 27AAPFU0939F1ZV.'
  return out
}

const CHECKS: Record<string, (b: Record<string, unknown>) => Problems> = {
  brand: checkBrand,
  contact: checkContact,
  delivery: checkDelivery,
  returns: checkReturns,
  payment: checkPayment,
  payout: checkPayout,
  business: checkBusiness,
}

/** The rule stage, run once the body has its shape: problems by dot path, vendor-api's words. */
export function checkSection(section: string, body: Record<string, unknown>): Problems {
  return CHECKS[section]?.(body) ?? {}
}

// ---- normal forms ---------------------------------------------------------------------------------

export function normaliseDelivery(b: Record<string, unknown>): Delivery {
  if (b.mode === 'shazlo') {
    const a = b.pickup_address as Record<string, unknown>
    return { mode: 'shazlo', pickup_address: { line1: s(a.line1).trim(), area: s(a.area).trim(), city: s(a.city).trim(), pin: normalisePin(s(a.pin)) } }
  }
  const areas = b.areas as Record<string, unknown>
  const places: string[] = []
  if (areas.all_india !== true) {
    for (const raw of Array.isArray(areas.places) ? areas.places : []) {
      let place = s(raw).trim()
      place = isPinLike(place) ? normalisePin(place) : place
      if (place && !places.includes(place)) places.push(place)
    }
  }
  return { mode: 'own', areas: { all_india: areas.all_india === true, places }, delivery_days: b.delivery_days as (typeof DELIVERY_DAYS)[number] }
}

export function normaliseContact(b: Record<string, unknown>): Contact {
  return { name: s(b.name).trim(), phone: normalisePhone(s(b.phone)) ?? '', email: s(b.email).trim().toLowerCase() }
}

export function normaliseReturns(b: Record<string, unknown>): Returns {
  const window = b.window_days as Returns['window_days']
  return { window_days: window, condition: window ? (b.condition as Returns['condition']) : null, refund_days: window ? (b.refund_days as Returns['refund_days']) : null }
}

export function normalisePayment(b: Record<string, unknown>): PayOnDelivery {
  return { cash: b.cash === true, upi: b.upi === true }
}

/** What the server keeps of a payout: the number in full (vendor-api seals it), never sent back. */
export function normalisePayout(b: Record<string, unknown>): PayoutInput {
  return b.method === 'bank'
    ? { method: 'bank', holder_name: s(b.holder_name).trim(), account_number: normaliseAccountNumber(s(b.account_number)), ifsc: normaliseIfsc(s(b.ifsc)) }
    : { method: 'upi', upi_id: normaliseUpiId(s(b.upi_id)) }
}

export function normaliseBusiness(b: Record<string, unknown>): { legal_name: string | null; gstin: string | null } {
  const gstin = s(b.gstin).trim()
  return { legal_name: s(b.legal_name).trim() || null, gstin: gstin ? normaliseGstin(gstin) : null }
}

/** A payout as vendor-api answers it: the bank (null when unlisted) and the last four digits, or a masked UPI ID. */
export function maskedPayout(p: PayoutInput): Record<string, unknown> {
  return p.method === 'bank'
    ? { method: 'bank', holder_name: p.holder_name, bank_name: lookupIfsc(p.ifsc)?.bank ?? null, account_last4: accountLast4(p.account_number), ifsc: p.ifsc }
    : { method: 'upi', upi_id: maskUpiId(p.upi_id) }
}

// ---- the IFSC directory (services/ifsc_directory.py) -------------------------------------------

export const BANKS: Record<string, string> = {
  SBIN: 'State Bank of India', PUNB: 'Punjab National Bank', BARB: 'Bank of Baroda', CNRB: 'Canara Bank',
  UBIN: 'Union Bank of India', BKID: 'Bank of India', IDIB: 'Indian Bank', CBIN: 'Central Bank of India',
  IOBA: 'Indian Overseas Bank', UCBA: 'UCO Bank', MAHB: 'Bank of Maharashtra', PSIB: 'Punjab & Sind Bank',
  HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', UTIB: 'Axis Bank', KKBK: 'Kotak Mahindra Bank', YESB: 'Yes Bank',
  INDB: 'IndusInd Bank', IDFB: 'IDFC FIRST Bank', IBKL: 'IDBI Bank', FDRL: 'Federal Bank', SIBL: 'South Indian Bank',
  KVBL: 'Karur Vysya Bank', CIUB: 'City Union Bank', TMBL: 'Tamilnad Mercantile Bank', KARB: 'Karnataka Bank',
  RATN: 'RBL Bank', DCBL: 'DCB Bank', DLXB: 'Dhanlaxmi Bank', JAKA: 'Jammu & Kashmir Bank', CSBK: 'CSB Bank',
  BDBL: 'Bandhan Bank', AUBL: 'AU Small Finance Bank', ESFB: 'Equitas Small Finance Bank', UJVN: 'Ujjivan Small Finance Bank',
  AIRP: 'Airtel Payments Bank', PYTM: 'Paytm Payments Bank', IPOS: 'India Post Payments Bank', FINO: 'Fino Payments Bank',
  HSBC: 'HSBC', SCBL: 'Standard Chartered Bank', CITI: 'Citibank', DBSS: 'DBS Bank India', DEUT: 'Deutsche Bank',
}

/** The bank for a well-formed IFSC, null when its bank is not listed; throws for a malformed code. */
export function lookupIfsc(raw: string): { ifsc: string; bank: string; branch: null } | null {
  if (!isValidIfsc(raw)) throw new RangeError('not an IFSC')
  const ifsc = normaliseIfsc(raw)
  const bank = BANKS[ifsc.slice(0, 4)]
  return bank ? { ifsc, bank, branch: null } : null
}

// ---- commission (services/commission.py) --------------------------------------------------------

export const COMMISSION_MAX_BPS = 4000
const NOTE_MIN = 10
const NOTE_MAX = 600

export interface Terms {
  state: 'not_set' | 'proposed' | 'sent_back' | 'agreed'
  agreed_bps: number | null
  proposed_bps: number | null
  note: string | null
}

/** A rule a step broke: 422 on a field, or 409 for a state that does not allow the step. */
export class CommissionRuleError extends Error {
  constructor(readonly status: 422 | 409, readonly code: string, message: string, readonly field: string | null = null) {
    super(message)
  }
}

function checkRate(rate: number, field: string): void {
  if (!Number.isInteger(rate) || rate < 0 || rate > COMMISSION_MAX_BPS) throw new CommissionRuleError(422, 'rate_range', 'Enter a commission between 0% and 40%.', field)
}

function cleanNote(note: string | null | undefined, required: boolean): string | null {
  const text = (note ?? '').trim()
  if (required && text.length < NOTE_MIN) throw new CommissionRuleError(422, 'note_length', `Write at least ${NOTE_MIN} characters so the brand knows what to propose.`, 'note')
  if (text.length > NOTE_MAX) throw new CommissionRuleError(422, 'note_length', `Keep the note to ${NOTE_MAX} characters.`, 'note')
  return text || null
}

export function propose(terms: Terms, rate: number): Terms {
  checkRate(rate, 'rate_bps')
  if (terms.agreed_bps !== null && rate === terms.agreed_bps) throw new CommissionRuleError(422, 'same_as_agreed', 'That is already your agreed rate.', 'rate_bps')
  return { state: 'proposed', agreed_bps: terms.agreed_bps, proposed_bps: rate, note: null }
}

function waiting(terms: Terms): number {
  if (terms.state !== 'proposed' || terms.proposed_bps === null) throw new CommissionRuleError(409, 'no_proposal', 'There is no proposed rate waiting.')
  return terms.proposed_bps
}

/** Shazlo agrees the proposal it saw; a brand that changed it meanwhile gets it reviewed again. */
export function approve(terms: Terms, seen: number): Terms {
  const proposed = waiting(terms)
  if (proposed !== seen) throw new CommissionRuleError(409, 'commission_changed', 'The brand changed its proposal since you looked. Review it again.')
  return { state: 'agreed', agreed_bps: proposed, proposed_bps: null, note: null }
}

export function sendBack(terms: Terms, note: string): Terms {
  waiting(terms)
  return { ...terms, state: 'sent_back', note: cleanNote(note, true) }
}

export function setRate(terms: Terms, rate: number, note: string | null = null): Terms {
  void terms
  checkRate(rate, 'commission_bps')
  return { state: 'agreed', agreed_bps: rate, proposed_bps: null, note: cleanNote(note, false) }
}

// ---- size charts (services/size_charts.py) ------------------------------------------------------

export type ChartGroup = 'bottoms' | 'tops' | 'dresses' | 'jackets'
export const CHART_GROUPS: readonly ChartGroup[] = ['bottoms', 'tops', 'dresses', 'jackets']
export const MEASUREMENTS: Record<ChartGroup, readonly string[]> = {
  bottoms: ['waist', 'hip', 'inseam', 'length'],
  tops: ['chest', 'shoulder', 'sleeve', 'length'],
  dresses: ['bust', 'waist', 'hip', 'length'],
  jackets: ['chest', 'shoulder', 'sleeve', 'length'],
}
const LETTER_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']
const WAIST_SIZES = Array.from({ length: 15 }, (_, i) => String(26 + i))
const ALL_SIZES = [...LETTER_SIZES, 'One size', ...WAIST_SIZES]
const MEASUREMENT_MAX_CM = 300

const sizesFor = (group: ChartGroup) => (group === 'bottoms' ? ALL_SIZES : [...LETTER_SIZES, 'One size'])

function validCm(value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (!(value > 0 && value <= MEASUREMENT_MAX_CM)) return false
  const tenths = value * 10
  return Math.round(tenths) >= 1 && Math.abs(tenths - Math.round(tenths)) < 1e-9
}

export function checkChart(group: ChartGroup, measurements: Record<string, unknown>): Problems {
  const out: Problems = {}
  if (Object.keys(measurements).length > ALL_SIZES.length) return { measurements: `A chart has at most ${ALL_SIZES.length} sizes.` }
  const allowedSizes = sizesFor(group)
  const allowed = MEASUREMENTS[group]
  for (const [size, row] of Object.entries(measurements)) {
    if (!ALL_SIZES.includes(size)) {
      out.measurements = `Use the sizes ${allowedSizes.join(', ')}.`
      continue
    }
    const where = `measurements.${size}`
    if (!allowedSizes.includes(size)) {
      out[where] = 'This size is not used for this kind of product.'
      continue
    }
    if (!isObject(row)) {
      out[where] = 'Give the measurements of this size.'
      continue
    }
    if (Object.keys(row).some((name) => !allowed.includes(name))) {
      out[where] = `Use ${allowed.join(', ')} for this chart.`
      continue
    }
    for (const [name, value] of Object.entries(row)) {
      if (value !== null && !validCm(value)) out[`${where}.${name}`] = `Enter centimetres above 0 and up to ${MEASUREMENT_MAX_CM}, with at most one decimal place.`
    }
  }
  return out
}

/** Every measurement of the group for each size (null when blank); blank sizes dropped; in size order. */
export function normaliseChart(group: ChartGroup, measurements: Record<string, unknown>): Record<string, Record<string, number | null>> {
  const out: Record<string, Record<string, number | null>> = {}
  for (const size of ALL_SIZES.filter((s) => s in measurements)) {
    const row = measurements[size] as Record<string, unknown>
    const full = Object.fromEntries(MEASUREMENTS[group].map((name) => {
      const value = row[name]
      return [name, typeof value === 'number' ? Math.round(value * 10) / 10 : null]
    }))
    if (Object.values(full).some((v) => v !== null)) out[size] = full
  }
  return out
}
