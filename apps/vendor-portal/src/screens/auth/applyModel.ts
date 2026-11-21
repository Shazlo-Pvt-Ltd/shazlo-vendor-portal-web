import { ApiError } from '../../api/errors'
import type { Schemas } from '../../api/model'
import { checkNewPassword } from '../../lib/account'
import {
  normaliseBusiness,
  normaliseContact,
  normaliseDelivery,
  normalisePayOnDelivery,
  normalisePayout,
  normaliseReturns,
  type FieldErrors,
} from '../../lib/storeDetails'
import { saveDraft, takeDraft } from '../../session/drafts'
import {
  businessBody,
  checkTerms,
  checkTopic,
  contactBody,
  deliveryBody,
  empty,
  FIELD_ORDER,
  hasErrors,
  paymentBody,
  payoutBody,
  placesOf,
  proposedBps,
  returnsBody,
  type BrandAnswers,
  type BusinessAnswers,
  type ContactAnswers,
  type DeliveryAnswers,
  type PaymentAnswers,
  type PayoutAnswers,
  type ReturnsAnswers,
  type TermsAnswers,
  type Topic,
} from '../store/topics/model'

// Sign-up (V-02, spec §5): an intro, seven topic pages, Check your answers, then Send. The topic
// forms and their checks are the ones Store details uses (src/screens/store/topics); this module
// adds the page order, the password, the draft kept in memory and the application the API takes.

// Pages: 0 is the intro, 1–7 the topics, 8 Check your answers.
export const INTRO = 0
export const CHECK = 8
export const STEP_COUNT = 7
// The topic each step page shows; step 7 adds the commission and agreements.
export const STEP_TOPICS: readonly Topic[] = ['brand', 'contact', 'delivery', 'returns', 'payment', 'payout', 'business']

export interface ApplyDraft {
  page: number
  // Came from Check your answers: Continue goes back there.
  checking: boolean
  brand: BrandAnswers
  contact: ContactAnswers
  // Asked on the Contact step (main's rules); sent as typed, never kept in the draft.
  password: string
  delivery: DeliveryAnswers
  returns: ReturnsAnswers
  payment: PaymentAnswers
  payout: PayoutAnswers
  business: BusinessAnswers
  terms: TermsAnswers
}

export function emptyDraft(): ApplyDraft {
  return {
    page: INTRO,
    checking: false,
    brand: empty.brand(),
    contact: empty.contact(),
    password: '',
    delivery: empty.delivery(),
    returns: empty.returns(),
    payment: empty.payment(),
    payout: empty.payout(),
    business: empty.business(),
    terms: empty.terms(),
  }
}

export const isStep = (page: number) => page >= 1 && page <= STEP_COUNT

// The answers a step page edits (what error messages are about).
export function valuesOfStep(step: number, d: ApplyDraft): unknown {
  if (step === 2) return { ...d.contact, password: d.password }
  return step === 7 ? { ...d.business, ...d.terms } : d[STEP_TOPICS[step - 1]!]
}

// Fields of a step in page order, for the error summary.
export function orderOfStep(step: number): readonly string[] {
  if (step === 2) return [...FIELD_ORDER.contact, 'password']
  if (step === 7) return [...FIELD_ORDER.business, ...FIELD_ORDER.terms]
  const topic = STEP_TOPICS[step - 1]
  return topic ? FIELD_ORDER[topic] : []
}

// What Continue checks on a step, keyed by field.
export function checkStep(step: number, d: ApplyDraft): FieldErrors {
  switch (step) {
    case 1: return checkTopic('brand', d.brand, { storeName: true })
    case 2: return { ...checkTopic('contact', d.contact), ...passwordProblem(d.password, d.contact.email) }
    case 3: return checkTopic('delivery', d.delivery)
    case 4: return checkTopic('returns', d.returns)
    case 5: return checkTopic('payment', d.payment)
    case 6: return checkTopic('payout', d.payout)
    case 7: return { ...checkTopic('business', d.business), ...checkTerms(d.terms) }
  }
  return {}
}

// The password may not be the email (vendor-api's rule), so it is checked against what was typed there.
function passwordProblem(password: string, email: string): FieldErrors {
  const problem = checkNewPassword(password, email)
  return problem ? { password: problem } : {}
}

// Before sending, every step again: a restored draft may have skipped one, and the password and
// account numbers are never kept. The first step with problems, or null.
export function firstProblem(d: ApplyDraft): { step: number; errors: FieldErrors } | null {
  for (let step = 1; step <= STEP_COUNT; step++) {
    const errors = checkStep(step, d)
    if (hasErrors(errors)) return { step, errors }
  }
  return null
}

// Places typed on the delivery page but not added become chips once the page is done.
export function settleDelivery(a: DeliveryAnswers): DeliveryAnswers {
  return a.areas.all_india === false ? { ...a, areas: { ...a.areas, places: placesOf(a) }, place: '' } : { ...a, place: '' }
}

