/**
 * Unsaved form data that must survive a session that ends mid-work. It lives in memory only (a
 * product description is the vendor's own data, but web storage outlives the tab and is readable by
 * any script): a reload loses it, signing in again on the same screen keeps it. A deliberate sign-out
 * drops it.
 */
const drafts = new Map<string, unknown>()

export function saveDraft(key: string, value: unknown): void {
  drafts.set(key, value)
}

/** The saved draft, removed so it is applied once. */
export function takeDraft<T>(key: string): T | undefined {
  const value = drafts.get(key) as T | undefined
  drafts.delete(key)
  return value
}

export function clearDrafts(): void {
  drafts.clear()
}
