import type { Schemas } from '../../../api/model'
import { catalogCopy } from '../../../copy/catalog'
import { storeCopy } from '../../../copy/store'
import { checkCommissionBps, parsePercent } from '../../../lib/commission'
import {
  checkApplication,
  checkBrand,
  checkBusiness,
  checkContact,
  checkDelivery,
  checkPayOnDelivery,
  checkPayout,
  checkReturns,
  STORE_SECTIONS,
  type FieldErrors,
  type StoreSection,
} from '../../../lib/storeDetails'
import { isValidAccountNumber, normaliseAccountNumber } from '../../../lib/validators'

// The store-details topics as forms (spec §5). Sign-up (V-02) and Store details (/store/details/:section)
// show the same fields with the same checks: what a seller types is kept as "answers" (strings,
// nothing chosen yet), turned into the API body, and checked with the rules in src/lib/storeDetails.ts.
// Error keys are dot paths into the answers, which match the API body ("pickup_address.pin").

export type Topic = StoreSection

/** Topics vendor-api lets only the owner change (its OWNER_ONLY_SECTIONS): staff get a 403. */
export const OWNER_ONLY_TOPICS: ReadonlySet<Topic> = new Set<Topic>(['payout', 'business'])

export type BrandAnswers = { brand_name: string; sells: Schemas['Sells'] | ''; city: string; instagram_or_website: string }
export type ContactAnswers = { name: string; phone: string; email: string }
export type DeliveryAnswers = {
  mode: Schemas['Delivery']['mode'] | ''
  pickup_address: Schemas['PickupAddress']
  // null until the seller picks All of India or chosen places.
  areas: { all_india: boolean | null; places: string[] }
  // Typed into the place field but not added yet; Continue / Save adds it.
  place: string
  delivery_days: Schemas['DeliveryDays'] | ''
}
export type ReturnsAnswers = {
  window_days: Schemas['ReturnWindowDays'] | null
  condition: Schemas['ReturnCondition'] | null
  refund_days: Schemas['RefundDays'] | null
}
export type PaymentAnswers = Schemas['PayOnDelivery']
export type PayoutAnswers = {
  method: Schemas['PayoutInput']['method'] | ''
  holder_name: string
  account_number: string
  account_number_again: string
  ifsc: string
  upi_id: string
}
export type BusinessAnswers = { legal_name: string; gstin: string }
// Sign-up only: every answer is needed, so whether the business is registered for GST is asked
// (null until answered) and the number only when it is.
export type SignupBusinessAnswers = BusinessAnswers & { gst_registered: boolean | null }
// Sign-up only: how the commission is set (a proposed rate, or agreed with the team), the rate
// when proposed, and the two agreements.
export type CommissionChoice = 'propose' | 'team'
export type TermsAnswers = { commission_choice: CommissionChoice | ''; commission: string; agreed_terms: boolean; agreed_price_rule: boolean }

export type TopicAnswers = {
  brand: BrandAnswers
  contact: ContactAnswers
  delivery: DeliveryAnswers
  returns: ReturnsAnswers
  payment: PaymentAnswers
  payout: PayoutAnswers
  business: BusinessAnswers
}

// Fresh, unanswered forms (new objects each time, so drafts never share arrays).
export const empty = {
  brand: (): BrandAnswers => ({ brand_name: '', sells: '', city: '', instagram_or_website: '' }),
  contact: (): ContactAnswers => ({ name: '', phone: '', email: '' }),
  delivery: (): DeliveryAnswers => ({
    mode: '',
    pickup_address: { line1: '', area: '', city: '', pin: '' },
    areas: { all_india: null, places: [] },
    place: '',
    delivery_days: '',
  }),
  returns: (): ReturnsAnswers => ({ window_days: null, condition: null, refund_days: null }),
  payment: (): PaymentAnswers => ({ cash: false, upi: false }),
  payout: (): PayoutAnswers => ({ method: '', holder_name: '', account_number: '', account_number_again: '', ifsc: '', upi_id: '' }),
  business: (): BusinessAnswers => ({ legal_name: '', gstin: '' }),
  signupBusiness: (): SignupBusinessAnswers => ({ legal_name: '', gstin: '', gst_registered: null }),
  terms: (): TermsAnswers => ({ commission_choice: '', commission: '', agreed_terms: false, agreed_price_rule: false }),
}

