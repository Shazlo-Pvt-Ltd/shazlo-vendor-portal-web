import { newMessageId, PROTOCOL } from '@shazlo/shell-protocol'
import { act } from '@testing-library/react'

// The shell's tests play the module's side by hand: a message on the wire, delivered to the page the
// way a browser delivers one, with the sender's origin and window. jsdom's own postMessage sets
// neither, and the shell's channel trusts a message only when both are the module's.

export type WireMessage = { protocol: typeof PROTOCOL; v: number; type: string; id: string; replyTo?: string; sentAt: number; payload: unknown }

/** A well-formed message from a module (override any envelope field with `extra`). */
export function moduleMessage(type: string, payload: unknown, extra: Partial<WireMessage> = {}): WireMessage {
  return { protocol: PROTOCOL, v: 1, type, id: newMessageId(), sentAt: Date.now(), payload, ...extra }
}

type WindowWithEvents = Window & { MessageEvent: typeof MessageEvent }

/** Delivers `data` to `target` as a browser would: a message event with this origin and source. */
export function deliver(target: Window, data: unknown, origin: string, source: unknown): void {
  const event = new (target as WindowWithEvents).MessageEvent('message', { data })
  Object.defineProperty(event, 'origin', { value: origin })
  Object.defineProperty(event, 'source', { value: source })
  target.dispatchEvent(event)
}

/**
 * Sends `data` to the shell as if the module in `iframe` had posted it. `origin` and `source` default
 * to the module's own (its registry origin and its frame's window); pass others to play an attacker.
 */
export function postFromFrame(iframe: HTMLIFrameElement, data: unknown, { origin, source }: { origin: string; source?: unknown }) {
  // The page the frame is in: `contentWindow.parent` is the window the shell listens on.
  const page = iframe.contentWindow!.parent
  act(() => deliver(page, data, origin, source === undefined ? iframe.contentWindow : source))
}
