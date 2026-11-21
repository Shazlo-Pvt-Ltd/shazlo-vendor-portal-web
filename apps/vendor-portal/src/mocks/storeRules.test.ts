// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  approve,
  checkChart,
  checkSection,
  CommissionRuleError,
  hasHiddenCharacters,
  lookupIfsc,
  looksBlank,
  maskedPayout,
  normaliseChart,
  normaliseDelivery,
  propose,
  readSection,
  sendBack,
  setRate,
  type Terms,
} from './storeRules'

// The mock's port of vendor-api's rules (PR #281), checked against the cases vendor-api's own tests
// use (services/vendor-api/tests/test_store_details_api.py, test_commission_rules.py,
// test_size_charts_api.py, test_break_265.py).

describe('text people type', () => {
  it('finds hidden and control characters, but lets joiners shape Indic scripts', () => {
    expect(hasHiddenCharacters('Kalki‮oidutS')).toBe(true)
    expect(hasHiddenCharacters('Kal​ki')).toBe(true)
    expect(hasHiddenCharacters('Kal\u0000ki')).toBe(true)
    expect(hasHiddenCharacters('क्‍ष')).toBe(false)
    expect(hasHiddenCharacters('Kalki Studio')).toBe(false)
  })

  it('finds text that only looks blank, not empty or all-space text', () => {
    expect(looksBlank('ㅤ')).toBe(true)
    expect(looksBlank(' ⠀ ')).toBe(true)
    expect(looksBlank('‍')).toBe(true)
    expect(looksBlank('')).toBe(false)
    expect(looksBlank('   ')).toBe(false)
    expect(looksBlank('Kiran')).toBe(false)
  })
})

