/**
 * Both ends call this first and drop the message if it returns false: the message must come from the
 * exact origin **and** from the exact window we expect. The origin alone is not enough (another frame
 * of the same origin could send), and neither is the window alone.
 *
 * A trusted `source` of `null` never matches: an iframe not yet attached has no window, and
 * `null === null` must not make a message trusted.
 */
export function isTrustedMessage(
  event: Pick<MessageEvent, 'origin' | 'source'>,
  trusted: { origin: string; source: MessageEventSource | null },
): boolean {
  if (trusted.source === null || trusted.source === undefined) return false
  if (trusted.origin === '' || trusted.origin === '*' || trusted.origin === 'null') return false
  return event.origin === trusted.origin && event.source === trusted.source
}
