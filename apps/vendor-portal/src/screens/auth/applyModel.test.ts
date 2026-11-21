import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../api/errors'
import { clearDrafts, takeDraft } from '../../session/drafts'
import {
  APPLY_DRAFT_KEY,
  checkStep,
  clearDraft,
  emptyDraft,
  firstProblem,
  orderOfStep,
  problemsByStep,
  readDraft,
  toApplication,
  valuesOfStep,
  writeDraft,
  type ApplyDraft,
} from './applyModel'

afterEach(() => clearDrafts())

const PASSWORD = 'indigo and madder 26'

function complete(): ApplyDraft {
  return {
    ...emptyDraft(),
    page: 8,
    brand: { brand_name: 'Neel Threads', sells: 'both', city: 'Surat', instagram_or_website: '' },
    contact: { name: 'Asha Patel', phone: '98765 43210', email: 'asha@neelthreads.in' },
    password: PASSWORD,
    delivery: { mode: 'own', pickup_address: { line1: '', area: '', city: '', pin: '' }, areas: { all_india: false, places: ['Surat'] }, place: '', delivery_days: '2_3' },
    returns: { window_days: 0, condition: null, refund_days: null },
    payment: { cash: true, upi: false },
    payout: { method: 'bank', holder_name: 'Neel Threads', account_number: '5010 0123 4567 4821', account_number_again: '5010 0123 4567 4821', ifsc: 'hdfc0001234', upi_id: '' },
    business: { legal_name: '', gstin: '' },
    terms: { commission: '', agreed_terms: true, agreed_price_rule: true },
  }
}

describe('the Contact step asks for a password', () => {
  it('checks it with the contact details, after the email', () => {
    expect(orderOfStep(2)).toEqual(['name', 'phone', 'email', 'password'])
    const draft = complete()
    expect(checkStep(2, { ...draft, password: '' })).toEqual({ password: 'Choose a password.' })
    expect(checkStep(2, { ...draft, password: 'short' })).toEqual({ password: 'Use at least 12 characters.' })
    expect(checkStep(2, { ...draft, password: ' Asha@NeelThreads.in ' }).password).toBe('Your password cannot be your email address.')
    expect(checkStep(2, draft)).toEqual({})
  })

  it('names the password among the values of the step, so a fixed message clears', () => {
    expect(valuesOfStep(2, complete())).toMatchObject({ email: 'asha@neelthreads.in', password: PASSWORD })
  })

  it('is caught before sending when it is missing (a draft brought back has none)', () => {
    expect(firstProblem({ ...complete(), password: '' })).toEqual({ step: 2, errors: { password: 'Choose a password.' } })
  })

  it('goes to the API exactly as typed', () => {
    expect(toApplication({ ...complete(), password: ` ${PASSWORD} ` }).password).toBe(` ${PASSWORD} `)
  })
})

describe('problemsByStep', () => {
  const refusal = (code: string, fields: Record<string, string> = {}, status = 422) => new ApiError({ status, code, message: `message for ${code}`, fieldErrors: fields })

  it("puts each field the API named on its step, under the step's own name", () => {
    const steps = problemsByStep(
      refusal('validation_error', {
        owner_name: 'Add your name',
        password: 'Too long',
        'payout.ifsc': 'Unknown IFSC',
        'pay_on_delivery.cash': 'Choose one',
        'delivery.pickup_address.pin': 'Bad PIN',
        gstin: 'Bad GST',
      }),
    )
    expect(Object.fromEntries(steps)).toEqual({
      2: { name: 'Add your name', password: 'Too long' },
      3: { 'pickup_address.pin': 'Bad PIN' },
      5: { pay_on_delivery: 'Choose one' },
      6: { ifsc: 'Unknown IFSC' },
      7: { gstin: 'Bad GST' },
    })
  })

  it('puts the refusals that come as a code on their field', () => {
    expect(Object.fromEntries(problemsByStep(refusal('weak_password')))).toEqual({ 2: { password: 'message for weak_password' } })
    expect(Object.fromEntries(problemsByStep(refusal('terms_not_accepted')))).toEqual({ 7: { agreed_terms: 'message for terms_not_accepted' } })
    expect(Object.fromEntries(problemsByStep(refusal('price_rule_not_accepted')))).toEqual({ 7: { agreed_price_rule: 'message for price_rule_not_accepted' } })
  })

  it('has nothing for an answer that names no field it knows, or that is not a 422', () => {
    expect(problemsByStep(refusal('validation_error', { _form: 'Something is off' })).size).toBe(0)
    expect(problemsByStep(refusal('rate_limited', {}, 429)).size).toBe(0)
    expect(problemsByStep(new Error('boom')).size).toBe(0)
  })
})

describe('the draft kept in memory', () => {
  it('holds the answers but never the password or the bank account number', () => {
    writeDraft(complete())
    const kept = takeDraft<ApplyDraft>(APPLY_DRAFT_KEY)!
    expect(kept.brand.brand_name).toBe('Neel Threads')
    expect(JSON.stringify(kept)).not.toContain(PASSWORD)
    expect(JSON.stringify(kept)).not.toContain('4821')
  })

  it('comes back with empty secrets, and can be read more than once (StrictMode reads twice)', () => {
    writeDraft(complete())
    const first = readDraft()
    expect(first).toMatchObject({ page: 8, password: '', payout: { account_number: '', account_number_again: '', ifsc: 'hdfc0001234' } })
    expect(readDraft()).toEqual(first)
  })

  it('keeps nothing for a draft with no answers, and clears on request', () => {
    writeDraft({ ...emptyDraft(), page: 1 })
    expect(readDraft()).toBeNull()
    writeDraft(complete())
    clearDraft()
    expect(readDraft()).toBeNull()
  })

  it('is a copy: changing the draft later does not change what was kept', () => {
    const draft = complete()
    writeDraft(draft)
    draft.delivery.areas.places.push('Ahmedabad')
    expect(readDraft()?.delivery.areas.places).toEqual(['Surat'])
  })

  it('touches no web storage', () => {
    localStorage.clear()
    writeDraft(complete())
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
