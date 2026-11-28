import { PROTOCOL } from './constants'
import { ProtocolConfigError } from './origin'
import { isWithinSizeLimit } from './size'
import type { Envelope } from './types'

/** A fresh UUID for a message id. `crypto.randomUUID` where there is one, random bytes otherwise. */
export function newMessageId(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  const bytes = new Uint8Array(16)
  webCrypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export interface SendContext {
  version: number
  newId: () => string
  now: () => number
}

export function createEnvelope<T extends string, P>(type: T, payload: P, context: SendContext, replyTo?: string): Envelope<T, P> {
  const message: Envelope<T, P> = { protocol: PROTOCOL, v: context.version, type, id: context.newId(), sentAt: context.now(), payload }
  if (replyTo !== undefined) message.replyTo = replyTo
  return message
}

/**
 * The only place in the protocol that calls `postMessage`, and it always names the exact target
 * origin. `*` (or an empty or opaque origin) is refused here, whatever a caller passes, so no code
 * path can post to every origin. A message over the size limit, or one the browser cannot clone, is
 * not sent. Returns whether the message was handed to the browser.
 */
export function postExact(target: Pick<Window, 'postMessage'> | null | undefined, message: unknown, origin: string): boolean {
  if (origin === '*' || origin === '' || origin === 'null') {
    throw new ProtocolConfigError('A message may only be posted to one exact origin, never "*".')
  }
  if (target === null || target === undefined) return false
  if (!isWithinSizeLimit(message)) return false
  try {
    target.postMessage(message, origin)
    return true
  } catch {
    return false
  }
}
