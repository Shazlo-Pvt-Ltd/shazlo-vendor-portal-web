import { afterEach } from 'vitest'

export const SHELL_ORIGIN = 'https://one.shazlo.test'
export const MODULE_ORIGIN = 'https://vendor-admin.shazlo.test'
export const OTHER_ORIGIN = 'https://evil.example'

export interface RecordedPost {
  /** Who called `postMessage`. */
  from: 'shell' | 'module'
  /** The target origin argument, exactly as passed. */
  targetOrigin: string
  data: unknown
}

type MessageEventCtor = typeof MessageEvent
type WindowWithEvents = Window & { MessageEvent: MessageEventCtor }

/**
 * Delivers `data` to `target` the way a browser does: a `message` event whose `origin` and `source`
 * are the sender's. jsdom's own `postMessage` sets neither, so the contract tests could not tell a
 * trusted sender from a hostile one without this.
 */
export function deliver(target: Window, data: unknown, origin: string, source: Window | null): void {
  const event = new (target as WindowWithEvents).MessageEvent('message', { data })
  Object.defineProperty(event, 'origin', { value: origin })
  Object.defineProperty(event, 'source', { value: source })
  target.dispatchEvent(event)
}

let pending = 0
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Waits until every message the harness has in flight has been delivered, and the replies those
 * caused too. It waits for the deliveries themselves, not for a fixed time, so a slow machine cannot
 * make a test look at the result too early.
 */
export async function flush(): Promise<void> {
  do {
    await tick()
  } while (pending > 0)
  await tick()
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

/**
 * The page (the "shell"), an iframe in it (the "module") and a second iframe (an attacker's frame).
 * Posting between the shell and the module works like a browser's: the message arrives later with the
 * sender's origin and window, a target origin that is not the receiver's means it is not delivered,
 * and the data is structured-cloned (a function throws). Every call is recorded in `posts`.
 */
export function createFrames() {
  const moduleFrame = document.createElement('iframe')
  const attackerFrame = document.createElement('iframe')
  document.body.append(moduleFrame, attackerFrame)
  const moduleWindow = moduleFrame.contentWindow!
  // Not the global `window`: under vitest that is a copy of jsdom's, and `iframe.contentWindow.parent`
  // (what a framed module posts to) is the real one.
  const shellWindow = moduleWindow.parent
  const attackerWindow = attackerFrame.contentWindow!
  const posts: RecordedPost[] = []

  const original = Object.getOwnPropertyDescriptor(shellWindow, 'postMessage')
  const install = (
    receiver: Window,
    receiverOrigin: string,
    sender: Window,
    senderOrigin: string,
    from: RecordedPost['from'],
  ) => {
    Object.defineProperty(receiver, 'postMessage', {
      configurable: true,
      writable: true,
      value: (data: unknown, targetOrigin: string) => {
        posts.push({ from, targetOrigin, data })
        const cloned = structuredClone(data)
        if (targetOrigin !== '*' && targetOrigin !== receiverOrigin) return
        pending += 1
        setTimeout(() => {
          try {
            deliver(receiver, cloned, senderOrigin, sender)
          } finally {
            pending -= 1
          }
        }, 0)
      },
    })
  }
  install(moduleWindow, MODULE_ORIGIN, shellWindow, SHELL_ORIGIN, 'shell')
  install(shellWindow, SHELL_ORIGIN, moduleWindow, MODULE_ORIGIN, 'module')

  cleanups.push(() => {
    moduleFrame.remove()
    attackerFrame.remove()
    if (original) Object.defineProperty(shellWindow, 'postMessage', original)
    else delete (shellWindow as { postMessage?: unknown }).postMessage
  })

  return {
    moduleFrame,
    shellWindow,
    moduleWindow,
    attackerWindow,
    posts,
    /** Sends a message to the shell as if `source` at `origin` had posted it. */
    toShell: (data: unknown, origin: string, source: Window | null) => deliver(shellWindow, data, origin, source),
    /** Sends a message to the module as if `source` at `origin` had posted it. */
    toModule: (data: unknown, origin: string, source: Window | null) => deliver(moduleWindow, data, origin, source),
  }
}

let counter = 0
/** A well-formed UUID, distinct per call, for hand-built messages. */
export function uuid(): string {
  counter += 1
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`
}

/** A hand-built envelope. Override any field, or pass `undefined` to leave it out. */
export function envelope(type: string, payload: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const message: Record<string, unknown> = {
    protocol: 'shazlo-one',
    v: 1,
    type,
    id: uuid(),
    sentAt: 1_700_000_000_000,
    payload,
    ...overrides,
  }
  for (const key of Object.keys(message)) if (message[key] === undefined) delete message[key]
  return message
}

export const USER = { id: 'a1', email: 'asha@shazlo.test', roles: ['vendor_reviewer'] }

export function authPayload(overrides: Record<string, unknown> = {}) {
  return { accessToken: 'token-1', expiresAt: 2_000_000_000, user: USER, ...overrides }
}
