import { describe, expect, it } from 'vitest'
import { REFRESH_BACKOFF_MS, backoffDelay, refreshAt, refreshDelay } from './refreshSchedule'

const life = (seconds: number, issuedAt = 1_000_000) => ({ issuedAt, expiresAt: issuedAt + seconds * 1000 })

describe('when a module token is replaced', () => {
  it.each([
    // [life in seconds, seconds after issue]
    [300, 240], // the real 5-minute token: 80% (240 s) is before 30 s from the end (270 s)
    [900, 720], // a 15-minute token: 80% again
    [100, 70], // 30 s before the end (70 s) is sooner than 80% (80 s)
    [60, 30], // 30 s before the end is half the life here
    [45, 22.5], // the lead is capped at half the life
    [30, 15], // the shortest identity-api allows: its half-life, not the moment it was issued
  ])('a %i second token is replaced %d seconds after it was issued', (seconds, after) => {
    const token = life(seconds)
    expect(refreshAt(token)).toBe(token.issuedAt + after * 1000)
  })

  it('is never before the half-life and never after 80% or 30 seconds from the end, whatever the life', () => {
    for (let seconds = 1; seconds <= 1200; seconds += 7) {
      const token = life(seconds)
      const at = (refreshAt(token) - token.issuedAt) / 1000
      expect(at).toBeGreaterThanOrEqual(seconds / 2 - 1e-9)
      expect(at).toBeLessThanOrEqual(seconds * 0.8 + 1e-9)
      expect(seconds - at).toBeGreaterThanOrEqual(Math.min(30, seconds / 2) - 1e-9)
    }
  })

  it('follows the token’s own life, so a token cut short by its identity token is replaced sooner', () => {
    // Issued with only 100 seconds left on the identity token behind it.
    const cut = life(100)
    const full = life(300)
    expect(refreshAt(cut) - cut.issuedAt).toBeLessThan(refreshAt(full) - full.issuedAt)
  })

  it('counts the delay from now, and is 0 once the time has passed', () => {
    const token = life(300)
    expect(refreshDelay(token, token.issuedAt)).toBe(240_000)
    expect(refreshDelay(token, token.issuedAt + 100_000)).toBe(140_000)
    expect(refreshDelay(token, token.issuedAt + 240_000)).toBe(0)
    expect(refreshDelay(token, token.issuedAt + 10 * 60_000)).toBe(0)
  })

  it('treats a token with no life (or a backwards one) as due at once, without a negative delay', () => {
    expect(refreshDelay({ issuedAt: 5_000, expiresAt: 5_000 }, 5_000)).toBe(0)
    expect(refreshDelay({ issuedAt: 5_000, expiresAt: 1_000 }, 5_000)).toBe(0)
  })
})

describe('retrying a failed refresh', () => {
  it('waits 5 seconds, then 15, then 30, and keeps at 30', () => {
    expect([0, 1, 2, 3, 4, 10, 1000].map(backoffDelay)).toEqual([5_000, 15_000, 30_000, 30_000, 30_000, 30_000, 30_000])
    expect(REFRESH_BACKOFF_MS).toEqual([5_000, 15_000, 30_000])
  })

  it('treats a negative count as the first retry', () => {
    expect(backoffDelay(-3)).toBe(5_000)
  })
})
