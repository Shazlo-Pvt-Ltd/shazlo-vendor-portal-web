/** When the shell sends a module a fresh token, and how it retries (ADR 0001, sections 3 and 7). */

/** A module's token is replaced when this fraction of its life has passed... */
export const REFRESH_AT_FRACTION = 0.8
/** ...or this long before it ends, whichever is sooner. */
export const REFRESH_MARGIN_MS = 30_000
/** After a failed refresh the shell retries after 5, 15 and then every 30 seconds, until the token ends. */
export const REFRESH_BACKOFF_MS: readonly number[] = [5_000, 15_000, 30_000]
/** A module's `token:request` is answered at most this often. */
export const TOKEN_REQUEST_THROTTLE_MS = 30_000

export interface TokenLife {
  /** Epoch milliseconds. */
  issuedAt: number
  /** Epoch milliseconds. */
  expiresAt: number
}

/**
 * The time (epoch milliseconds) to replace a token: at 80% of its own life, or 30 seconds before it ends,
 * whichever comes first. The lead time never exceeds half the token's life, so a very short token (the
 * shortest identity-api allows is 30 seconds) is replaced at its half-life instead of the moment it was
 * issued, which would loop.
 *
 * `life` is the token's own, not the nominal one: a token cut short because the identity token behind
 * it was ending lives less than 5 minutes, and its schedule follows.
 */
export function refreshAt(token: TokenLife): number {
  const life = Math.max(0, token.expiresAt - token.issuedAt)
  const lead = Math.min(Math.max((1 - REFRESH_AT_FRACTION) * life, REFRESH_MARGIN_MS), life / 2)
  return token.expiresAt - lead
}

/** Milliseconds from `now` until the token should be replaced (0 when that time has passed). */
export function refreshDelay(token: TokenLife, now: number): number {
  return Math.max(0, refreshAt(token) - now)
}

/** How long to wait before the next try after `failures` failed ones in a row (0 for the first retry). */
export function backoffDelay(failures: number): number {
  return REFRESH_BACKOFF_MS[Math.min(Math.max(0, failures), REFRESH_BACKOFF_MS.length - 1)]!
}
