import { MAX_TOAST_MESSAGE_LENGTH, PROTOCOL, TOAST_LEVELS, TOKEN_REQUEST_REASONS } from './constants'
import type {
  AuthPayload,
  DropReason,
  Envelope,
  LogoutPayload,
  ModuleErrorPayload,
  ModuleToShell,
  NavigatePayload,
  ParseResult,
  ReadyPayload,
  ShellErrorPayload,
  ShellToModule,
  TitlePayload,
  ToastPayload,
  TokenRequestPayload,
  UserInfo,
} from './types'
import { isModulePath } from './paths'

/*
 * `postMessage` data is untyped at runtime, so every payload is checked here. Nothing in this file
 * throws on bad input: a check that fails returns `undefined` and the message is dropped. A payload
 * that passes is rebuilt from the fields we know, so unknown fields never reach the caller.
 */

type Fields = Record<string, unknown>

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Control characters other than tab and line feed.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/
// Anything that looks like an HTML tag. A message is rendered as text, but a payload that already
// looks like markup is refused so a careless receiver cannot be talked into rendering it.
const MARKUP = /<\/?[a-z!][^>]*>/i

/** Plain text of `min` to `max` characters with no control characters (a line feed only if `multiline`) and no markup. */
function text(value: unknown, max: number, options: { min?: number; multiline?: boolean; markup?: boolean } = {}): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length < (options.min ?? 1) || value.length > max) return undefined
  if (CONTROL.test(value)) return undefined
  if (!options.multiline && value.includes('\n')) return undefined
  if (options.markup === false && MARKUP.test(value)) return undefined
  return value
}

/** A path inside a module (paths.ts): starts with `/`, is not `//host`, and cannot climb out of the module. */
export { isModulePath }

/**
 * `expiresAt` is epoch **seconds**. Anything past this (the year 2286) is a time in milliseconds sent
 * by mistake: taken as seconds it would look valid for millennia, and the module, which ignores any
 * later `auth` that expires earlier, would then refuse every correct one.
 */
const MAX_EXPIRES_AT_SECONDS = 10_000_000_000

const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1

// --- payload checks ----------------------------------------------------------------------------

function userInfo(value: unknown): UserInfo | undefined {
  if (!isObject(value)) return undefined
  const id = text(value.id, 128)
  const email = text(value.email, 320, { min: 3 })
  if (id === undefined || email === undefined || !email.includes('@')) return undefined
  if (!Array.isArray(value.roles) || value.roles.length > 50) return undefined
  const roles: string[] = []
  for (const role of value.roles) {
    const name = text(role, 64)
    if (name === undefined) return undefined
    roles.push(name)
  }
  return { id, email, roles }
}

