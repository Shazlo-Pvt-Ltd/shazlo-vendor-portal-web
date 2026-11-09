// Contract from docs/adr/0001-iframe-postmessage-protocol.md. The shell and every module import
// these types and validators so neither side trusts untyped postMessage data.

export const PROTOCOL = 'shazlo-one' as const
export const PROTOCOL_VERSION = 1 as const
export const MAX_MESSAGE_BYTES = 64 * 1024
/** ADR 0001 §7: the shell waits this long for `ready` before showing its error panel. */
export const READY_TIMEOUT_MS = 10_000
export const MAX_READY_RETRIES = 3

export interface Envelope<T extends string, P> {
  protocol: typeof PROTOCOL
  v: number
  type: T
  id: string
  replyTo?: string
  sentAt: number
  payload: P
}

export interface UserInfo {
  id: string
  email: string
  roles: string[]
  /** Display name; an optional addition (ADR 0001 §6: optional fields do not bump `v`). */
  name?: string
}

export type AuthMessage = Envelope<'auth', { accessToken: string; expiresAt: number; user: UserInfo; locale?: string }>
export type NavigateMessage = Envelope<'navigate', { path: string }>
export type ShellErrorMessage = Envelope<'error', { code: string; message: string }>
export type ShellToModule = AuthMessage | NavigateMessage | ShellErrorMessage

export type ReadyMessage = Envelope<'ready', { module: string; supportedVersions: number[]; moduleVersion: string }>
export type TitleMessage = Envelope<'title', { path: string; title: string; breadcrumb?: string[] }>
export type TokenRequestMessage = Envelope<'token:request', { reason: 'expired' | 'unauthorized' }>
export type LogoutMessage = Envelope<'logout', { reason?: string }>
export type ToastLevel = 'info' | 'success' | 'warning' | 'error'
export type ToastMessage = Envelope<'toast', { level: ToastLevel; message: string; durationMs?: number }>
export type ModuleErrorMessage = Envelope<'error', { code: string; message: string; fatal: boolean }>
export type ModuleToShell = ReadyMessage | TitleMessage | TokenRequestMessage | LogoutMessage | ToastMessage | ModuleErrorMessage

/** The shell's registry entry for a module. Origins are exact, never patterns. */
export interface ModuleRegistration {
  id: string
  title: string
  url: string
  origin: string
  requiredRoles: string[]
  supportedVersions: number[]
}

type Payload<M> = M extends Envelope<string, infer P> ? P : never

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.length <= max
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

let counter = 0
function newId() {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c) return c.randomUUID()
  counter += 1
  return `${Date.now().toString(16)}-${counter}`
}

export function createMessage<M extends ShellToModule | ModuleToShell>(type: M['type'], payload: Payload<M>, replyTo?: string): M {
  return { protocol: PROTOCOL, v: PROTOCOL_VERSION, type, id: newId(), sentAt: Date.now(), payload, ...(replyTo && { replyTo }) } as M
}

/** Shape check of the envelope. */
export function isEnvelope(data: unknown): data is Envelope<string, unknown> {
  if (!isObj(data)) return false
  return data.protocol === PROTOCOL && isNum(data.v) && isStr(data.type, 64) && isStr(data.id, 128) && isNum(data.sentAt) && 'payload' in data
}

/** Both sides call this first and drop the message if it returns false (ADR 0001 §4). */
export function isTrustedMessage(event: Pick<MessageEvent, 'origin' | 'source'>, trusted: { origin: string; source: MessageEventSource | null }) {
  return trusted.source !== null && event.origin === trusted.origin && event.source === trusted.source
}

function tooLarge(data: unknown) {
  try {
    return JSON.stringify(data).length > MAX_MESSAGE_BYTES
  } catch {
    return true
  }
}

/** Validates a message a module sent to the shell. Returns null for anything to drop. */
export function parseModuleMessage(data: unknown): ModuleToShell | null {
  if (!isEnvelope(data) || tooLarge(data)) return null
  const p = data.payload
  if (!isObj(p)) return null
  switch (data.type) {
    case 'ready':
      return isStr(p.module, 64) && Array.isArray(p.supportedVersions) && p.supportedVersions.every(isNum) && isStr(p.moduleVersion, 64) ? (data as ReadyMessage) : null
    case 'title':
      return isStr(p.path) && p.path.startsWith('/') && isStr(p.title, 200) && (p.breadcrumb === undefined || (Array.isArray(p.breadcrumb) && p.breadcrumb.every(b => isStr(b, 200)))) ? (data as TitleMessage) : null
    case 'token:request':
      return p.reason === 'expired' || p.reason === 'unauthorized' ? (data as TokenRequestMessage) : null
    case 'logout':
      return p.reason === undefined || isStr(p.reason, 200) ? (data as LogoutMessage) : null
    case 'toast':
      return ['info', 'success', 'warning', 'error'].includes(p.level as string) && isStr(p.message, 280) && (p.durationMs === undefined || isNum(p.durationMs)) ? (data as ToastMessage) : null
    case 'error':
      return isStr(p.code, 64) && isStr(p.message, 500) && typeof p.fatal === 'boolean' ? (data as ModuleErrorMessage) : null
    default:
      return null
  }
}

/** Validates a message the shell sent to a module. Returns null for anything to drop. */
export function parseShellMessage(data: unknown): ShellToModule | null {
  if (!isEnvelope(data) || tooLarge(data)) return null
  const p = data.payload
  if (!isObj(p)) return null
  switch (data.type) {
    case 'auth': {
      const u = p.user
      return isStr(p.accessToken, 8192) && isNum(p.expiresAt) && isObj(u) && isStr(u.id, 128) && isStr(u.email, 320) && Array.isArray(u.roles) && u.roles.every(r => isStr(r, 64))
        ? (data as AuthMessage) : null
    }
    case 'navigate':
      return isStr(p.path) && p.path.startsWith('/') && !p.path.startsWith('//') ? (data as NavigateMessage) : null
    case 'error':
      return isStr(p.code, 64) && isStr(p.message, 500) ? (data as ShellErrorMessage) : null
    default:
      return null
  }
}

/** The shell supports the current and the previous version; pick the highest both sides know. */
export function negotiateVersion(moduleVersions: number[], shellVersions: number[] = [PROTOCOL_VERSION, PROTOCOL_VERSION - 1]) {
  const common = moduleVersions.filter(v => shellVersions.includes(v))
  return common.length ? Math.max(...common) : null
}

/** Exact-origin guard for target origins: never `*`, never a pattern. */
export function assertExactOrigin(origin: string) {
  const u = new URL(origin)
  if (origin === '*' || u.origin !== origin) throw new Error(`Not an exact origin: ${origin}`)
  return origin
}
