import { describe, expect, it } from 'vitest'
import { ApiError } from '../errors'
import type { StoreDetailsOut } from '../wire'
import { ifscFromApi, storeDetailsFromApi, storeErrors, storeFieldKey } from './storeDetails'

// vendor-api's real answer (services/vendor-api, PR #281): flat, with loosely typed topics.
function out(overrides: Partial<StoreDetailsOut> = {}): StoreDetailsOut {
  return {
    brand_name: 'Kalki Studio',
    sells: 'women',
    city: 'Ahmedabad',
    instagram_or_website: '@kalki.studio',
    contact: { name: 'Kiran Shah', phone: '9825012345', email: 'kiran@kalkistudio.in' },
    delivery: { mode: 'shazlo', pickup_address: { line1: '14 Sahjanand Society', area: 'Ambawadi', city: 'Ahmedabad', pin: '380015' } },
    returns: { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 },
    pay_on_delivery: { cash: true, upi: false },
    payout: null,
    business: { legal_name: 'Kalki Studio LLP', gstin: null },
    missing: ['payout'],
    complete: false,
    updated_at: '2026-11-01T10:00:00Z',
    ...overrides,
  }
}

describe('storeDetailsFromApi', () => {
  it('reads vendor-api\'s answer as the screens\' store details', () => {
    expect(storeDetailsFromApi(out())).toEqual({
      brand_name: 'Kalki Studio',
      sells: 'women',
      city: 'Ahmedabad',
      instagram_or_website: '@kalki.studio',
      contact: { name: 'Kiran Shah', phone: '9825012345', email: 'kiran@kalkistudio.in' },
      delivery: { mode: 'shazlo', pickup_address: { line1: '14 Sahjanand Society', area: 'Ambawadi', city: 'Ahmedabad', pin: '380015' } },
      returns: { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 },
      pay_on_delivery: { cash: true, upi: false },
      payout: null,
      business: { legal_name: 'Kalki Studio LLP', gstin: null },
      missing: ['payout'],
      complete: false,
      updated_at: '2026-11-01T10:00:00Z',
    })
  })

  it('keeps the missing topics vendor-api names, in page order, and drops ones it does not know', () => {
    const details = storeDetailsFromApi(out({ missing: ['payout', 'pay_on_delivery', 'brand', 'loyalty_programme'], complete: false }))
    expect(details.missing).toEqual(['brand', 'pay_on_delivery', 'payout'])
  })

  it('keeps a masked bank payout, with no bank name for a bank vendor-api does not list', () => {
    const listed = storeDetailsFromApi(out({ payout: { method: 'bank', holder_name: 'Kalki', bank_name: 'HDFC Bank', account_last4: '4821', ifsc: 'HDFC0001234' }, missing: [], complete: true }))
    expect(listed.payout).toEqual({ method: 'bank', holder_name: 'Kalki', bank_name: 'HDFC Bank', account_last4: '4821', ifsc: 'HDFC0001234' })
    expect(listed.complete).toBe(true)
    const unlisted = storeDetailsFromApi(out({ payout: { method: 'bank', holder_name: 'Kalki', bank_name: null, account_last4: '0042', ifsc: 'ZZZZ0001234' } }))
    expect(unlisted.payout).toEqual({ method: 'bank', holder_name: 'Kalki', bank_name: null, account_last4: '0042', ifsc: 'ZZZZ0001234' })
  })

  it('keeps a masked UPI ID as it is', () => {
    expect(storeDetailsFromApi(out({ payout: { method: 'upi', upi_id: 'ka•••@okhdfcbank' } })).payout).toEqual({ method: 'upi', upi_id: 'ka•••@okhdfcbank' })
  })

  it('never calls the details complete while something is missing', () => {
    expect(storeDetailsFromApi(out({ missing: ['contact'], complete: true })).complete).toBe(false)
  })

  it('treats values it cannot read as not filled in', () => {
    const details = storeDetailsFromApi(out({
      sells: 'kids' as never,
      city: 7 as never,
      contact: { name: 'Kiran' },
      delivery: { mode: 'drone' },
      returns: { window_days: 3, condition: null, refund_days: null },
      payout: { method: 'cheque' },
      pay_on_delivery: { cash: 'yes' as never, upi: true },
    }))
    expect(details).toMatchObject({ sells: null, city: null, contact: null, delivery: null, returns: null, payout: null, pay_on_delivery: { cash: false, upi: true } })
  })

  it('survives a body with topics left out', () => {
    const details = storeDetailsFromApi({} as StoreDetailsOut)
    expect(details).toMatchObject({ brand_name: '', contact: null, business: { legal_name: null, gstin: null }, missing: [], complete: false, updated_at: null })
  })
})

describe('ifscFromApi', () => {
  it('reads the bank; vendor-api has no branch names yet', () => {
    expect(ifscFromApi({ ifsc: 'HDFC0001234', bank: 'HDFC Bank', branch: null })).toEqual({ ifsc: 'HDFC0001234', bank: 'HDFC Bank', branch: null })
    expect(ifscFromApi({ ifsc: 'HDFC0001234', bank: 'HDFC Bank', branch: 'Navrangpura' })).toMatchObject({ branch: 'Navrangpura' })
  })
})

describe('field names in a 422', () => {
  it('keeps vendor-api\'s dot paths, which are the section form\'s', () => {
    expect(storeFieldKey('pickup_address.pin')).toBe('pickup_address.pin')
    expect(storeFieldKey('delivery_days')).toBe('delivery_days')
    expect(storeFieldKey('pay_on_delivery')).toBe('pay_on_delivery')
  })

  it('puts a problem with one place on the places field', () => {
    expect(storeFieldKey('areas.places.2')).toBe('areas.places')
  })

  it('still drops a union tag pydantic may put in front of a field', () => {
    expect(storeFieldKey('shazlo.pickup_address.pin')).toBe('pickup_address.pin')
    expect(storeFieldKey('bank.ifsc')).toBe('ifsc')
  })

  it('remaps an ApiError, hidden-character and blank-looking messages included', () => {
    const error = new ApiError({ status: 422, code: 'validation_error', message: 'x', fieldErrors: { name: 'This looks empty. Type the text itself.', 'areas.places.0': 'Remove hidden or control characters from this text.' } })
    expect((storeErrors(error) as ApiError).fields).toEqual({ name: 'This looks empty. Type the text itself.', 'areas.places': 'Remove hidden or control characters from this text.' })
  })
})