// Fields in page order: the error summary lists problems in this order, and focus goes to the first.
export const FIELD_ORDER: Record<Topic | 'terms', readonly string[]> = {
  brand: ['brand_name', 'sells', 'city', 'instagram_or_website'],
  contact: ['name', 'phone', 'email'],
  delivery: ['mode', 'pickup_address.line1', 'pickup_address.area', 'pickup_address.city', 'pickup_address.pin', 'areas', 'areas.places', 'delivery_days'],
  returns: ['window_days', 'condition', 'refund_days'],
  payment: ['pay_on_delivery'],
  payout: ['method', 'holder_name', 'account_number', 'account_number_again', 'ifsc', 'upi_id'],
  business: ['legal_name', 'gstin'],
  terms: ['commission_choice', 'commission', 'agreed_terms', 'agreed_price_rule'],
}
// Sign-up's business step asks about GST before the number.
export const SIGNUP_BUSINESS_ORDER: readonly string[] = ['legal_name', 'gst_registered', 'gstin']

// The id of the input a message belongs to (for a group, its first option), so the error summary
// can link to it. One form is on screen at a time, so the path alone is unique.
export const fieldId = (path: string) => `field-${path.replace(/\./g, '-')}`

// ---- bodies ---------------------------------------------------------------------------------

const trim = (s: string) => s.trim()

// Places typed but not added yet count as added. Commas separate several.
export function placesOf(a: DeliveryAnswers): string[] {
  const typed = a.place.split(',').map(trim).filter(Boolean)
  return [...a.areas.places, ...typed.filter((p) => !a.areas.places.includes(p))]
}

// The body for PUT store-details/{section} (and the matching part of the application). Unanswered
// choices go up as they are, so the check names them; send only bodies that passed checkTopic.
export function brandBody(a: BrandAnswers): Schemas['StoreBrandInput'] {
  return { sells: a.sells as Schemas['Sells'], city: a.city.trim(), instagram_or_website: a.instagram_or_website.trim() || null }
}

export function contactBody(a: ContactAnswers): Schemas['Contact'] {
  return { name: a.name.trim(), phone: a.phone.trim(), email: a.email.trim() }
}

export function deliveryBody(a: DeliveryAnswers): Schemas['Delivery'] {
  if (a.mode === 'shazlo') {
    const p = a.pickup_address
    return { mode: 'shazlo', pickup_address: { line1: p.line1.trim(), area: p.area.trim(), city: p.city.trim(), pin: p.pin.trim() } }
  }
  const allIndia = a.areas.all_india === true
  return {
    mode: a.mode as 'own',
    areas: { all_india: allIndia, places: allIndia || a.areas.all_india === null ? [] : placesOf(a) },
    delivery_days: a.delivery_days as Schemas['DeliveryDays'],
  }
}

export function returnsBody(a: ReturnsAnswers): Schemas['Returns'] {
  return a.window_days === 0
    ? { window_days: 0, condition: null, refund_days: null }
    : { window_days: a.window_days as Schemas['ReturnWindowDays'], condition: a.condition, refund_days: a.refund_days }
}

export function paymentBody(a: PaymentAnswers): Schemas['PayOnDelivery'] {
  return { cash: a.cash, upi: a.upi }
}

export function payoutBody(a: PayoutAnswers): Schemas['PayoutInput'] {
  if (a.method === 'upi') return { method: 'upi', upi_id: a.upi_id.trim() }
  return { method: a.method as 'bank', holder_name: a.holder_name.trim(), account_number: a.account_number.trim(), ifsc: a.ifsc.trim() }
}

export function businessBody(a: BusinessAnswers): Schemas['BusinessDetails'] {
  return { legal_name: a.legal_name.trim() || null, gstin: a.gstin.trim() || null }
}

// A number typed before the seller said "not registered" is not sent.
export function signupBusinessBody(a: SignupBusinessAnswers): Schemas['BusinessDetails'] {
  return businessBody({ legal_name: a.legal_name, gstin: a.gst_registered === true ? a.gstin : '' })
}

// ---- checks ---------------------------------------------------------------------------------

export type CheckContext = {
  // Sign-up asks for the store name; Store details shows it read-only.
  storeName?: boolean
}

const pick = (errors: FieldErrors, keys: readonly string[]): FieldErrors => Object.fromEntries(Object.entries(errors).filter(([k]) => keys.includes(k)))

export function checkBrandAnswers(a: BrandAnswers, ctx: CheckContext = {}): FieldErrors {
  // The store-name rule lives in the application check; ask it about the name alone.
  const name = ctx.storeName ? pick(checkApplication({ brand_name: a.brand_name }), ['brand_name']) : {}
  return { ...name, ...checkBrand(brandBody(a)) }
}

