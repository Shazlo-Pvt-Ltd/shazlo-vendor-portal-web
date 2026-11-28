/** The namespace every message carries, so other scripts that use postMessage cannot collide. */
export const PROTOCOL = 'shazlo-one' as const

/** The current protocol version. Adding an optional field does not bump it; removing or renaming one does. */
export const PROTOCOL_VERSION = 1 as const

/** A message larger than this (as JSON, in bytes) is dropped by both ends and never sent. */
export const MAX_MESSAGE_BYTES = 64 * 1024

/** A toast is plain text, at most this many characters. */
export const MAX_TOAST_MESSAGE_LENGTH = 280

/** A module asks for a new token at most this often (milliseconds). */
export const TOKEN_REQUEST_INTERVAL_MS = 30_000

/** A token this close to its end (seconds) counts as about to expire; also the clock slack. */
export const TOKEN_SLACK_SECONDS = 30

export const TOAST_LEVELS = ['info', 'success', 'warning', 'error'] as const
export const TOKEN_REQUEST_REASONS = ['expired', 'unauthorized'] as const
