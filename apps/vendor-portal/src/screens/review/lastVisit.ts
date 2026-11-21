import { registerSensitiveReset } from '../../security/sensitiveState'

/**
 * When the seller last left Review status, in milliseconds: decisions made after it are marked
 * "new since your last visit" (main's features/submissions/lastVisit.ts). It is only a time, and it
 * lives in memory like the rest of the session (the portal keeps nothing in web storage), so it
 * lasts until the tab is reloaded or the seller signs out. Before the first visit, the sign-in time
 * stands in (see rules.ts).
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
