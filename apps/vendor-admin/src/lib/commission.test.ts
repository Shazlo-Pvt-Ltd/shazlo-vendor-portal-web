import { describe, expect, it } from 'vitest'
import { commissionText, formatRate, rateField, rateText, toBps } from './commission'

const base = { agreed_bps: null, proposed_bps: null, note: null, updated_at: null }

describe('commission rates', () => {
  it('reads basis points as percentages and back', () => {
    expect(formatRate(1200)).toBe('12%')
    expect(formatRate(1250)).toBe('12.5%')
    expect(rateText(1250)).toBe('12.5')
    expect(rateText(null)).toBe('')
    expect(toBps(' 12.5 ')).toBe(1250)
    expect(toBps('8')).toBe(800)
  })

  it('accepts 0–40% with up to two decimals', () => {
    expect(rateField.safeParse('12').success).toBe(true)
    expect(rateField.safeParse('12.25').success).toBe(true)
    expect(rateField.safeParse('40').success).toBe(true)
    expect(rateField.safeParse('').error?.issues[0]?.message).toBe('Enter the commission, like 12.')
    expect(rateField.safeParse('12%').error?.issues[0]?.message).toBe('Enter a number, like 12 or 12.5.')
    expect(rateField.safeParse('40.5').error?.issues[0]?.message).toBe('Enter a commission between 0% and 40%.')
  })

  it('says the rate in force, a waiting proposal, or not set', () => {
    expect(commissionText({ ...base, state: 'agreed', agreed_bps: 1200 })).toBe('12%')
    expect(commissionText({ ...base, state: 'proposed', proposed_bps: 1000 })).toBe('10% proposed')
    expect(commissionText({ ...base, state: 'proposed', agreed_bps: 1200, proposed_bps: 1000 })).toBe('12% · 10% proposed')
    expect(commissionText({ ...base, state: 'sent_back', agreed_bps: 1500, proposed_bps: 800 })).toBe('15%')
    expect(commissionText({ ...base, state: 'not_set' })).toBe('Not set')
  })
})
