import { MAX_MESSAGE_BYTES } from './constants'

const encoder = new TextEncoder()

/**
 * Whether a message is within the 64 KB limit, measured as the JSON it would be. Anything that
 * cannot be written as JSON (a cycle, a BigInt, a hostile getter) counts as too large: it is not a
 * message either end would have sent.
 */
export function isWithinSizeLimit(data: unknown, limit: number = MAX_MESSAGE_BYTES): boolean {
  try {
    const json = JSON.stringify(data)
    if (json === undefined) return true
    // Cheap bound first: UTF-8 is at most three bytes per UTF-16 unit.
    if (json.length > limit) return false
    if (json.length * 3 <= limit) return true
    return encoder.encode(json).length <= limit
  } catch {
    return false
  }
}
