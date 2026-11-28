import { createModuleClient, type AuthPayload, type ModuleClient } from '@shazlo/shell-protocol'
import { afterEach } from 'vitest'

/** The shell's origin as the module sees it (a development build allows localhost). */
export const SHELL_ORIGIN = 'http://localhost:5173'

export interface RecordedPost {
  from: 'shell' | 'module'
  /** The target origin argument, exactly as passed. */
  targetOrigin: string
  data: unknown
}

type WindowWithEvents = Window & { MessageEvent: typeof MessageEvent }

/** Delivers a message the way a browser does, with the sender's origin and window (jsdom sets neither). */
export function deliver(target: Window, data: unknown, origin: string, source: Window | null): void {
  const event = new (target as WindowWithEvents).MessageEvent('message', { data })
  Object.defineProperty(event, 'origin', { value: origin })
  Object.defineProperty(event, 'source', { value: source })
  target.dispatchEvent(event)
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

/** The frame element the shell rendered, or throws. */
export function currentFrame(): HTMLIFrameElement {
  const frame = document.querySelector('iframe')
  if (frame === null) throw new Error('There is no iframe on the page.')
  return frame
}

/**
 * Gives the shell and a frame the shell has already created a browser-like `postMessage`: it arrives
 * a moment later (a microtask, so fake timers do not stall it), carries the sender's origin and
 * window, and is delivered only when the target origin is the receiver's. Every call is recorded.
 */
export function bridge(iframe: HTMLIFrameElement, moduleOrigin: string) {
  const frameWindow = iframe.contentWindow!
  // The real page window; `frameWindow.parent` is what a framed module posts to.
  const shellWindow = frameWindow.parent
  const posts: RecordedPost[] = []

  const originals = new Map<Window, PropertyDescriptor | undefined>()
  const install = (receiver: Window, receiverOrigin: string, sender: Window, senderOrigin: string, from: RecordedPost['from']) => {
    if (!originals.has(receiver)) originals.set(receiver, Object.getOwnPropertyDescriptor(receiver, 'postMessage'))
    Object.defineProperty(receiver, 'postMessage', {
      configurable: true,
      writable: true,
      value: (data: unknown, targetOrigin: string) => {
        posts.push({ from, targetOrigin, data })
        const cloned = structuredClone(data)
        if (targetOrigin !== '*' && targetOrigin !== receiverOrigin) return
        queueMicrotask(() => deliver(receiver, cloned, senderOrigin, sender))
      },
    })
  }
  install(frameWindow, moduleOrigin, shellWindow, SHELL_ORIGIN, 'shell')
  install(shellWindow, SHELL_ORIGIN, frameWindow, moduleOrigin, 'module')

  cleanups.push(() => {
    for (const [target, original] of originals) {
      if (original) Object.defineProperty(target, 'postMessage', original)
      else delete (target as { postMessage?: unknown }).postMessage
    }
  })
  return { frameWindow, shellWindow, posts }
}

export interface FakeModule {
  client: ModuleClient
  auths: AuthPayload[]
  errors: Array<{ code: string; message: string }>
  posts: RecordedPost[]
  frameWindow: Window
  shellWindow: Window
}

/** A real module client, running in the frame the shell created, as `vendor-admin` would. */
export function attachModule(
  options: { moduleOrigin: string; supportedVersions?: number[]; module?: string; moduleVersion?: string; iframe?: HTMLIFrameElement },
): FakeModule {
  const iframe = options.iframe ?? currentFrame()
  const { frameWindow, shellWindow, posts } = bridge(iframe, options.moduleOrigin)
  const auths: AuthPayload[] = []
  const errors: Array<{ code: string; message: string }> = []
  const client = createModuleClient({
    shellOrigin: SHELL_ORIGIN,
    window: frameWindow,
    module: options.module ?? 'vendor-admin',
    moduleVersion: options.moduleVersion ?? '1.0.0',
    supportedVersions: options.supportedVersions,
    development: true,
    onAuth: (auth) => auths.push(auth),
    onShellError: (error) => errors.push(error),
  })
  cleanups.push(() => client.dispose())
  return { client, auths, errors, posts, frameWindow, shellWindow }
}

let counter = 0
/** A well-formed `ready` built by hand, for the hostile cases. */
export function readyMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  counter += 1
  return {
    protocol: 'shazlo-one',
    v: 1,
    type: 'ready',
    id: `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`,
    sentAt: 1_700_000_000_000,
    payload: { module: 'vendor-admin', supportedVersions: [1], moduleVersion: '1.0.0' },
    ...overrides,
  }
}

/** A well-formed `token:request` built by hand: the shell must answer it at most once every 30 seconds. */
export function tokenRequestMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  counter += 1
  return {
    protocol: 'shazlo-one',
    v: 1,
    type: 'token:request',
    id: `00000000-0000-4000-8000-${(counter + 100_000).toString(16).padStart(12, '0')}`,
    sentAt: 1_700_000_000_000,
    payload: { reason: 'unauthorized' },
    ...overrides,
  }
}
