import { expect } from 'vitest'

/**
 * Checks a countdown that a screen starts from a `Retry-After`. The countdown runs on the real
 * clock, so on a busy runner more than a second can pass between the answer and the assertion, and
 * a test that accepts only `(42|41)` then fails although the screen is right.
 *
 * Call it just before the request is sent. The returned check reads the number that `pattern`'s
 * first group captures in `text` and expects it to be the full wait less at most the whole seconds
 * that have really passed since then: never more than the wait, never less than what can be left.
 */
export function countdownClock(retryAfterSeconds: number) {
  const sentAt = Date.now()
  return (text: string | null | undefined, pattern: RegExp): number => {
    const match = pattern.exec(text ?? '')
    expect(match, `no countdown in ${JSON.stringify(text)}`).not.toBeNull()
    const shown = Number(match![1])
    const passed = Math.ceil((Date.now() - sentAt) / 1000)
    expect(shown).toBeLessThanOrEqual(retryAfterSeconds)
    expect(shown).toBeGreaterThanOrEqual(Math.max(1, retryAfterSeconds - passed))
    return shown
  }
}
