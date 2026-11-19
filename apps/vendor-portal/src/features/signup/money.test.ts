import { describe, expect, it } from 'vitest'
import { MAX_PAISE, rupeesToPaise } from './money'

describe('rupeesToPaise', () => {
  it.each([
    ['99.90', 9990],
    ['1000', 100000],
    ['1,000', 100000],
    ['1,000,000', 100000000],
    ['499', 49900],
    ['0', 0],
    ['0.01', 1],
    ['0.1', 10],
    ['19.99', 1999],
    ['1000.5', 100050],
    ['  250 ', 25000],
    ['10000000000', MAX_PAISE],
  ])('turns %s into %i paise', (input, paise) => {
    expect(rupeesToPaise(input)).toBe(paise)
  })

  it('is exact where floating point is not', () => {
    // Floating point gets these wrong: 1.15 * 100 is 114.99999999999999 and 0.29 * 100 is 28.999999999999996.
    expect(1.15 * 100).not.toBe(115)
    expect(0.29 * 100).not.toBe(29)
    expect(Math.round(8.2 * 100)).toBe(820) // rounding hides it, but only when someone remembers to
    expect(rupeesToPaise('99.90')).toBe(9990)
    expect(rupeesToPaise('1.15')).toBe(115)
    expect(rupeesToPaise('0.29')).toBe(29)
  })

  it('always returns a whole number', () => {
    for (let paise = 0; paise < 5000; paise += 7) {
      const text = `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`
      const result = rupeesToPaise(text)
      expect(Number.isInteger(result)).toBe(true)
      expect(result).toBe(paise)
    }
  })

  it.each(['', ' ', 'abc', '12abc', '-5', '+5', '1e3', '.5', '5.', '1.234', '1,00', '1,0000', '1,,000', '₹500', '10000000000.01', '99999999999999999999'])(
    'refuses %j',
    (input) => {
      expect(rupeesToPaise(input)).toBeNull()
    },
  )
})