// The application as POST /public/vendor-applications takes it, trimmed and in canonical form.
// Only for a draft that passed every step.
export function toApplication(d: ApplyDraft): Schemas['VendorApplication'] {
  const contact = normaliseContact(contactBody(d.contact))
  const business = normaliseBusiness(businessBody(d.business))
  const bps = proposedBps(d.terms.commission)
  const link = d.brand.instagram_or_website.trim()
  return {
    brand_name: d.brand.brand_name.trim(),
    sells: d.brand.sells as Schemas['Sells'],
    city: d.brand.city.trim(),
    ...(link ? { instagram_or_website: link } : {}),
    owner_name: contact.name,
    phone: contact.phone,
    email: contact.email,
    // As typed: spaces count.
    password: d.password,
    delivery: normaliseDelivery(deliveryBody(d.delivery)),
    returns: normaliseReturns(returnsBody(d.returns)),
    pay_on_delivery: normalisePayOnDelivery(paymentBody(d.payment)),
    payout: normalisePayout(payoutBody(d.payout)),
    ...(business.legal_name ? { legal_name: business.legal_name } : {}),
    ...(business.gstin ? { gstin: business.gstin } : {}),
    ...(bps !== null && !Number.isNaN(bps) ? { proposed_commission_bps: bps } : {}),
    agreed_terms: true,
    agreed_price_rule: true,
  }
}

// ---- messages from the server (422) ------------------------------------------------------------

const PREFIXED: [prefix: string, step: number][] = [['delivery.', 3], ['returns.', 4], ['payout.', 6]]
// One message for the two checkboxes of step 5.
const WHOLE: [prefix: string, step: number, key: string][] = [['pay_on_delivery.', 5, 'pay_on_delivery']]
const PLAIN: Record<string, [step: number, key: string]> = {
  brand_name: [1, 'brand_name'],
  sells: [1, 'sells'],
  city: [1, 'city'],
  instagram_or_website: [1, 'instagram_or_website'],
  owner_name: [2, 'name'],
  phone: [2, 'phone'],
  email: [2, 'email'],
  password: [2, 'password'],
  delivery: [3, 'mode'],
  returns: [4, 'window_days'],
  pay_on_delivery: [5, 'pay_on_delivery'],
  payout: [6, 'method'],
  legal_name: [7, 'legal_name'],
  gstin: [7, 'gstin'],
  proposed_commission_bps: [7, 'commission'],
  agreed_terms: [7, 'agreed_terms'],
  agreed_price_rule: [7, 'agreed_price_rule'],
}

// The API names fields by their place in the application ("delivery.pickup_address.pin",
// "owner_name"); the pages by their place in the step ("pickup_address.pin", "name").
export function errorsByStep(fields: Record<string, string>): Map<number, FieldErrors> {
  const out = new Map<number, FieldErrors>()
  const put = (step: number, key: string, message: string) => out.set(step, { ...out.get(step), [key]: message })
  for (const [field, message] of Object.entries(fields)) {
    const plain = PLAIN[field]
    if (plain) {
      put(plain[0], plain[1], message)
      continue
    }
    const whole = WHOLE.find(([prefix]) => field.startsWith(prefix))
    if (whole) {
      if (!out.get(whole[1])?.[whole[2]]) put(whole[1], whole[2], message)
      continue
    }
    const prefixed = PREFIXED.find(([prefix]) => field.startsWith(prefix))
    if (prefixed) put(prefixed[1], field.slice(prefixed[0].length), message)
  }
  return out
}

// Refusals vendor-api sends as a code (422 without field details), and the field each is about.
const BY_CODE: Record<string, [step: number, key: string]> = {
  weak_password: [2, 'password'],
  terms_not_accepted: [7, 'agreed_terms'],
  price_rule_not_accepted: [7, 'agreed_price_rule'],
}

/** A 422 from the sign-up, as messages for each step's fields. Empty when it names nothing the steps show. */
export function problemsByStep(error: unknown): Map<number, FieldErrors> {
  if (!(error instanceof ApiError) || error.status !== 422) return new Map()
  const steps = errorsByStep(error.fields)
  const coded = BY_CODE[error.code]
  if (coded && !steps.get(coded[0])?.[coded[1]]) steps.set(coded[0], { ...steps.get(coded[0]), [coded[1]]: error.message })
  return steps
}

// ---- the draft kept in memory ------------------------------------------------------------------

/** The key of the sign-up draft in session/drafts.ts. */
export const APPLY_DRAFT_KEY = 'signup'

export function hasAnswers(d: ApplyDraft): boolean {
  const filled = (v: unknown): boolean =>
    typeof v === 'string' ? v.trim() !== '' : typeof v === 'boolean' ? v : typeof v === 'number' ? true : Array.isArray(v) ? v.length > 0 : v !== null && typeof v === 'object' ? Object.values(v).some(filled) : false
  const { page: _page, checking: _checking, ...answers } = d
  return filled(answers)
}

// The password and the bank account number are never kept, even in memory: a seller who leaves
// the page types them again.
function withoutSecrets(d: ApplyDraft): ApplyDraft {
  return structuredClone({ ...d, password: '', payout: { ...d.payout, account_number: '', account_number_again: '' } })
}

/**
 * The draft kept while this tab is open (src/session/drafts.ts: memory only, gone on a reload or a
 * sign-out), or null. It stays kept after reading: StrictMode reads it twice.
 */
export function readDraft(): ApplyDraft | null {
  const kept = takeDraft<ApplyDraft>(APPLY_DRAFT_KEY)
  if (!kept) return null
  saveDraft(APPLY_DRAFT_KEY, kept)
  return structuredClone(kept)
}

export function writeDraft(draft: ApplyDraft): void {
  if (hasAnswers(withoutSecrets(draft))) saveDraft(APPLY_DRAFT_KEY, withoutSecrets(draft))
  else clearDraft()
}

export function clearDraft(): void {
  takeDraft(APPLY_DRAFT_KEY)
}
