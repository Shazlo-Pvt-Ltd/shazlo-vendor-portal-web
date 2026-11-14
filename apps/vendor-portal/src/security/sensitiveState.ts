/**
 * Form state that must not outlive the session (a typed password, a half-filled form). A screen
 * registers a reset function; signing out calls them all. Returns the function that unregisters.
 */
const resets = new Set<() => void>()

export function registerSensitiveReset(reset: () => void): () => void {
  resets.add(reset)
  return () => {
    resets.delete(reset)
  }
}

/** Called when the session ends. One failing reset never stops the others. */
export function clearSensitiveState(): void {
  for (const reset of [...resets]) {
    try {
      reset()
    } catch {
      // Keep clearing: leaving one form filled is worse than a reset that failed.
    }
  }
}
