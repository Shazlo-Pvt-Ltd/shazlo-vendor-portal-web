import type { PROTOCOL, TOAST_LEVELS, TOKEN_REQUEST_REASONS } from './constants'

/** Every message is one of these: `{protocol, v, type, id, replyTo?, sentAt, payload}`. */
export interface Envelope<T extends string, P> {
  protocol: typeof PROTOCOL
  v: number
  type: T
  /** Unique per message (a UUID). */
  id: string
  /** The `id` of the message this one answers. */
  replyTo?: string
  /** Milliseconds since the epoch; informational only. */
  sentAt: number
  payload: P
}

export interface UserInfo {
  id: string
  email: string
  roles: string[]
}

export type ToastLevel = (typeof TOAST_LEVELS)[number]
export type TokenRequestReason = (typeof TOKEN_REQUEST_REASONS)[number]

// --- shell to module ---------------------------------------------------------------------------

export interface AuthPayload {
  accessToken: string
  /** Epoch **seconds**. */
  expiresAt: number
  user: UserInfo
  locale?: string
}
export interface NavigatePayload {
  /** Starts with `/`; relative to the module. */
  path: string
}
export interface ShellErrorPayload {
  code: string
  message: string
}

export type AuthMessage = Envelope<'auth', AuthPayload>
export type NavigateMessage = Envelope<'navigate', NavigatePayload>
export type ShellErrorMessage = Envelope<'error', ShellErrorPayload>
export type ShellToModule = AuthMessage | NavigateMessage | ShellErrorMessage

// --- module to shell ---------------------------------------------------------------------------

export interface ReadyPayload {
  module: string
  supportedVersions: number[]
  moduleVersion: string
}
export interface TitlePayload {
  path: string
  title: string
}
export interface TokenRequestPayload {
  reason: TokenRequestReason
}
export interface LogoutPayload {
  reason?: string
}
export interface ToastPayload {
  level: ToastLevel
  /** Plain text, never HTML. */
  message: string
  durationMs?: number
}
export interface ModuleErrorPayload {
  code: string
  message: string
  fatal: boolean
}

export type ReadyMessage = Envelope<'ready', ReadyPayload>
export type TitleMessage = Envelope<'title', TitlePayload>
export type TokenRequestMessage = Envelope<'token:request', TokenRequestPayload>
export type LogoutMessage = Envelope<'logout', LogoutPayload>
export type ToastMessage = Envelope<'toast', ToastPayload>
export type ModuleErrorMessage = Envelope<'error', ModuleErrorPayload>
export type ModuleToShell =
  | ReadyMessage
  | TitleMessage
  | TokenRequestMessage
  | LogoutMessage
  | ToastMessage
  | ModuleErrorMessage

/** Why a message was dropped. Logged (type and origin only, never the content) in development builds. */
export type DropReason =
  | 'untrusted_sender'
  | 'too_large'
  | 'not_an_object'
  | 'wrong_protocol'
  | 'wrong_version'
  | 'unknown_type'
  | 'invalid_envelope'
  | 'invalid_payload'
  | 'before_ready'
  | 'stale_auth'
  | 'not_framed'
  | 'handler_error'

export type ParseResult<M> = { ok: true; message: M } | { ok: false; reason: DropReason; type?: string }
