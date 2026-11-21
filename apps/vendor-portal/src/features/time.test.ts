import { describe, expect, it } from 'vitest'
import { exactTime, relativeTime } from './time'

describe('dates', () => {
  it('says how long ago', () => {
    const now = Date.parse('2026-11-19T12:00:00Z')
    expect(relativeTime('2026-11-19T11:59:30Z', now)).toBe('just now')
    expect(relativeTime('2026-11-19T09:00:00Z', now)).toBe('3 hours ago')
    expect(relativeTime('2026-11-18T12:00:00Z', now)).toBe('yesterday')
    expect(relativeTime('2026-11-05T12:00:00Z', now)).toBe('2 weeks ago')
    expect(relativeTime('nonsense', now)).toBe('')
  })

  it('gives the exact time, and nothing for a value that is not a date', () => {
    expect(exactTime('2026-11-12T09:30:00Z')).toMatch(/12 Nov 2026/)
    expect(exactTime('nonsense')).toBe('')
  })
})
