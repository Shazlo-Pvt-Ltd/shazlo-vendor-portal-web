import { registerSensitiveReset } from '../../security/sensitiveState'

/**
 * When the vendor last left the submissions page, in milliseconds: the "new since your last
 * visit" marker shows decisions made after it. It is only a time, nothing about the vendor, and it
 * lives in memory like the rest of the session (the portal keeps nothing in web storage), so it
 * lasts until the tab is reloaded or the user signs out.
 */
let lastVisit: number | null = null

registerSensitiveReset(() => {
  lastVisit = null
})

/** When the previous visit ended; null if this is the first one since the tab was loaded. */
export function previousVisit(): number | null {
  return lastVisit
}

/** The page is being left: what is on it now has been seen. */
export function endVisit(now: number = Date.now()): void {
  lastVisit = now
}

/** For tests. */
export function resetLastVisit(): void {
  lastVisit = null
}
