import { describe, expect, it } from 'vitest'
import { commissionText, formatRate, lastSentBack, rateField, rateText, toBps } from './commission'

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

  it('accepts a decimal comma, as some phone keypads type it', () => {
    expect(rateField.safeParse('12,5').success).toBe(true)
    expect(toBps('12,5')).toBe(1250)
    expect(rateField.safeParse(' 7,25 ').success).toBe(true)
    expect(toBps(' 7,25 ')).toBe(725)
    // Not a thousands separator: three decimals is still too many.
    expect(rateField.safeParse('1,000').error?.issues[0]?.message).toBe('Enter a number, like 12 or 12.5.')
    expect(rateField.safeParse('12,5,0').success).toBe(false)
    expect(rateField.safeParse('12.5,0').success).toBe(false)
  })

  it('turns a typed rate into whole basis points without float drift', () => {
    expect(toBps('12.29')).toBe(1229)
    expect(toBps('0.01')).toBe(1)
    expect(toBps('0')).toBe(0)
    expect(toBps('40')).toBe(4000)
    expect(toBps('40.00')).toBe(4000)
    expect(toBps('00012')).toBe(1200)
  })

  it('refuses what Number() would quietly accept', () => {
    for (const text of ['1e1', '0x10', ' ', '.5', '12.', '-1', '+5', 'Infinity', 'NaN', '１２', '12 %', '4 0']) {
      expect(rateField.safeParse(text).success, text).toBe(false)
    }
    expect(rateField.safeParse('40.01').error?.issues[0]?.message).toBe('Enter a commission between 0% and 40%.')
    expect(rateField.safeParse('0').success).toBe(true)
  })

  it('finds who sent a rate back, newest first', () => {
    const history = [
      { at: '2026-11-18T10:00:00Z', event: 'commission_sent_back', by: 'Rahul Desai', note: 'Newest' },
      { at: '2026-11-16T10:00:00Z', event: 'commission_proposed', by: 'Ishita Bose', note: '8%' },
      { at: '2026-11-10T10:00:00Z', event: 'commission_sent_back', by: 'Priya Mehta', note: 'Older' },
    ] as const
    expect(lastSentBack([...history])?.by).toBe('Rahul Desai')
    expect(lastSentBack([...history].reverse())?.by).toBe('Rahul Desai')
    expect(lastSentBack([history[1]])).toBeUndefined()
    expect(lastSentBack([])).toBeUndefined()
  })

  it('compares times, not their spelling', () => {
    // 15:00 in India is 09:30 UTC: earlier than 10:00 UTC, though it sorts later as text.
    const history = [
      { at: '2026-11-18T15:00:00+05:30', event: 'commission_sent_back', by: 'Priya Mehta' },
      { at: '2026-11-18T10:00:00Z', event: 'commission_sent_back', by: 'Rahul Desai' },
    ]
    expect(lastSentBack(history)?.by).toBe('Rahul Desai')
  })

  it('says the rate in force, a waiting proposal, or not set', () => {
    expect(commissionText({ ...base, state: 'agreed', agreed_bps: 1200 })).toBe('12%')
    expect(commissionText({ ...base, state: 'proposed', proposed_bps: 1000 })).toBe('10% proposed')
    expect(commissionText({ ...base, state: 'proposed', agreed_bps: 1200, proposed_bps: 1000 })).toBe('12% · 10% proposed')
    expect(commissionText({ ...base, state: 'sent_back', agreed_bps: 1500, proposed_bps: 800 })).toBe('15%')
    expect(commissionText({ ...base, state: 'not_set' })).toBe('Not set')
  })
})
