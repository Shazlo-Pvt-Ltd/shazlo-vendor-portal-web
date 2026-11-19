/** The most the API accepts for a price, in paise (`maximum` of `price_min_paise`). */
export const MAX_PAISE = 1_000_000_000_000

const AMOUNT = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/

/**
 * Turns what a vendor typed in rupees ("99.90", "1,000", "1000.5") into an exact whole number of
 * paise, using integer arithmetic only: 99.90 * 100 is 9989.999999999998 in floating point, and a
 * price must never be off by a paisa. Returns null for anything that is not a plain amount with at
 * most two decimals, or that is above {@link MAX_PAISE}.
 */
export function rupeesToPaise(input: string): number | null {
  const text = input.trim().replace(/\s/g, '')
  if (!AMOUNT.test(text)) {
    return null
  }
  const [whole = '', fraction = ''] = text.replace(/,/g, '').split('.')
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0')
  if (paise > BigInt(MAX_PAISE)) {
    return null
  }
  return Number(paise)
}

/** Whole paise as the rupees a vendor types: 99900 is "999", 99950 is "999.50", 10 is "0.10". */
export function paiseToRupees(paise: number): string {
  const whole = Math.trunc(paise / 100)
  const rest = paise % 100
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, '0')}`
}
