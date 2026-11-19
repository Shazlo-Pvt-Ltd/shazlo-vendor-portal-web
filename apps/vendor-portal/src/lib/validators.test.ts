import { describe, expect, it } from 'vitest'
import {
  accountLast4,
  gstinCheckChar,
  isValidAccountNumber,
  isValidEmail,
  isValidGstin,
  isValidIfsc,
  isValidLink,
  isValidPin,
  isValidUpiId,
  maskAccountNumber,
  maskUpiId,
  normaliseIfsc,
  normalisePhone,
} from './validators'

describe('IFSC', () => {
  it('accepts four letters, a zero and six letters or digits, in any case and with spaces', () => {
    for (const code of ['HDFC0001234', 'SBIN0060012', 'ICIC0ABC123', 'hdfc0001234', ' HDFC 0001234 ']) expect(isValidIfsc(code)).toBe(true)
    expect(normaliseIfsc(' hdfc 0001234')).toBe('HDFC0001234')
  })

  it('rejects codes of the wrong shape', () => {
    for (const code of ['', 'HDFC1001234', 'HDF00001234', 'HDFC000123', 'HDFC00012345', 'HDFC000123-', '1234012345A']) expect(isValidIfsc(code)).toBe(false)
  })
})

describe('GSTIN', () => {
  it('checks the shape, the state code and the check character', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true)
    expect(isValidGstin('24AAKFK1234L1ZD')).toBe(true)
    expect(isValidGstin('24abcde1234f1z6')).toBe(true)
    expect(gstinCheckChar('24ABCDE1234F1Z')).toBe('6')
  })

  it('rejects a wrong check character, state code or shape', () => {
    expect(isValidGstin('27AAPFU0939F1ZW')).toBe(false)
    expect(isValidGstin('45AAPFU0939F1ZV')).toBe(false)
    expect(isValidGstin('27AAPFU0939F1AV')).toBe(false)
    expect(isValidGstin('27AAPFU0939F0ZV')).toBe(false)
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false)
  })
})

describe('UPI ID', () => {
  it('accepts name@handle and masks all but the first two characters', () => {
    expect(isValidUpiId('kalki.studio@okhdfcbank')).toBe(true)
    expect(isValidUpiId('9825012345@ybl')).toBe(true)
    expect(isValidUpiId('Kiran-Shah@OKSBI')).toBe(true)
    expect(maskUpiId('kalki.studio@okhdfcbank')).toBe('ka•••@okhdfcbank')
    expect(maskUpiId('ab@ybl')).toBe('a•••@ybl')
  })

  it('rejects text that is not a UPI ID', () => {
    for (const id of ['', 'kalki', '@okhdfcbank', 'kalki@', 'kalki@ok hdfc', 'k@ybl', 'kalki@1bank']) expect(isValidUpiId(id)).toBe(false)
  })
})

describe('bank account, PIN, phone, email, link', () => {
  it('takes 9 to 18 digit account numbers and shows only the last 4', () => {
    expect(isValidAccountNumber('5010 0123 4567 4821')).toBe(true)
    expect(isValidAccountNumber('12345678')).toBe(false)
    expect(isValidAccountNumber('1234567890123456789')).toBe(false)
    expect(isValidAccountNumber('50100abc4821')).toBe(false)
    expect(accountLast4('5010 0123 4567 4821')).toBe('4821')
    expect(maskAccountNumber('4821')).toBe('•••• 4821')
  })

  it('takes 6-digit PIN codes that do not start with 0', () => {
    expect(isValidPin('380015')).toBe(true)
    expect(isValidPin('380 015')).toBe(true)
    expect(isValidPin('080015')).toBe(false)
    expect(isValidPin('38001')).toBe(false)
  })

  it('normalises Indian mobile numbers to 10 digits', () => {
    expect(normalisePhone('+91 98250 12345')).toBe('9825012345')
    expect(normalisePhone('09825012345')).toBe('9825012345')
    expect(normalisePhone('919825012345')).toBe('9825012345')
    expect(normalisePhone('5825012345')).toBeNull()
  })

  it('checks emails and Instagram or website links', () => {
    expect(isValidEmail('kiran@kalkistudio.in')).toBe(true)
    expect(isValidEmail('kiran@kalki')).toBe(false)
    expect(isValidLink('@kalki.studio')).toBe(true)
    expect(isValidLink('https://kalkistudio.in/shop')).toBe(true)
    expect(isValidLink('kalki studio')).toBe(false)
  })
})