export const payloadChecks = {
  auth(value: unknown): AuthPayload | undefined {
    if (!isObject(value)) return undefined
    const accessToken = text(value.accessToken, 8192)
    const user = userInfo(value.user)
    // Epoch seconds: a finite positive number, not a string, a date or milliseconds.
    if (accessToken === undefined || user === undefined) return undefined
    if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) || value.expiresAt <= 0) return undefined
    if (value.expiresAt > MAX_EXPIRES_AT_SECONDS) return undefined
    const result: AuthPayload = { accessToken, expiresAt: value.expiresAt, user }
    if (value.locale !== undefined) {
      const locale = text(value.locale, 35)
      if (locale === undefined) return undefined
      result.locale = locale
    }
    return result
  },

  navigate(value: unknown): NavigatePayload | undefined {
    if (!isObject(value) || !isModulePath(value.path)) return undefined
    return { path: value.path }
  },

  shellError(value: unknown): ShellErrorPayload | undefined {
    if (!isObject(value)) return undefined
    const code = text(value.code, 64)
    const message = text(value.message, 500)
    return code === undefined || message === undefined ? undefined : { code, message }
  },

  ready(value: unknown): ReadyPayload | undefined {
    if (!isObject(value)) return undefined
    const module = text(value.module, 64)
    const moduleVersion = text(value.moduleVersion, 64)
    if (module === undefined || moduleVersion === undefined) return undefined
    if (!Array.isArray(value.supportedVersions) || value.supportedVersions.length < 1 || value.supportedVersions.length > 20) {
      return undefined
    }
    if (!value.supportedVersions.every(positiveInteger)) return undefined
    return { module, supportedVersions: [...(value.supportedVersions as number[])], moduleVersion }
  },

  title(value: unknown): TitlePayload | undefined {
    if (!isObject(value) || !isModulePath(value.path)) return undefined
    const title = text(value.title, 200, { markup: false })
    return title === undefined ? undefined : { path: value.path, title }
  },

  tokenRequest(value: unknown): TokenRequestPayload | undefined {
    if (!isObject(value)) return undefined
    const reason = TOKEN_REQUEST_REASONS.find((candidate) => candidate === value.reason)
    return reason === undefined ? undefined : { reason }
  },

  logout(value: unknown): LogoutPayload | undefined {
    if (!isObject(value)) return undefined
    if (value.reason === undefined) return {}
    const reason = text(value.reason, 200)
    return reason === undefined ? undefined : { reason }
  },

  toast(value: unknown): ToastPayload | undefined {
    if (!isObject(value)) return undefined
    const level = TOAST_LEVELS.find((candidate) => candidate === value.level)
    const message = text(value.message, MAX_TOAST_MESSAGE_LENGTH, { multiline: true, markup: false })
    if (level === undefined || message === undefined) return undefined
    const result: ToastPayload = { level, message }
    if (value.durationMs !== undefined) {
      if (typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > 60_000) {
        return undefined
      }
      result.durationMs = value.durationMs
    }
    return result
  },

  moduleError(value: unknown): ModuleErrorPayload | undefined {
    if (!isObject(value)) return undefined
    const code = text(value.code, 64)
    const message = text(value.message, 500)
    if (code === undefined || message === undefined || typeof value.fatal !== 'boolean') return undefined
    return { code, message, fatal: value.fatal }
  },
}

// --- envelopes ---------------------------------------------------------------------------------

interface RawEnvelope {
  v: number
  type: string
  id: string
  replyTo?: string
  sentAt: number
  payload: unknown
}

/** A type name that is safe to put in a log line, or undefined. */
function loggableType(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 40 && /^[\w:.-]+$/.test(value) ? value : undefined
}

function fail(reason: DropReason, type?: unknown): { ok: false; reason: DropReason; type?: string } {
  const safe = loggableType(type)
  return safe === undefined ? { ok: false, reason } : { ok: false, reason, type: safe }
}

/**
 * The envelope's shape, as ADR 0001 describes it: `protocol`, an integer `v`, a string `type`, a UUID
 * `id`, an optional UUID `replyTo`, a numeric `sentAt` and a `payload`. It does not look at the payload.
 */
export function isEnvelope(data: unknown): data is Envelope<string, unknown> {
  try {
    return readEnvelope(data).ok
  } catch {
    return false
  }
}

function readEnvelope(data: unknown): { ok: true; envelope: RawEnvelope } | { ok: false; reason: DropReason; type?: string } {
  if (!isObject(data)) return fail('not_an_object')
  if (data.protocol !== PROTOCOL) return fail('wrong_protocol')
  if (!positiveInteger(data.v)) return fail('invalid_envelope', data.type)
  if (typeof data.type !== 'string') return fail('invalid_envelope')
  if (typeof data.id !== 'string' || !UUID.test(data.id)) return fail('invalid_envelope', data.type)
  if (data.replyTo !== undefined && (typeof data.replyTo !== 'string' || !UUID.test(data.replyTo))) {
    return fail('invalid_envelope', data.type)
  }
  if (typeof data.sentAt !== 'number' || !Number.isFinite(data.sentAt) || data.sentAt < 0) return fail('invalid_envelope', data.type)
  if (!('payload' in data)) return fail('invalid_envelope', data.type)
  const envelope: RawEnvelope = { v: data.v, type: data.type, id: data.id, sentAt: data.sentAt, payload: data.payload }
  if (data.replyTo !== undefined) envelope.replyTo = data.replyTo as string
  return { ok: true, envelope }
}

