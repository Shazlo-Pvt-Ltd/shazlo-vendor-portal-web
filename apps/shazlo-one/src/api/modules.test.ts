import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from './context'
import { ApiError } from './http'
import { lookUpAdminNames, MODULE_FETCH_TIMEOUT_MS, withTimeout } from './modules'

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

// The names behind every module's activity share one cache (the Home tests cover one module's refreshes).
describe('lookUpAdminNames', () => {
  // identity-api answers each call in turn: the names it knows among those asked for, or a failure.
  function identityAnswering(...answers: (Record<string, string> | Error)[]) {
    const call = vi.fn(() => {
      const next = answers.shift()
      if (next instanceof Error) return Promise.reject(next)
      return Promise.resolve({ items: Object.entries(next ?? {}).map(([id, display_name]) => ({ id, display_name })) })
    })
    return { call, context: { identity: { call } as unknown as AppContext['identity'], queryClient: new QueryClient() } }
  }

  it("keeps what each module's lookup found, so one module does not undo another's names", async () => {
    const { call, context } = identityAnswering({ a: 'Priya Mehta' }, { b: 'Naman Sinha' }, new Error('down'))
    expect(await lookUpAdminNames(context, ['a'])).toEqual({ a: 'Priya Mehta' })
    expect(await lookUpAdminNames(context, ['b'])).toEqual({ a: 'Priya Mehta', b: 'Naman Sinha' })
    // Both known and fresh: no new lookup.
    expect(await lookUpAdminNames(context, ['a', 'b'])).toEqual({ a: 'Priya Mehta', b: 'Naman Sinha' })
    expect(call).toHaveBeenCalledTimes(2)
    // Someone new while identity-api is down: they read as "a former admin" for now, and the others keep their names.
    expect(await lookUpAdminNames(context, ['a', 'c'])).toEqual({ a: 'Priya Mehta', b: 'Naman Sinha' })
    expect(call).toHaveBeenCalledTimes(3)
  })

  it('leaves out an admin identity-api does not know', async () => {
    const { context } = identityAnswering({ a: 'Priya Mehta' })
    expect(await lookUpAdminNames(context, ['a', 'gone'])).toEqual({ a: 'Priya Mehta' })
  })
})
