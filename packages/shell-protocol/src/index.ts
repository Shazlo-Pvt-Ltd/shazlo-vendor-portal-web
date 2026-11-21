import { z } from 'zod'

// ADR 0001: the postMessage protocol between the Shazlo One shell and each module iframe.
// Both sides drop anything that is not exactly this protocol, from exactly the expected origin and window.

export const PROTOCOL = 'shazlo-one'
export const CURRENT_VERSION = 1
// The shell supports the current and the previous version (ADR 0001 §6).
export const SHELL_VERSIONS = [CURRENT_VERSION] as const
export const MAX_MESSAGE_BYTES = 64 * 1024

const user = z.object({ id: z.string().min(1), email: z.string(), roles: z.array(z.string()), name: z.string().optional() })
const modulePath = z.string().regex(/^\/(?!\/)/, 'paths are module-relative')

const shellToModule = {
  auth: z.object({ accessToken: z.string().min(1), expiresAt: z.number().int(), user, locale: z.string().optional() }),
  navigate: z.object({ path: modulePath }),
  error: z.object({ code: z.string(), message: z.string() }),
}

const moduleToShell = {
  ready: z.object({ module: z.string().min(1), supportedVersions: z.array(z.number().int()).min(1), moduleVersion: z.string() }),
  title: z.object({ path: modulePath, title: z.string().min(1).max(200) }),
  'token:request': z.object({ reason: z.enum(['expired', 'unauthorized']) }),
  logout: z.object({ reason: z.string().optional() }),
  toast: z.object({ level: z.enum(['info', 'success', 'warning', 'error']), message: z.string().min(1).max(280), durationMs: z.number().int().positive().optional() }),
  error: z.object({ code: z.string(), message: z.string(), fatal: z.boolean() }),
}

type ShellPayloads = { [K in keyof typeof shellToModule]: z.infer<(typeof shellToModule)[K]> }
type ModulePayloads = { [K in keyof typeof moduleToShell]: z.infer<(typeof moduleToShell)[K]> }
// `error` exists in both directions with different payloads.
type Payloads = Omit<ShellPayloads & ModulePayloads, 'error'> & { error: ShellPayloads['error'] | ModulePayloads['error'] }

export type MessageType = keyof Payloads
export type Message<T extends MessageType = MessageType> = {
  protocol: typeof PROTOCOL
  v: number
  type: T
  id: string
  replyTo?: string
  sentAt: number
  payload: Payloads[T]
}
type Typed<T extends string, P> = Omit<Message, 'type' | 'payload'> & { type: T; payload: P }
export type ShellMessage = { [K in keyof ShellPayloads]: Typed<K, ShellPayloads[K]> }[keyof ShellPayloads]
export type ModuleMessage = { [K in keyof ModulePayloads]: Typed<K, ModulePayloads[K]> }[keyof ModulePayloads]
export type AuthPayload = ShellPayloads['auth']

export function createMessage<T extends MessageType>(type: T, payload: Payloads[T], replyTo?: string): Message<T> {
  return { protocol: PROTOCOL, v: CURRENT_VERSION, type, id: crypto.randomUUID(), ...(replyTo ? { replyTo } : {}), sentAt: Date.now(), payload }
}

const envelope = z.object({
  protocol: z.literal(PROTOCOL),
  v: z.number().int(),
  type: z.string(),
  id: z.string().min(1).max(64),
  replyTo: z.string().max(64).optional(),
  sentAt: z.number(),
  payload: z.unknown(),
})

// `from` names the sender: 'module' for messages the shell receives, 'shell' for what a module receives.
export function parseMessage(raw: unknown, from: 'shell'): ShellMessage | null
export function parseMessage(raw: unknown, from: 'module'): ModuleMessage | null
export function parseMessage(raw: unknown, from: 'shell' | 'module'): Message | null {
  try {
    if (JSON.stringify(raw)?.length > MAX_MESSAGE_BYTES) return null
  } catch {
    return null
  }
  const env = envelope.safeParse(raw)
  if (!env.success || !(SHELL_VERSIONS as readonly number[]).includes(env.data.v)) return null
  const schemas: Record<string, z.ZodType> = from === 'shell' ? shellToModule : moduleToShell
  const schema = Object.hasOwn(schemas, env.data.type) ? schemas[env.data.type] : undefined
  const payload = schema?.safeParse(env.data.payload)
  if (!payload?.success) return null
  return { ...env.data, payload: payload.data } as Message
}

// The module registry stores exact origins only; wildcards and patterns are refused (ADR 0001 §4).
export function exactOrigin(url: string): string {
  if (url.includes('*')) throw new Error(`Module origins must be exact, got ${url}`)
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    throw new Error(`Not a URL: ${url}`)
  }
  if (origin === 'null') throw new Error(`Not an http(s) origin: ${url}`)
  return origin
}

export function sendTo(target: Window, origin: string, message: Message) {
  if (!origin || origin === '*') throw new Error('postMessage needs an exact target origin, never "*"')
  target.postMessage(message, origin)
}

export function pickVersion(supported: readonly number[]): number | null {
  const common = supported.filter((v) => (SHELL_VERSIONS as readonly number[]).includes(v))
  return common.length ? Math.max(...common) : null
}

function warn(reason: string) {
  const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV
  if (dev) console.warn(`[shell-protocol] dropped a message: ${reason}`)
}

export function listenAsShell({ origin, source, onMessage }: { origin: string; source: () => Window | null | undefined; onMessage: (message: ModuleMessage) => void }) {
  const handler = (event: MessageEvent) => {
    if (event.origin !== origin) return
    if (!source() || event.source !== source()) return warn('wrong source window')
    const message = parseMessage(event.data, 'module')
    if (!message) return warn('not a valid module message')
    onMessage(message)
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}

export function listenAsModule({ shellOrigin, onMessage }: { shellOrigin: string; onMessage: (message: ShellMessage) => void }) {
  const handler = (event: MessageEvent) => {
    if (event.origin !== shellOrigin || event.source !== window.parent) return
    const message = parseMessage(event.data, 'shell')
    if (!message) return warn('not a valid shell message')
    onMessage(message)
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}