function build<T extends string, P>(envelope: RawEnvelope, type: T, payload: P): Envelope<T, P> {
  const message: Envelope<T, P> = { protocol: PROTOCOL, v: envelope.v, type, id: envelope.id, sentAt: envelope.sentAt, payload }
  if (envelope.replyTo !== undefined) message.replyTo = envelope.replyTo
  return message
}

export interface ParseOptions {
  /** The versions this receiver speaks. A message with another `v` is dropped (except `ready`, see below). */
  acceptedVersions: readonly number[]
}

/**
 * What the **shell** reads: a message from a module. Never throws. Wrong protocol, a version we do not
 * speak, an unknown type, a bad envelope or a bad payload give `{ ok: false, reason }`. Unknown fields
 * are dropped from the result.
 *
 * `ready` is the one message read whatever its `v`: the shell has to see which versions the module
 * speaks to answer `version_unsupported` instead of silence.
 */
export function parseModuleToShell(data: unknown, options: ParseOptions): ParseResult<ModuleToShell> {
  try {
    const read = readEnvelope(data)
    if (!read.ok) return read
    const { envelope } = read
    if (envelope.type !== 'ready' && !options.acceptedVersions.includes(envelope.v)) return fail('wrong_version', envelope.type)
    switch (envelope.type) {
      case 'ready': {
        const payload = payloadChecks.ready(envelope.payload)
        return payload ? { ok: true, message: build(envelope, 'ready', payload) } : fail('invalid_payload', 'ready')
      }
      case 'title': {
        const payload = payloadChecks.title(envelope.payload)
        return payload ? { ok: true, message: build(envelope, 'title', payload) } : fail('invalid_payload', 'title')
      }
      case 'token:request': {
        const payload = payloadChecks.tokenRequest(envelope.payload)
        return payload ? { ok: true, message: build(envelope, 'token:request', payload) } : fail('invalid_payload', 'token:request')
      }
      case 'logout': {
        const payload = payloadChecks.logout(envelope.payload)
        return payload ? { ok: true, message: build(envelope, 'logout', payload) } : fail('invalid_payload', 'logout')
      }
      case 'toast': {
        const payload = payloadChecks.toast(envelope.payload)
        return payload ? { ok: true, message: build(envelope, 'toast', payload) } : fail('invalid_payload', 'toast')
      }
      case 'error': {
        const payload = payloadChecks.moduleError(envelope.payload)
        return payload ? { ok: true, message: build(envelope, 'error', payload) } : fail('invalid_payload', 'error')
      }
      default:
        return fail('unknown_type', envelope.type)
    }
  } catch {
    // A hostile object (a throwing getter, a revoked proxy) is just a bad message.
    return fail('invalid_envelope')
  }
}

/**
 * What a **module** reads: a message from the shell. Same rules as {@link parseModuleToShell}, with
 * one mirror-image exception: `error` is read whatever its `v`. The shell answers a module it shares
 * no version with by sending `version_unsupported`, and the module could not read that if it only
 * accepted its own versions.
 */
export function parseShellToModule(data: unknown, options: ParseOptions): ParseResult<ShellToModule> {
  try {
    const read = readEnvelope(data)
    if (!read.ok) return read
    const { envelope } = read
    if (envelope.type !== 'error' && !options.acceptedVersions.includes(envelope.v)) return fail('wrong_version', envelope.type)
    switch (envelope.type) {
      case 'auth': {
        const payload = payloadChecks.auth(envelope.payload)
        return payload ? { ok: true, message: build(envelope, 'auth', payload) } : fail('invalid_payload', 'auth')
      }
      case 'navigate': {
        const payload = payloadChecks.navigate(envelope.payload)
        return payload ? { ok: true, message: build(envelope, 'navigate', payload) } : fail('invalid_payload', 'navigate')
      }
      case 'error': {
        const payload = payloadChecks.shellError(envelope.payload)
        return payload ? { ok: true, message: build(envelope, 'error', payload) } : fail('invalid_payload', 'error')
      }
      default:
        return fail('unknown_type', envelope.type)
    }
  } catch {
    return fail('invalid_envelope')
  }
}
