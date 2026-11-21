import { describe, expect, it } from 'vitest'
import type { Schemas } from '../api/model'
import { validApplication } from '../test/fixtures'
import { checkCommissionBps, formatBps, parsePercent, sellerReceives } from './commission'
import {
  checkApplication,
  checkBrand,
  checkBusiness,
  checkContact,
  checkDelivery,
  checkPayOnDelivery,
  checkPayout,
  checkReturns,
  checkSizeChart,
  maskPayout,
  normaliseDelivery,
  normalisePayout,
  normaliseReturns,
  normaliseSizeChart,
  SECTION_FOR_TOPIC,
  storeDetailsMissing,
  type StoreTopicsLike,
} from './storeDetails'

const complete: StoreTopicsLike = {
  sells: 'women',
  city: 'Ahmedabad',
  instagram_or_website: null,
  contact: { name: 'Kiran Shah', phone: '9825012345', email: 'kiran@kalkistudio.in' },
  delivery: { mode: 'shazlo', pickup_address: { line1: '14 Sahjanand Society', area: 'Ambawadi', city: 'Ahmedabad', pin: '380015' } },
  returns: { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 },
  pay_on_delivery: { cash: true, upi: false },
  payout: { method: 'upi', upi_id: 'ka•••@okhdfcbank' },
}

describe('section checks', () => {
  it('checks the brand topic', () => {
    expect(checkBrand({ sells: 'women', city: 'Ahmedabad', instagram_or_website: '@kalki.studio' })).toEqual({})
    expect(checkBrand({ city: ' ', instagram_or_website: 'not a link' })).toEqual({
      sells: 'Choose who you sell for: women, men or both.',
      city: 'Add the city or area you ship from, like Ahmedabad.',
      instagram_or_website: 'Enter an Instagram handle like @kalki.studio or a website like kalkistudio.in.',
    })
  })

  it('checks the contact topic', () => {
    expect(checkContact({ name: 'Kiran', phone: '98250 12345', email: 'kiran@kalkistudio.in' })).toEqual({})
    expect(Object.keys(checkContact({ name: '', phone: '12345', email: 'kiran' }))).toEqual(['name', 'phone', 'email'])
  })

  it('checks the pickup address when Shazlo delivers', () => {
    expect(checkDelivery(complete.delivery)).toEqual({})
    expect(checkDelivery({ mode: 'shazlo', pickup_address: { line1: '', area: '', city: 'Ahmedabad', pin: '38001' } })).toEqual({
      'pickup_address.line1': 'Add the address: house or shop number, building and street.',
      'pickup_address.area': 'Add the area.',
      'pickup_address.pin': 'Enter a 6-digit PIN code, like 380015.',
    })
  })

  it('checks areas and delivery time when the brand delivers', () => {
    expect(checkDelivery({ mode: 'own', areas: { all_india: true, places: [] }, delivery_days: '3_5' })).toEqual({})
    expect(checkDelivery({ mode: 'own', areas: { all_india: false, places: [] } })).toEqual({
      areas: 'Choose All of India, or add the cities or PIN codes you deliver to.',
      delivery_days: 'Choose how long delivery takes.',
    })
    expect(checkDelivery({ mode: 'own', areas: { all_india: false, places: ['Surat', '39500'] }, delivery_days: '1_2' })).toEqual({
      'areas.places': '"39500" is not a PIN code. A PIN code has 6 digits, like 380015.',
    })
    expect(checkDelivery({})).toEqual({ mode: 'Choose who delivers your orders.' })
  })

  it('needs condition and refund time only when returns are accepted', () => {
    expect(checkReturns({ window_days: 0, condition: null, refund_days: null })).toEqual({})
    expect(checkReturns({ window_days: 14, condition: null, refund_days: null })).toEqual({
      condition: 'Choose which returns you accept.',
      refund_days: 'Choose how soon you refund.',
    })
    expect(checkReturns({ window_days: 10 })).toEqual({ window_days: 'Choose a return window.' })
    // No returns: whatever else was sent is stored as null.
    expect(normaliseReturns({ window_days: 0, condition: 'any_reason', refund_days: 7 })).toEqual({ window_days: 0, condition: null, refund_days: null })
  })

  it('needs at least one way to pay on delivery', () => {
    expect(checkPayOnDelivery({ cash: false, upi: true })).toEqual({})
    expect(checkPayOnDelivery({ cash: false, upi: false })).toEqual({ pay_on_delivery: 'Choose at least one: cash on delivery or UPI on delivery.' })
  })

  it('checks bank or UPI payouts by format', () => {
    expect(checkPayout(validApplication.payout)).toEqual({})
    expect(checkPayout({ method: 'bank', holder_name: '', account_number: '1234', ifsc: 'HDFC123' })).toEqual({
      holder_name: 'Add the account holder name, as the bank has it.',
      account_number: 'Enter the account number: 9 to 18 digits.',
      ifsc: 'Enter the 11-character IFSC code, like HDFC0001234. It is on your cheque book.',
    })
    expect(checkPayout({ method: 'upi', upi_id: 'kalki' })).toEqual({ upi_id: 'Enter a UPI ID like name@okhdfcbank.' })
    expect(checkPayout({})).toEqual({ method: 'Choose a bank account or a UPI ID.' })
  })

  it('treats business details as optional but checks a GST number when given', () => {
    expect(checkBusiness({ legal_name: null, gstin: null })).toEqual({})
    expect(checkBusiness({ legal_name: '', gstin: '24AAKFK1234L1ZD' })).toEqual({})
    expect(checkBusiness({ legal_name: 'x'.repeat(121), gstin: '24AAKFK1234L1ZA' })).toEqual({
      legal_name: 'Keep the legal name under 120 characters.',
      gstin: 'Check your GST number. It has 15 characters, like 24ABCDE1234F1Z6.',
    })
  })
})

