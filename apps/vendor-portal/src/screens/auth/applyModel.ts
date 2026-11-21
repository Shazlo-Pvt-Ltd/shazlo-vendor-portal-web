import { z } from 'zod'
import type { Schemas } from '../../api/model'
import {
  DELIVERY_DAYS,
  DELIVERY_MODES,
  normaliseBusiness,
  normaliseContact,
  normaliseDelivery,
  normalisePayOnDelivery,
  normalisePayout,
  normaliseReturns,
  PAYOUT_METHODS,
  REFUND_DAYS,
  RETURN_CONDITIONS,
  RETURN_WINDOWS,
  type FieldErrors,
} from '../../lib/storeDetails'
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
// adds the page order, the draft kept on this device and the application the API takes.

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
  return step === 7 ? { ...d.business, ...d.terms } : d[STEP_TOPICS[step - 1]!]
}

// Fields of a step in page order, for the error summary.
export function orderOfStep(step: number): readonly string[] {
  if (step === 7) return [...FIELD_ORDER.business, ...FIELD_ORDER.terms]
  const topic = STEP_TOPICS[step - 1]
  return topic ? FIELD_ORDER[topic] : []
}

// What Continue checks on a step, keyed by field.
export function checkStep(step: number, d: ApplyDraft): FieldErrors {
  switch (step) {
    case 1: return checkTopic('brand', d.brand, { storeName: true })
    case 2: return checkTopic('contact', d.contact)
    case 3: return checkTopic('delivery', d.delivery)
    case 4: return checkTopic('returns', d.returns)
    case 5: return checkTopic('payment', d.payment)
    case 6: return checkTopic('payout', d.payout)
    case 7: return { ...checkTopic('business', d.business), ...checkTerms(d.terms) }
  }
  return {}
}

// Before sending, every step again: a restored draft may have skipped one, and account numbers
// are never restored. The first step with problems, or null.
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
const PLAIN: Record<string, [step: number, key: string]> = {
  brand_name: [1, 'brand_name'],
  sells: [1, 'sells'],
  city: [1, 'city'],
  instagram_or_website: [1, 'instagram_or_website'],
  owner_name: [2, 'name'],
  phone: [2, 'phone'],
  email: [2, 'email'],
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
    const prefixed = PREFIXED.find(([prefix]) => field.startsWith(prefix))
    if (prefixed) put(prefixed[1], field.slice(prefixed[0].length), message)
  }
  return out
}

// ---- the draft kept on this device ---------------------------------------------------------------

// v2: the Build 2 sign-up. Drafts of the old three-step form are thrown away.
export const DRAFT_KEY = 'shazlo.seller.application-draft.v2'
const OLD_DRAFT_KEYS = ['shazlo.seller.application-draft']

const text = z.string().max(2000).catch('')
const flag = z.boolean().catch(false)
const choice = <const T extends readonly string[]>(values: T) => z.enum([...values, ''] as const).catch('')

const storedDraft = z.object({
  page: z.number().int().min(INTRO).max(CHECK).catch(INTRO),
  checking: flag,
  brand: z.object({ brand_name: text, sells: choice(['women', 'men', 'both']), city: text, instagram_or_website: text }).catch(empty.brand),
  contact: z.object({ name: text, phone: text, email: text }).catch(empty.contact),
  delivery: z
    .object({
      mode: choice(DELIVERY_MODES),
      pickup_address: z.object({ line1: text, area: text, city: text, pin: text }).catch(() => empty.delivery().pickup_address),
      areas: z.object({ all_india: z.boolean().nullable().catch(null), places: z.array(z.string().max(100)).max(50).catch([]) }).catch(() => empty.delivery().areas),
      place: text,
      delivery_days: choice(DELIVERY_DAYS),
    })
    .catch(empty.delivery),
  returns: z
    .object({
      window_days: z.literal(RETURN_WINDOWS).nullable().catch(null),
      condition: z.enum(RETURN_CONDITIONS).nullable().catch(null),
      refund_days: z.literal(REFUND_DAYS).nullable().catch(null),
    })
    .catch(empty.returns),
  payment: z.object({ cash: flag, upi: flag }).catch(empty.payment),
  // Account numbers are never stored (below), so they are not read back either.
  payout: z.object({ method: choice(PAYOUT_METHODS), holder_name: text, ifsc: text, upi_id: text }).catch(empty.payout),
  business: z.object({ legal_name: text, gstin: text }).catch(empty.business),
  terms: z.object({ commission: text, agreed_terms: flag, agreed_price_rule: flag }).catch(empty.terms),
})

export function hasAnswers(d: ApplyDraft): boolean {
  const filled = (v: unknown): boolean =>
    typeof v === 'string' ? v.trim() !== '' : typeof v === 'boolean' ? v : typeof v === 'number' ? true : Array.isArray(v) ? v.length > 0 : v !== null && typeof v === 'object' ? Object.values(v).some(filled) : false
  const { page: _page, checking: _checking, ...answers } = d
  return filled(answers)
}

// Storage can be blocked (private mode) or hold something we did not write; both mean no draft.
export function readDraft(): ApplyDraft | null {
  try {
    for (const key of OLD_DRAFT_KEYS) localStorage.removeItem(key)
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = storedDraft.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    const draft: ApplyDraft = { ...parsed.data, payout: { ...parsed.data.payout, account_number: '', account_number_again: '' } }
    return hasAnswers(draft) ? draft : null
  } catch {
    return null
  }
}

// The bank account number stays in memory only: this device may be shared.
export function writeDraft(draft: ApplyDraft): void {
  try {
    if (!hasAnswers(draft)) {
      localStorage.removeItem(DRAFT_KEY)
      return
    }
    const { account_number: _a, account_number_again: _b, ...payout } = draft.payout
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, payout }))
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