export function checkPayoutAnswers(a: PayoutAnswers): FieldErrors {
  const out = checkPayout(payoutBody(a))
  // Asked twice (no paste block): a slip of one digit sends money to someone else.
  if (a.method === 'bank' && !out.account_number && isValidAccountNumber(a.account_number) && normaliseAccountNumber(a.account_number) !== normaliseAccountNumber(a.account_number_again)) {
    out.account_number_again = storeCopy.payout.accountMismatch
  }
  return out
}

// What the IFSC lookup (useIfsc) says against saving a payout: nothing. vendor-api lists the banks
// most sellers use; a well-formed code of a bank it does not list answers `404 ifsc_unknown` but
// may still take a payout (the saved payout then has no bank name), and the code's format is
// checked by checkPayout before. So the lookup only ever shows the bank's name, and a payout to
// any well-formed IFSC can be saved, as vendor-api allows. Kept for the forms that ask it.
export function unknownIfsc(_lookupError: unknown, _key = 'ifsc'): FieldErrors {
  return {}
}

// The proposed rate as basis points: null when left empty, NaN when it does not read as a percentage.
export function proposedBps(commission: string): number | null {
  if (!commission.trim()) return null
  return parsePercent(commission) ?? Number.NaN
}

// A percentage the seller typed, checked like the API checks basis points.
export function checkPercent(text: string, key: string): FieldErrors {
  const bps = proposedBps(text)
  if (bps === null) return {}
  if (Number.isNaN(bps)) return { [key]: catalogCopy.errors.commission.format }
  const problem = checkCommissionBps(bps)
  return problem ? { [key]: problem } : {}
}

// The rate the seller proposes, in basis points: null when they agree it with the team (a rate typed
// before they changed their answer is not sent), NaN when it does not read as a percentage.
export function proposalOf(a: TermsAnswers): number | null {
  return a.commission_choice === 'propose' ? proposedBps(a.commission) : null
}

export function checkTerms(a: TermsAnswers): FieldErrors {
  const agreements = pick(checkApplication({ agreed_terms: a.agreed_terms, agreed_price_rule: a.agreed_price_rule }), ['agreed_terms', 'agreed_price_rule'])
  const e = catalogCopy.errors.commission
  const commission: FieldErrors =
    a.commission_choice === '' ? { commission_choice: e.choice }
      : a.commission_choice === 'team' ? {}
        : a.commission.trim() ? checkPercent(a.commission, 'commission') : { commission: e.required }
  return { ...commission, ...agreements }
}

// Sign-up's business step: the legal name, whether the business is registered for GST, and the
// number when it is.
export function checkSignupBusiness(a: SignupBusinessAnswers): FieldErrors {
  const e = catalogCopy.errors.business
  const out: FieldErrors = {}
  if (!a.legal_name.trim()) out.legal_name = e.legalNameRequired
  if (a.gst_registered === null) out.gst_registered = e.gstChoice
  else if (a.gst_registered && !a.gstin.trim()) out.gstin = e.gstinRequired
  // Length and format, as Store details checks them.
  return { ...out, ...pick(checkBusiness(signupBusinessBody(a)), ['legal_name', 'gstin']) }
}

export function checkTopic<T extends Topic>(topic: T, answers: TopicAnswers[T], ctx: CheckContext = {}): FieldErrors {
  const a = answers as TopicAnswers[Topic]
  switch (topic) {
    case 'brand': return checkBrandAnswers(a as BrandAnswers, ctx)
    case 'contact': return checkContact(contactBody(a as ContactAnswers))
    case 'delivery': return checkDelivery(deliveryBody(a as DeliveryAnswers))
    case 'returns': return checkReturns(returnsBody(a as ReturnsAnswers))
    case 'payment': return checkPayOnDelivery(paymentBody(a as PaymentAnswers))
    case 'payout': return checkPayoutAnswers(a as PayoutAnswers)
    case 'business': return checkBusiness(businessBody(a as BusinessAnswers))
  }
  return {}
}

// ---- from saved store details -----------------------------------------------------------------