describe('the request models', () => {
  it('refuse unknown fields, wrong types and hidden text where they are', () => {
    expect(readSection('payment', { cash: 'yes', upi: true, extra: 1 })).toEqual([
      { loc: ['body', 'extra'], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' },
      { loc: ['body', 'cash'], msg: 'Input should be a valid boolean', type: 'bool_type' },
    ])
    expect(readSection('delivery', { mode: 'own', areas: { all_india: false, places: ['Surat', 'Pune​'] }, delivery_days: '2_3' })).toEqual([
      { loc: ['body', 'areas', 'places', 1], msg: 'Remove hidden or control characters from this text.', type: 'hidden_characters' },
    ])
    expect(readSection('contact', { name: 'ㅤ', phone: '1', email: 'a' })).toEqual([{ loc: ['body', 'name'], msg: 'This looks empty. Type the text itself.', type: 'blank_text' }])
    expect(readSection('brand', { sells: 'kids', city: 'Surat' })[0]).toMatchObject({ loc: ['body', 'sells'], type: 'literal_error', msg: "Input should be 'women', 'men' or 'both'" })
  })
})

describe('the section rules', () => {
  it('name each field with vendor-api\'s words', () => {
    expect(checkSection('brand', { sells: 'women', city: 'A' })).toEqual({ city: 'Enter the city or area you ship from.' })
    expect(checkSection('delivery', { mode: 'shazlo', pickup_address: { line1: ' ', area: 'x', city: 'y', pin: '012345' } })).toEqual({
      'pickup_address.line1': 'Enter the address.',
      'pickup_address.pin': 'Enter a 6-digit PIN code.',
    })
    expect(checkSection('delivery', { mode: 'own', areas: { all_india: false, places: ['01234'] } })).toEqual({
      'areas.places': 'A PIN code has 6 digits and does not start with 0.',
      delivery_days: 'Choose how long delivery takes.',
    })
    expect(checkSection('payment', { cash: false, upi: false })).toEqual({ pay_on_delivery: 'Choose at least one way to pay on delivery.' })
    expect(checkSection('payout', { method: 'upi', upi_id: 'kalki@okhdfcbank', ifsc: 'HDFC0001234' })).toEqual({ ifsc: 'Send bank details only with the bank method.' })
  })

  it('let a payout use a bank that is not listed', () => {
    expect(checkSection('payout', { method: 'bank', holder_name: 'Kalki', account_number: '123456789042', ifsc: 'ZZZZ0001234' })).toEqual({})
  })

  it('normalise places like vendor-api: PIN codes without spaces, no repeats', () => {
    expect(normaliseDelivery({ mode: 'own', areas: { all_india: false, places: ['Ahmedabad', '380 009', 'Ahmedabad'] }, delivery_days: '2_3' })).toEqual({
      mode: 'own',
      areas: { all_india: false, places: ['Ahmedabad', '380009'] },
      delivery_days: '2_3',
    })
  })
})

describe('payouts and the IFSC directory', () => {
  it('mask a payout: the bank (null when unlisted) and the last four digits, or ka•••@handle', () => {
    expect(maskedPayout({ method: 'bank', holder_name: 'Kalki', account_number: '50100123454821', ifsc: 'HDFC0001234' })).toEqual({ method: 'bank', holder_name: 'Kalki', bank_name: 'HDFC Bank', account_last4: '4821', ifsc: 'HDFC0001234' })
    expect(maskedPayout({ method: 'bank', holder_name: 'Kalki', account_number: '123456789042', ifsc: 'ZZZZ0001234' })).toMatchObject({ bank_name: null })
    expect(maskedPayout({ method: 'upi', upi_id: 'kalki.studio@okhdfcbank' })).toEqual({ method: 'upi', upi_id: 'ka•••@okhdfcbank' })
  })

  it('look up a bank by its code, with no branch; a malformed code throws', () => {
    expect(lookupIfsc('hdfc 0001234')).toEqual({ ifsc: 'HDFC0001234', bank: 'HDFC Bank', branch: null })
    expect(lookupIfsc('ZZZZ0001234')).toBeNull()
    expect(() => lookupIfsc('ſBIN0001234')).toThrow(RangeError)
  })
})

describe('the commission state machine', () => {
  const notSet: Terms = { state: 'not_set', agreed_bps: null, proposed_bps: null, note: null }

  it('keeps the agreed rate while a new one waits, and approves only what the reviewer saw', () => {
    const agreed = setRate(notSet, 1200)
    const waiting = propose(agreed, 1000)
    expect(waiting).toEqual({ state: 'proposed', agreed_bps: 1200, proposed_bps: 1000, note: null })
    expect(() => approve(waiting, 900)).toThrow(expect.objectContaining({ status: 409, code: 'commission_changed' }))
    expect(approve(waiting, 1000)).toEqual({ state: 'agreed', agreed_bps: 1000, proposed_bps: null, note: null })
  })

  it('refuses the rate already agreed, out-of-range rates and short notes', () => {
    expect(() => propose(setRate(notSet, 1200), 1200)).toThrow(expect.objectContaining({ status: 422, code: 'same_as_agreed', field: 'rate_bps' }))
    expect(() => propose(notSet, 4001)).toThrow(expect.objectContaining({ code: 'rate_range' }))
    expect(() => sendBack(propose(notSet, 800), 'too short')).toThrow(expect.objectContaining({ code: 'note_length', field: 'note' }))
    expect(() => sendBack(notSet, 'A long enough note.')).toThrow(CommissionRuleError)
    expect(sendBack(propose(notSet, 800), '  We can do 10% instead.  ')).toEqual({ state: 'sent_back', agreed_bps: null, proposed_bps: 800, note: 'We can do 10% instead.' })
  })
})

describe('size charts', () => {
  it('take the group\'s sizes and measurements in whole tenths up to 300 cm', () => {
    expect(checkChart('dresses', { M: { bust: 91.5, waist: null } })).toEqual({})
    expect(checkChart('dresses', { M: { bust: 91.55 }, L: { bust: 301 }, S: { bust: 1e-12 } })).toEqual({
      'measurements.M.bust': 'Enter centimetres above 0 and up to 300, with at most one decimal place.',
      'measurements.L.bust': 'Enter centimetres above 0 and up to 300, with at most one decimal place.',
      'measurements.S.bust': 'Enter centimetres above 0 and up to 300, with at most one decimal place.',
    })
    expect(checkChart('tops', { 32: { chest: 80 } })).toEqual({ 'measurements.32': 'This size is not used for this kind of product.' })
    expect(checkChart('bottoms', { 32: { waist: 80 } })).toEqual({})
    expect(checkChart('tops', { M: 'big' })).toEqual({ 'measurements.M': 'Give the measurements of this size.' })
  })

  it('come back with every measurement of the group, in size order, blank sizes dropped', () => {
    expect(normaliseChart('dresses', { L: { bust: 96.0000000001 }, S: { waist: 72 }, M: { bust: null } })).toEqual({
      S: { bust: null, waist: 72, hip: null, length: null },
      L: { bust: 96, waist: null, hip: null, length: null },
    })
  })
})
