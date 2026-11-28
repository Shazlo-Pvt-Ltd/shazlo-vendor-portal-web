/**
 * A sliding-window limit: at most `max` calls in any `windowMs`. Each call to the returned function says
 * whether this one is allowed (and counts it if so). The shell uses it so that a module cannot flood the
 * screen with toasts or hammer the browser's history with `title` messages.
 */
export function createRateLimiter(options: { max: number; windowMs: number; now?: () => number }): () => boolean {
  const now = options.now ?? (() => Date.now())
  const allowed: number[] = []
  return () => {
    const time = now()
    while (allowed.length > 0 && time - allowed[0]! >= options.windowMs) allowed.shift()
    if (allowed.length >= options.max) return false
    allowed.push(time)
    return true
  }
}
