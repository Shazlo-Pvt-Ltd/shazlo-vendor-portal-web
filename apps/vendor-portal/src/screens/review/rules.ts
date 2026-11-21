import type { Schemas } from '../../api/model'
import { reviewCopy } from '../../copy/review'

// Main's Review status rules (features/submissions/rules.ts) on Build 2's review items: what is new
// since the last visit, a rejection that a later submission replaced, and what changed while the
// page was open.

type Item = Schemas['ReviewItem']

/** How often the page asks again while it is open (it also asks when the window regains focus). */
export const REFRESH_MS = 60_000

const time = (iso: string | null | undefined): number | null => {
  const at = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(at) ? null : at
}

/** From when a decision counts as new: the last visit in this tab, else the sign-in. */
export function sinceOf(previousVisit: number | null, lastLoginAt: string | null | undefined): number | null {
  return previousVisit ?? time(lastLoginAt)
}

/** Decided after `since`: a decision the seller has not seen on this page yet. */
export function isNewSince(item: Item, since: number | null): boolean {
  if (since === null || item.state === 'waiting') return false
  const decided = time(item.decided_at)
  return decided !== null && decided > since
}

const sameSubject = (a: Item, b: Item) => a.subject.type === b.subject.type && a.subject.id !== '' && a.subject.id === b.subject.id

/**
 * Whether the same product or brand page was sent again after this one: then this rejection was
 * dealt with already, and "Fix and resubmit" would mislead.
 */
export function isSuperseded(item: Item, items: readonly Item[]): boolean {
  const sent = time(item.submitted_at)
  if (sent === null) return false
  return items.some((other) => other.id !== item.id && sameSubject(other, item) && (time(other.submitted_at) ?? Number.NEGATIVE_INFINITY) > sent)
}

/** The items whose state changed since the last answer, as sentences for a screen reader. */
export function statusChanges(before: ReadonlyMap<string, Item['state']>, items: readonly Item[]): string[] {
  const changes: string[] = []
  for (const item of items) {
    const previous = before.get(item.id)
    if (previous !== undefined && previous !== item.state) changes.push(reviewCopy.announce.change(item.subject.title, reviewCopy.announce.states[item.state]))
  }
  return changes
}
