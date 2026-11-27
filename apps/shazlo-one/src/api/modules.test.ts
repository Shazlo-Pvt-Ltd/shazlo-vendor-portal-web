import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './http'
import { MODULE_FETCH_TIMEOUT_MS, withTimeout } from './modules'

// A module that never answers must not hold the shell: its manifest and summary give up after five
// seconds, as "the module did not answer" (ADR 0011).
describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('gives up after five seconds with an "unreachable" error', async () => {
    vi.useFakeTimers()
    const never = new Promise<string>(() => {})
    const result = withTimeout(never).catch((error: unknown) => error)
    vi.advanceTimersByTime(MODULE_FETCH_TIMEOUT_MS - 1)
    await Promise.resolve()
    vi.advanceTimersByTime(1)
    const error = await result
    expect(MODULE_FETCH_TIMEOUT_MS).toBe(5_000)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 0, code: 'unreachable' })
  })

  it('passes an answer or a failure through untouched', async () => {
    await expect(withTimeout(Promise.resolve('ok'))).resolves.toBe('ok')
    const failure = new Error('refused')
    await expect(withTimeout(Promise.reject(failure))).rejects.toBe(failure)
  })
})
