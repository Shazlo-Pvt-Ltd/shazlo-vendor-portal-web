import { MAX_MESSAGE_BYTES } from './constants'

const encoder = new TextEncoder()

/**
 * Only plain objects and arrays. `postMessage` can also clone a Map, a Set, an ArrayBuffer, a Blob and
 * so on, which JSON writes as `{}` whatever they hold, so they would slip past the limit. No message of
 * the protocol contains one.
 */
function plainJson(_key: string, value: unknown): unknown {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    if (Object.prototype.toString.call(value) !== '[object Object]') throw new TypeError('not plain JSON')
  }
  return value
}

/**
 * Whether a message is within the 64 KB limit, measured as the JSON it would be. Anything that
 * cannot be written as plain JSON (a cycle, a BigInt, a hostile getter, a Map or a binary buffer)
 * counts as too large: it is not a message either end would have sent.
 */
export function isWithinSizeLimit(data: unknown, limit: number = MAX_MESSAGE_BYTES): boolean {
  try {
    const json = JSON.stringify(data, plainJson)
    if (json === undefined) return true
    // Cheap bound first: UTF-8 is at most three bytes per UTF-16 unit.
    if (json.length > limit) return false
    if (json.length * 3 <= limit) return true
    return encoder.encode(json).length <= limit
  } catch {
    return false
  }
}