// What a Store details form starts from. Payout numbers come back masked, so the account number
// and UPI ID start empty: changing a payout means typing it in full.
export function answersFrom(details: Schemas['StoreDetails']): TopicAnswers {
  const d = details.delivery
  const delivery = empty.delivery()
  if (d?.mode === 'shazlo') Object.assign(delivery, { mode: 'shazlo', pickup_address: { ...d.pickup_address } })
  if (d?.mode === 'own') Object.assign(delivery, { mode: 'own', areas: { all_india: d.areas.all_india, places: [...d.areas.places] }, delivery_days: d.delivery_days })
  const p = details.payout
  const payout = empty.payout()
  if (p?.method === 'bank') Object.assign(payout, { method: 'bank', holder_name: p.holder_name, ifsc: p.ifsc })
  if (p?.method === 'upi') payout.method = 'upi'
  return {
    brand: { brand_name: details.brand_name, sells: details.sells ?? '', city: details.city ?? '', instagram_or_website: details.instagram_or_website ?? '' },
    contact: details.contact ? { ...details.contact } : empty.contact(),
    delivery,
    returns: details.returns ? { ...details.returns } : empty.returns(),
    payment: details.pay_on_delivery ? { ...details.pay_on_delivery } : empty.payment(),
    payout,
    business: { legal_name: details.business.legal_name ?? '', gstin: details.business.gstin ?? '' },
  }
}

// The body PUT store-details/{section} takes for a topic.
export function sectionBody(topic: Topic, answers: TopicAnswers) {
  switch (topic) {
    case 'brand': return { section: 'brand', body: brandBody(answers.brand) } as const
    case 'contact': return { section: 'contact', body: contactBody(answers.contact) } as const
    case 'delivery': return { section: 'delivery', body: deliveryBody(answers.delivery) } as const
    case 'returns': return { section: 'returns', body: returnsBody(answers.returns) } as const
    case 'payment': return { section: 'payment', body: paymentBody(answers.payment) } as const
    case 'payout': return { section: 'payout', body: payoutBody(answers.payout) } as const
    case 'business': return { section: 'business', body: businessBody(answers.business) } as const
  }
}

// ---- showing errors ---------------------------------------------------------------------------

// Problems in page order; keys the page does not know go last.
export function orderErrors(errors: FieldErrors, order: readonly string[]): [string, string][] {
  const rank = (k: string) => {
    const i = order.indexOf(k)
    return i < 0 ? order.length : i
  }
  return Object.entries(errors).sort(([a], [b]) => rank(a) - rank(b))
}

// A shown message stays until its answer is fixed (spec §8: check on Continue, clear once fixed).
// Messages from our checks are re-run on every change: fixed ones go, the rest follow the answer.
// Messages from the server (a 422) go once the answer they are about changes.
export type ShownErrors = { client: FieldErrors; server: Record<string, { message: string; was: string }> }
export const noErrors: ShownErrors = { client: {}, server: {} }

function valueAt(values: unknown, path: string): unknown {
  let at: unknown = values
  for (const part of path.split('.')) {
    if (at === null || typeof at !== 'object' || !(part in at)) return values
    at = (at as Record<string, unknown>)[part]
  }
  return at
}

const snapshot = (values: unknown, path: string) => JSON.stringify(valueAt(values, path)) ?? ''

export function showErrors(client: FieldErrors, server: FieldErrors = {}, values?: unknown): ShownErrors {
  return {
    client,
    server: Object.fromEntries(Object.entries(server).filter(([k]) => !(k in client)).map(([k, message]) => [k, { message, was: snapshot(values, k) }])),
  }
}

export function settleErrors(shown: ShownErrors, live: FieldErrors, values: unknown): ShownErrors {
  const client = Object.fromEntries(Object.keys(shown.client).filter((k) => live[k]).map((k) => [k, live[k]!]))
  const server = Object.fromEntries(Object.entries(shown.server).filter(([k, s]) => s.was === snapshot(values, k)))
  return { client, server }
}

export function visibleErrors(shown: ShownErrors): FieldErrors {
  return { ...Object.fromEntries(Object.entries(shown.server).map(([k, s]) => [k, s.message])), ...shown.client }
}

export const hasErrors = (errors: FieldErrors) => Object.keys(errors).length > 0

// Page titles of the topics, by the section that saves them.
export const TOPIC_TITLES: Record<Topic, string> = {
  brand: catalogCopy.storeTopics.brand,
  contact: catalogCopy.storeTopics.contact,
  delivery: catalogCopy.storeTopics.delivery,
  returns: catalogCopy.storeTopics.returns,
  payment: catalogCopy.storeTopics.pay_on_delivery,
  payout: catalogCopy.storeTopics.payout,
  business: catalogCopy.businessTopic,
}

export const isTopic = (s: string | undefined): s is Topic => (STORE_SECTIONS as readonly string[]).includes(s ?? '')
