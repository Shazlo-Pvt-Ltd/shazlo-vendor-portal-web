import { describe, expect, it } from 'vitest'
import { createQueryClient, shouldRetry } from './queryClient'

describe('shouldRetry', () => {
  it('does not retry a 4xx answer', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(shouldRetry(0, { status })).toBe(false)
    }
  })

  it('retries a 5xx answer and a network error, but only twice', () => {
    expect(shouldRetry(0, { status: 503 })).toBe(true)
    expect(shouldRetry(1, { status: 500 })).toBe(true)
    expect(shouldRetry(2, { status: 500 })).toBe(false)
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldRetry(2, new TypeError('Failed to fetch'))).toBe(false)
  })

  it('treats an error without a numeric status as a network error', () => {
    expect(shouldRetry(0, { status: 'oops' })).toBe(true)
    expect(shouldRetry(0, null)).toBe(true)
  })
})

describe('createQueryClient', () => {
  it('sets the defaults every query inherits', () => {
    const options = createQueryClient().getDefaultOptions().queries
    expect(options?.staleTime).toBe(30_000)
    expect(options?.refetchOnWindowFocus).toBe(true)
    expect(options?.retry).toBe(shouldRetry)
  })

  it('gives each client its own cache', () => {
    expect(createQueryClient()).not.toBe(createQueryClient())
  })
})
