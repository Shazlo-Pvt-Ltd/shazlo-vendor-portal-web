import { describe, expect, it } from 'vitest'
import { ApiError } from '../errors'
import type { VendorApplication } from '../model'
import { signupBodyFromApplication, signupErrors, signupField } from './signup'

const application: VendorApplication = {
  brand_name: 'Neel Threads',
  sells: 'both',
  city: 'Surat',
  instagram_or_website: ' @neel.threads ',
  owner_name: 'Asha Patel',
  phone: '+91 98765 43210',
  email: 'asha@neelthreads.in',
  password: 'indigo-and-madder-26',
  delivery: { mode: 'own', areas: { all_india: false, places: ['Surat', '395007'] }, delivery_days: '2_3' },
  returns: { window_days: 0, condition: null, refund_days: null },
  pay_on_delivery: { cash: true, upi: true },
  payout: { method: 'bank', holder_name: 'Neel Threads', account_number: '5010 0123 4567 4821', ifsc: 'hdfc0001234' },
  legal_name: '',
  gstin: '24AAKFK1234L1ZD',
  proposed_commission_bps: 1000,
  agreed_terms: true,
  agreed_price_rule: true,
}

describe('signupBodyFromApplication', () => {
  it('sends Build 2\'s answers as vendor-api\'s sign-up with the store details', () => {
    expect(signupBodyFromApplication(application)).toEqual({
      brand_name: 'Neel Threads',
      contact_name: 'Asha Patel',
      email: 'asha@neelthreads.in',
      phone: '+91 98765 43210',
      password: 'indigo-and-madder-26',
      terms_accepted: true,
      price_rule_accepted: true,
      website_or_instagram: '@neel.threads',
      sells: 'both',
      city: 'Surat',
      proposed_commission_bps: 1000,
      store_details: {
        delivery: { mode: 'own', areas: { all_india: false, places: ['Surat', '395007'] }, delivery_days: '2_3' },
        returns: { window_days: 0, condition: null, refund_days: null },
        payment: { cash: true, upi: true },
        payout: { method: 'bank', holder_name: 'Neel Threads', account_number: '5010 0123 4567 4821', ifsc: 'hdfc0001234' },
        business: { legal_name: null, gstin: '24AAKFK1234L1ZD' },
      },
    })
  })

  it('leaves out a commission the seller did not propose, and never sends a price range', () => {
    const { proposed_commission_bps: _, ...rest } = application
    const body = signupBodyFromApplication(rest)
    expect(body).not.toHaveProperty('proposed_commission_bps')
    expect(body).not.toHaveProperty('price_min_paise')
    expect(body).not.toHaveProperty('product_type')
  })

  it('sends an empty password when the screen has none, so the server names the field', () => {
    const { password: _, ...rest } = application
    expect(signupBodyFromApplication(rest).password).toBe('')
  })
})

describe('signupField', () => {
  it('maps vendor-api\'s names back to the sign-up steps\' names', () => {
    expect(signupField('contact_name')).toBe('owner_name')
    expect(signupField('website_or_instagram')).toBe('instagram_or_website')
    expect(signupField('terms_accepted')).toBe('agreed_terms')
    expect(signupField('price_rule_accepted')).toBe('agreed_price_rule')
    expect(signupField('store_details.payment.cash')).toBe('pay_on_delivery.cash')
    expect(signupField('store_details.payment')).toBe('pay_on_delivery')
    expect(signupField('store_details.delivery.shazlo.pickup_address.pin')).toBe('delivery.pickup_address.pin')
    expect(signupField('store_details.payout.bank.ifsc')).toBe('payout.ifsc')
    expect(signupField('store_details.business.gstin')).toBe('gstin')
    expect(signupField('store_details.business.legal_name')).toBe('legal_name')
    expect(signupField('email')).toBe('email')
  })

  it('remaps a 422', () => {
    const error = new ApiError({ status: 422, code: 'validation_error', message: 'x', fieldErrors: { contact_name: 'Add your name', 'store_details.returns.refund_days': 'Choose a refund time' } })
    expect((signupErrors(error) as ApiError).fields).toEqual({ owner_name: 'Add your name', 'returns.refund_days': 'Choose a refund time' })
  })
})
