import { describe, expect, it } from 'vitest'
import { ApiError } from '../errors'
import type { StoreDetailsOut } from '../wire'
import { storeDetailsFromApi, storeErrors, storeFieldKey } from './storeDetails'

function out(overrides: Partial<StoreDetailsOut> = {}): StoreDetailsOut {
  return {
    brand: { brand_name: 'Kalki Studio', sells: 'women', city: 'Ahmedabad', instagram_or_website: '@kalki.studio' },
    contact: { name: 'Kiran Shah', phone: '9825012345', email: 'kiran@kalkistudio.in' },
    delivery: { mode: 'shazlo', pickup_address: { line1: '14 Sahjanand Society', area: 'Ambawadi', city: 'Ahmedabad', pin: '380015' } },
    returns: { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 },
    payment: { cash: true, upi: false },
    payout: null,
    business: { legal_name: 'Kalki Studio LLP', gstin: null },
    missing: ['payout'],
    complete: false,
    version: 3,
    updated_at: '2026-11-01T10:00:00Z',
    ...overrides,
  }
}

describe('storeDetailsFromApi', () => {
  it('flattens the brand section and calls the payment section "pay on delivery"', () => {
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

  it('names the missing payment section by its topic and keeps page order', () => {
    const details = storeDetailsFromApi(out({ missing: ['payout', 'payment', 'brand'], complete: false }))
    expect(details.missing).toEqual(['brand', 'pay_on_delivery', 'payout'])
  })

  it('keeps a masked payout as it is', () => {
    const details = storeDetailsFromApi(out({ payout: { method: 'bank', holder_name: 'Kalki', bank_name: 'HDFC Bank', account_last4: '4821', ifsc: 'HDFC0001234' }, missing: [], complete: true }))
    expect(details.payout).toEqual({ method: 'bank', holder_name: 'Kalki', bank_name: 'HDFC Bank', account_last4: '4821', ifsc: 'HDFC0001234' })
    expect(details.complete).toBe(true)
  })

  it('never calls the details complete while something is missing', () => {
    expect(storeDetailsFromApi(out({ missing: ['contact'], complete: true })).complete).toBe(false)
  })

  it('treats unknown values as not filled in, and unknown sections as nothing', () => {
    const odd = out({
      brand: { brand_name: 'Kalki Studio', sells: 'kids' as never, city: 7 as never, instagram_or_website: null },
      delivery: { mode: 'drone' } as never,
      returns: { window_days: 3, condition: null, refund_days: null } as never,
      payout: { method: 'cheque' } as never,
      missing: ['brand', 'loyalty_programme'] as never,
    })
    const details = storeDetailsFromApi(odd)
    expect(details).toMatchObject({ sells: null, city: null, delivery: null, returns: null, payout: null, missing: ['brand'] })
  })

  it('survives a body with sections left out', () => {
    const details = storeDetailsFromApi({} as StoreDetailsOut)
    expect(details).toMatchObject({ brand_name: '', contact: null, business: { legal_name: null, gstin: null }, missing: [], complete: false, updated_at: null })
  })
})

describe('field names in a 422', () => {
  it('drops the union tag pydantic puts in front of a delivery or payout field', () => {
    expect(storeFieldKey('shazlo.pickup_address.pin')).toBe('pickup_address.pin')
    expect(storeFieldKey('bank.ifsc')).toBe('ifsc')
    expect(storeFieldKey('areas.places.2')).toBe('areas.places.2')
    expect(storeFieldKey('cash')).toBe('cash')
  })

  it('remaps an ApiError', () => {
    const error = new ApiError({ status: 422, code: 'validation_error', message: 'x', fieldErrors: { 'own.delivery_days': 'Choose a delivery time' } })
    expect((storeErrors(error) as ApiError).fields).toEqual({ delivery_days: 'Choose a delivery time' })
  })
})
