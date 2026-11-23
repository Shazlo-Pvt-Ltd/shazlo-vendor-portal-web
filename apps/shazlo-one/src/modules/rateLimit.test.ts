import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rateLimit'

describe('the rate limiter', () => {
  it('allows `max` calls in a window and refuses the rest', () => {
    const clock = 0
    const allow = createRateLimiter({ max: 3, windowMs: 1000, now: () => clock })
    expect([allow(), allow(), allow(), allow(), allow()]).toEqual([true, true, true, false, false])
  })

  it('lets calls through again as old ones leave the window, one at a time', () => {
    let clock = 0
    const allow = createRateLimiter({ max: 2, windowMs: 1000, now: () => clock })
    expect(allow()).toBe(true) // t=0
    clock = 400
    expect(allow()).toBe(true) // t=400
    clock = 999
    expect(allow()).toBe(false)
    clock = 1000 // the first has left, the second has not
    expect(allow()).toBe(true)
    expect(allow()).toBe(false)
    clock = 1400
    expect(allow()).toBe(true)
  })

  it('does not count a refused call, so a flood does not lock it out longer', () => {
    let clock = 0
    const allow = createRateLimiter({ max: 1, windowMs: 1000, now: () => clock })
    expect(allow()).toBe(true)
    for (clock = 1; clock < 1000; clock += 50) expect(allow()).toBe(false)
    clock = 1000
    expect(allow()).toBe(true)
  })

  it('uses the real clock by default', () => {
    const allow = createRateLimiter({ max: 1, windowMs: 60_000 })
    expect(allow()).toBe(true)
    expect(allow()).toBe(false)
  })
})
