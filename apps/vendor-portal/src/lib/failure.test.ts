import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from '../api/errors'
import { failureOf } from './failure'

const api = (status: number, message = 'from the server', retryAfter?: number) => new ApiError({ status, code: 'x', message, retryAfter })

describe('failureOf', () => {
  it('passes on what the network error says', () => {
    expect(failureOf(new NetworkError('network'))).toEqual({ message: 'Could not reach the server. Check your connection and try again.' })
    expect(failureOf(new NetworkError('timeout')).message).toMatch(/took too long/)
  })

  it('asks to wait after too many attempts, for as long as the server said, or a minute', () => {
    expect(failureOf(api(429, 'slow down', 42))).toEqual({ message: 'Too many attempts.', retryAfter: 42 })
    expect(failureOf(api(429)).retryAfter).toBe(60)
  })

  it('never shows a server error from our side as it came', () => {
    expect(failureOf(api(500, 'Traceback (most recent call last)'))).toEqual({ message: 'Something went wrong on our side. Try again in a moment.' })
    expect(failureOf(api(503)).message).toBe('Something went wrong on our side. Try again in a moment.')
  })

  it("keeps the API's own words for other refusals", () => {
    expect(failureOf(api(400, 'This link is not valid any more.')).message).toBe('This link is not valid any more.')
  })

  it('has a plain answer for anything else', () => {
    expect(failureOf(new Error('boom'))).toEqual({ message: 'Something went wrong. Try again.' })
  })
})