describe('normalising and masking', () => {
  it('stores PIN codes and places tidily, and no places for all of India', () => {
    expect(normaliseDelivery({ mode: 'own', areas: { all_india: false, places: [' Surat ', '395 007', 'Surat'] }, delivery_days: '2_3' })).toEqual({
      mode: 'own',
      areas: { all_india: false, places: ['Surat', '395007'] },
      delivery_days: '2_3',
    })
    expect(normaliseDelivery({ mode: 'own', areas: { all_india: true, places: ['Surat'] }, delivery_days: '2_3' })).toMatchObject({ areas: { all_india: true, places: [] } })
  })

  it('never returns the full account number or UPI ID', () => {
    const bank = normalisePayout(validApplication.payout)
    expect(bank).toEqual({ method: 'bank', holder_name: 'Neel Threads', account_number: '5010012345674821', ifsc: 'HDFC0001234' })
    expect(maskPayout(bank, 'HDFC Bank')).toEqual({ method: 'bank', holder_name: 'Neel Threads', bank_name: 'HDFC Bank', account_last4: '4821', ifsc: 'HDFC0001234' })
    expect(maskPayout({ method: 'upi', upi_id: 'Kalki.Studio@okhdfcbank' }, '')).toEqual({ method: 'upi', upi_id: 'ka•••@okhdfcbank' })
  })
})

describe('storeDetailsMissing', () => {
  it('is empty when every required topic is complete; business details are optional', () => {
    expect(storeDetailsMissing(complete)).toEqual([])
  })

  it('lists missing or incomplete topics in page order', () => {
    expect(storeDetailsMissing({ ...complete, payout: null })).toEqual(['payout'])
    expect(storeDetailsMissing({ sells: null, city: null, instagram_or_website: null, contact: null, delivery: null, returns: null, pay_on_delivery: null, payout: null })).toEqual([
      'brand', 'contact', 'delivery', 'returns', 'pay_on_delivery', 'payout',
    ])
    expect(storeDetailsMissing({ ...complete, pay_on_delivery: { cash: false, upi: false }, returns: { window_days: 7, condition: null, refund_days: 5 } })).toEqual(['returns', 'pay_on_delivery'])
  })

  it('maps each topic to the section that saves it', () => {
    expect(SECTION_FOR_TOPIC.pay_on_delivery).toBe('payment')
    expect(SECTION_FOR_TOPIC.payout).toBe('payout')
  })
})

describe('checkApplication', () => {
  it('accepts a complete application', () => {
    expect(checkApplication(validApplication)).toEqual({})
    expect(checkApplication({ ...validApplication, legal_name: 'Neel Threads LLP', gstin: '24ABCDE1234F1Z6', proposed_commission_bps: 1000 })).toEqual({})
  })

  it('keys problems by their path in the application', () => {
    const fields = checkApplication({ delivery: { mode: 'shazlo', pickup_address: { line1: 'x', area: 'y', city: 'z', pin: '1' } }, returns: { window_days: 7 }, payout: { method: 'upi', upi_id: '' }, proposed_commission_bps: 4001, gstin: 'nope' })
    expect(Object.keys(fields).sort()).toEqual([
      'agreed_price_rule', 'agreed_terms', 'brand_name', 'city', 'delivery.pickup_address.pin', 'email', 'gstin', 'owner_name',
      'pay_on_delivery', 'payout.upi_id', 'phone', 'proposed_commission_bps', 'returns.condition', 'returns.refund_days', 'sells',
    ])
    expect(fields.proposed_commission_bps).toBe('Enter a rate from 0% to 40%.')
  })
})

