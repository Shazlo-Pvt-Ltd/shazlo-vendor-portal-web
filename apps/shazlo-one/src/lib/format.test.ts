import { describe, expect, it } from 'vitest'
import { formatCount, formatDate, formatINR, formatRelative, payout } from './format'

describe('formatINR', () => {
  it('formats paise as rupees with Indian grouping', () => {
    expect(formatINR(249_900)).toBe('₹2,499')
    expect(formatINR(12_500_000)).toBe('₹1,25,000')
    expect(formatINR(0)).toBe('₹0')
  })

  it('keeps paise when the amount is not whole rupees', () => {
    expect(formatINR(249_950)).toBe('₹2,499.50')
  })

  it('shows a dash for a missing price', () => {
    expect(formatINR(null)).toBe('—')
    expect(formatINR(undefined)).toBe('—')
  })
})

describe('formatCount', () => {
  it('prints zero and groups thousands the Indian way', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(125_000)).toBe('1,25,000')
    expect(formatCount(null)).toBe('—')
  })
})

describe('dates', () => {
  const now = new Date('2026-10-31T12:00:00+05:30')

  it('writes a calendar date the way sellers read it', () => {
    expect(formatDate('2026-10-14T09:00:00+05:30')).toBe('14 Oct 2026')
  })

  it('describes recent times relative to now', () => {
    expect(formatRelative('2026-10-31T11:59:40+05:30', now)).toBe('Just now')
    expect(formatRelative('2026-10-31T11:20:00+05:30', now)).toBe('40 min ago')
    expect(formatRelative('2026-10-31T10:00:00+05:30', now)).toBe('2 h ago')
    expect(formatRelative('2026-10-30T15:00:00+05:30', now)).toBe('Yesterday')
    expect(formatRelative('2026-10-21T15:00:00+05:30', now)).toBe('21 Oct')
    expect(formatRelative('2025-12-21T15:00:00+05:30', now)).toBe('21 Dec 2025')
  })
})

describe('payout', () => {
  it('takes the commission off the selling price', () => {
    expect(payout(249_900, 1500)).toEqual({ commission: 37_485, receive: 212_415 })
  })

  it('rounds commission to whole paise', () => {
    expect(payout(99_999, 1500).commission).toBe(15_000)
  })
})
