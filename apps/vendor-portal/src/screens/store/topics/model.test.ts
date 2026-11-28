import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../api/errors'
import { checkTopic, deliveryBody, empty, payoutBody, settleErrors, showErrors, unknownIfsc, visibleErrors } from './model'
import { payoutLine } from './summary'

describe('store-details answers', () => {
  it('counts a place typed but not added, and sends no places for All of India', () => {
    const typed = { ...empty.delivery(), mode: 'own' as const, areas: { all_india: false, places: ['Surat'] }, place: ' 395007, Surat ', delivery_days: '2_3' as const }
    expect(deliveryBody(typed)).toEqual({ mode: 'own', areas: { all_india: false, places: ['Surat', '395007'] }, delivery_days: '2_3' })
    expect(deliveryBody({ ...typed, areas: { all_india: true, places: ['Surat'] } })).toMatchObject({ areas: { all_india: true, places: [] } })
  })

  it('asks for the account number twice and the same both times', () => {
    const bank = { ...empty.payout(), method: 'bank' as const, holder_name: 'Neel Threads', account_number: '5010 0123 4567 4821', ifsc: 'HDFC0001234' }
    expect(checkTopic('payout', { ...bank, account_number_again: '501001234567482' })).toEqual({ account_number_again: 'The account numbers do not match. Type the same number in both fields.' })
    expect(checkTopic('payout', { ...bank, account_number_again: '50100123 45674821' })).toEqual({})
  })

  it('needs a store name only where the seller may set one', () => {
    expect(checkTopic('brand', { ...empty.brand(), sells: 'women', city: 'Surat' }, { storeName: true })).toEqual({ brand_name: 'Add your store name.' })
    expect(checkTopic('brand', { ...empty.brand(), sells: 'women', city: 'Surat' })).toEqual({})
  })
})

describe('shown messages', () => {
  it('drops a message of ours once its answer is fixed, and follows the answer until then', () => {
    const shown = showErrors({ pin: 'Add the PIN code.', city: 'Add the city.' })
    expect(visibleErrors(settleErrors(shown, { pin: 'Enter a 6-digit PIN code, like 380015.' }, {}))).toEqual({ pin: 'Enter a 6-digit PIN code, like 380015.' })
  })

  it("drops the server's message once the answer it was about changes", () => {
    const before = { email: 'a@b.in', name: 'Asha' }
    const shown = showErrors({}, { email: 'Another store already uses this email.' }, before)
    expect(visibleErrors(settleErrors(shown, {}, { ...before, name: 'Asha P' }))).toEqual({ email: 'Another store already uses this email.' })
    expect(visibleErrors(settleErrors(shown, {}, { ...before, email: 'b@b.in' }))).toEqual({})
  })
})

// vendor-api (PR #281) knows the bank of most IFSCs but not all: a well-formed code of a bank it
// does not list (`404 ifsc_unknown`) may still take a payout, and the saved payout has no bank name.
describe('a bank vendor-api does not list', () => {
  it('does not stop the payout from being saved', () => {
    expect(unknownIfsc(new ApiError({ status: 404, code: 'ifsc_unknown', message: 'We do not know the bank for this IFSC.' }))).toEqual({})
    expect(unknownIfsc(new ApiError({ status: 422, code: 'ifsc_format', message: 'Enter an IFSC like HDFC0001234.' }))).toEqual({})
    expect(unknownIfsc(undefined)).toEqual({})
  })

  it('shows the saved payout without a bank name', () => {
    expect(payoutLine({ method: 'bank', holder_name: 'Kalki', bank_name: null, account_last4: '0042', ifsc: 'ZZZZ0001234' })).toBe('Bank account •••• 0042')
    expect(payoutLine({ method: 'bank', holder_name: 'Kalki', bank_name: 'HDFC Bank', account_last4: '4821', ifsc: 'HDFC0001234' })).toBe('HDFC Bank •••• 4821')
  })
})

describe('the payout body', () => {
  it('sends only the fields of the chosen method, which is all vendor-api takes', () => {
    const bank = { ...empty.payout(), method: 'bank' as const, holder_name: 'Neel', account_number: '5010 0123 4567 4821', account_number_again: '5010 0123 4567 4821', ifsc: 'hdfc0001234', upi_id: 'left@over' }
    expect(Object.keys(payoutBody(bank)).sort()).toEqual(['account_number', 'holder_name', 'ifsc', 'method'])
    expect(Object.keys(payoutBody({ ...bank, method: 'upi', upi_id: 'neel@okhdfcbank' })).sort()).toEqual(['method', 'upi_id'])
  })
})