describe('size charts', () => {
  it('checks sizes, the group measurements and centimetres', () => {
    expect(checkSizeChart('tops', { measurements: { M: { chest: 100, shoulder: null } }, photo_url: null })).toEqual({})
    expect(checkSizeChart('tops', { measurements: { M: { bust: 90, chest: 0 }, XXXL: { chest: 120 } }, photo_url: null })).toEqual({
      'measurements.M.bust': '"bust" is not measured for this size chart.',
      'measurements.M.chest': 'Enter centimetres above 0 and up to 300, like 96 or 96.5.',
      'measurements.XXXL': '"XXXL" is not a size we list.',
    })
  })

  it('fills every measurement of the group, drops blank sizes and sorts sizes', () => {
    expect(normaliseSizeChart('bottoms', { '32': { waist: 81 }, S: { waist: null }, '28': { hip: 96, inseam: 76 } })).toEqual({
      '28': { waist: null, hip: 96, inseam: 76, length: null },
      '32': { waist: 81, hip: null, inseam: null, length: null },
    })
  })
})

describe('commission helpers', () => {
  it('formats and reads percentages as basis points', () => {
    expect(formatBps(1200)).toBe('12%')
    expect(formatBps(1250)).toBe('12.5%')
    expect(formatBps(1225)).toBe('12.25%')
    expect(parsePercent('12')).toBe(1200)
    expect(parsePercent(' 12.5 %')).toBe(1250)
    expect(parsePercent('12.555')).toBeNull()
    expect(parsePercent('twelve')).toBeNull()
    expect(checkCommissionBps(4000)).toBeNull()
    expect(checkCommissionBps(4001)).toBe('Enter a rate from 0% to 40%.')
    expect(checkCommissionBps(12.5)).toBe('Enter a rate from 0% to 40%.')
  })

  it('shows what the seller receives only once a rate is agreed', () => {
    const agreed: Schemas['Commission'] = { state: 'agreed', agreed_bps: 1200, proposed_bps: null, note: null, updated_at: null }
    expect(sellerReceives(249_900, agreed)).toEqual({ bps: 1200, commission: 29_988, receive: 219_912 })
    expect(sellerReceives(249_900, { ...agreed, state: 'not_set', agreed_bps: null })).toBeNull()
    expect(sellerReceives(249_900, { ...agreed, state: 'proposed', agreed_bps: null, proposed_bps: 1000 })).toBeNull()
    expect(sellerReceives(null, agreed)).toBeNull()
  })
})

describe('trying to break the commission rules', () => {
  it.each([
    ['-5', null],
    ['12.555', null],
    ['1e1', null],
    ['१२', null],
    ['12,5', null],
    ['.5', null],
    ['', null],
    ['0', 0],
    ['040', 4000],
    [' 12.25 % ', 1225],
    ['12.5%', 1250],
  ] as const)('reads %j as %j basis points', (typed, bps) => {
    expect(parsePercent(typed)).toBe(bps)
  })

  it('allows 0% to 40% in whole basis points only', () => {
    expect(checkCommissionBps(0)).toBeNull()
    expect(checkCommissionBps(4000)).toBeNull()
    for (const bad of [-1, 4001, 12.5, Number.NaN, Infinity, '1200', null, undefined]) expect(checkCommissionBps(bad)).not.toBeNull()
  })

  it('never shows a payout without an agreed rate, and pays out every paisa', () => {
    expect(sellerReceives(219_900, { state: 'proposed', agreed_bps: null, proposed_bps: 1000, note: null, updated_at: null })).toBeNull()
    expect(sellerReceives(0, { state: 'agreed', agreed_bps: 1200, proposed_bps: null, note: null, updated_at: null })).toBeNull()
    const odd = sellerReceives(99_999, { state: 'agreed', agreed_bps: 1250, proposed_bps: null, note: null, updated_at: null })!
    expect(odd.commission + odd.receive).toBe(99_999)
    expect(formatBps(1)).toBe('0.01%')
  })
})
