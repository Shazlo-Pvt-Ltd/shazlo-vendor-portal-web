import { afterEach } from 'vitest'

export const SHELL_ORIGIN = 'http://localhost:5173'
export const MODULE_ORIGIN = 'http://localhost:5175'

export interface RecordedPost {
  from: 'shell' | 'module'
  /** The target origin argument, exactly as passed. */
  targetOrigin: string
  data: unknown
}

type WindowWithEvents = Window & { MessageEvent: typeof MessageEvent }

/** Delivers a message the way a browser does: with the sender's origin and window (jsdom sets neither). */
export function deliver(target: Window, data: unknown, origin: string, source: Window): void {
  const event = new (target as WindowWithEvents).MessageEvent('message', { data })
  Object.defineProperty(event, 'origin', { value: origin })
  Object.defineProperty(event, 'source', { value: source })
  target.dispatchEvent(event)
}

let pending = 0
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Waits until every message in flight (and the replies they cause) has been delivered. */
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
 * A page (the "shell") and an iframe in it (the module's window), with a `postMessage` between them that
 * works like a browser's: it arrives later, carries the sender's origin and window, is delivered only
 * when the target origin is the receiver's, and is recorded in `posts` so a test can see what was sent.
 */
export function createFrames() {
  const moduleFrame = document.createElement('iframe')
  document.body.append(moduleFrame)
  const moduleWindow = moduleFrame.contentWindow!
  // The real page window: under vitest the global `window` is a copy, and `iframe.contentWindow.parent`
  // is what a framed module posts to.
  const shellWindow = moduleWindow.parent
  const posts: RecordedPost[] = []

  const original = Object.getOwnPropertyDescriptor(shellWindow, 'postMessage')
  const install = (receiver: Window, receiverOrigin: string, sender: Window, senderOrigin: string, from: RecordedPost['from']) => {
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
    if (original) Object.defineProperty(shellWindow, 'postMessage', original)
    else delete (shellWindow as { postMessage?: unknown }).postMessage
  })

  return { moduleFrame, moduleWindow, shellWindow, posts, frameDocument: moduleWindow.document }
}
