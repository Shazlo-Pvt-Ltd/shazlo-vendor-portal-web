import { PROTOCOL_VERSION, TOKEN_REQUEST_INTERVAL_MS, TOKEN_SLACK_SECONDS } from './constants'
import { createDropLogger, type DropLogger } from './logger'
import { assertExactOrigin } from './origin'
import { createEnvelope, newMessageId, postExact } from './post'
import { isWithinSizeLimit } from './size'
import { isTrustedMessage } from './trust'
import type { AuthPayload, TokenRequestReason, ToastPayload, UserInfo } from './types'
import { parseShellToModule, payloadChecks } from './validate'

export interface ModuleClientOptions {
  /**
   * The shell's exact origin, a build-time setting per environment. Pass it through unchanged: a
   * missing value, `*`, a pattern or a non-https origin (outside a development build) throws, so a
   * production build with a bad setting fails at start instead of running unprotected.
   */
  shellOrigin: string | undefined
  /** The module's id, as in the shell's registry. */
  module: string
  moduleVersion: string
  /** Versions this module speaks; defaults to the current one. */
  supportedVersions?: readonly number[]
  /** True in a development build: allows an `http://localhost` shell origin and logs every dropped message. */
  development?: boolean
  /** The module's own window; defaults to the global one. Its `parent` is the shell. */
  window?: Window
  newId?: () => string
  now?: () => number
  logger?: DropLogger
  /** The least time between two `token:request` messages (milliseconds). */
  tokenRequestIntervalMs?: number

  /** A new token (the first one, and every refresh). Replace the token you hold. */
  onAuth?: (auth: AuthPayload) => void
  /** The shell asks the module to show a path. */
  onNavigate?: (path: string) => void
  /** The shell cannot continue, for example `version_unsupported`. */
  onShellError?: (error: { code: string; message: string }) => void
}

export interface ModuleClient {
  /** Sends `ready`. Call it once the page is loaded and the client was created. False when the page is not framed. */
  sendReady: () => boolean
  sendTitle: (path: string, title: string) => boolean
  /** Asks for a new token. At most once every 30 seconds: a call sooner than that sends nothing and returns false. */
  requestToken: (reason: TokenRequestReason) => boolean
  sendLogout: (reason?: string) => boolean
  sendToast: (toast: ToastPayload) => boolean
  sendError: (code: string, message: string, fatal: boolean) => boolean
  /** The access token, kept in memory only; undefined before the first `auth` or once it has expired. */
  getAccessToken: () => string | undefined
  getUser: () => UserInfo | undefined
  /** True when there is no token or it ends within 30 seconds: ask for a new one. */
  needsToken: () => boolean
  dispose: () => void
}

/**
 * A module's end of the channel (ADR 0001). It listens before anything is sent, accepts a message
 * only from the shell's exact origin **and** its parent window, drops everything oversize, malformed,
 * of another protocol or version, or unknown, and only ever posts to the shell's exact origin. It
 * keeps the token in memory only, and ignores an `auth` that expires earlier than the one it holds, so
 * a replayed old message cannot swap in an older token.
 */
export function createModuleClient(options: ModuleClientOptions): ModuleClient {
  const development = options.development === true
  const shellOrigin = assertExactOrigin(options.shellOrigin, { development, name: 'The shell origin (SHELL_ORIGIN)' })
  const own = options.window ?? globalThis.window
  const supported = options.supportedVersions ?? [PROTOCOL_VERSION]
  const logger = options.logger ?? createDropLogger({ development })
  const newId = options.newId ?? newMessageId
  const now = options.now ?? (() => Date.now())
  const interval = options.tokenRequestIntervalMs ?? TOKEN_REQUEST_INTERVAL_MS

  let version = Math.max(...supported)
  let auth: AuthPayload | undefined
  let lastTokenRequest = Number.NEGATIVE_INFINITY
  let disposed = false

  /** The shell's window, or undefined when the page is not framed (its parent is itself). */
  const parentWindow = (): Window | undefined => (own.parent === own ? undefined : own.parent)

  const handle = (event: MessageEvent): void => {
    if (disposed) return
    const parent = parentWindow()
    if (parent === undefined || !isTrustedMessage(event, { origin: shellOrigin, source: parent })) return
    const drop = (reason: Parameters<DropLogger>[0], type?: string) => logger(reason, { type, origin: event.origin })
    if (!isWithinSizeLimit(event.data)) return drop('too_large')
    const parsed = parseShellToModule(event.data, { acceptedVersions: supported })
    if (!parsed.ok) return drop(parsed.reason, parsed.type)
    const { message } = parsed
    try {
      switch (message.type) {
        case 'auth': {
          // A replayed or delayed `auth` must not swap in an older token. The same expiry is a resend.
          if (auth !== undefined && message.payload.expiresAt < auth.expiresAt) return drop('stale_auth', 'auth')
          auth = message.payload
          version = message.v
          options.onAuth?.(message.payload)
          return
        }
        case 'navigate':
          return options.onNavigate?.(message.payload.path)
        case 'error':
          return options.onShellError?.(message.payload)
      }
    } catch {
      logger('handler_error')
    }
  }

  // Listening starts here, at construction, before `sendReady`.
  own.addEventListener('message', handle)

  const send = <T extends string, P>(type: T, payload: P): boolean => {
    if (disposed) return false
    const parent = parentWindow()
    if (parent === undefined) {
      logger('not_framed')
      return false
    }
    return postExact(parent, createEnvelope(type, payload, { version, newId, now }), shellOrigin)
  }

  const checked = <P>(payload: P | undefined, type: string): P | undefined => {
    if (payload === undefined) logger('invalid_payload', { type })
    return payload
  }

  return {
    sendReady() {
      // `ready` names every version the module speaks; the envelope carries its highest.
      return send('ready', { module: options.module, supportedVersions: [...supported], moduleVersion: options.moduleVersion })
    },
    sendTitle(path, title) {
      const payload = checked(payloadChecks.title({ path, title }), 'title')
      return payload !== undefined && send('title', payload)
    },
    requestToken(reason) {
      const payload = checked(payloadChecks.tokenRequest({ reason }), 'token:request')
      if (payload === undefined) return false
      const time = now()
      if (time - lastTokenRequest < interval) return false
      if (!send('token:request', payload)) return false
      lastTokenRequest = time
      return true
    },
    sendLogout(reason) {
      const payload = checked(payloadChecks.logout(reason === undefined ? {} : { reason }), 'logout')
      return payload !== undefined && send('logout', payload)
    },
    sendToast(toast) {
      const payload = checked(payloadChecks.toast(toast), 'toast')
      return payload !== undefined && send('toast', payload)
    },
    sendError(code, message, fatal) {
      const payload = checked(payloadChecks.moduleError({ code, message, fatal }), 'error')
      return payload !== undefined && send('error', payload)
    },
    getAccessToken() {
      if (auth === undefined || now() >= auth.expiresAt * 1000) return undefined
      return auth.accessToken
    },
    getUser() {
      return auth?.user
    },
    needsToken() {
      return auth === undefined || now() >= (auth.expiresAt - TOKEN_SLACK_SECONDS) * 1000
    },
    dispose() {
      disposed = true
      auth = undefined
      own.removeEventListener('message', handle)
    },
  }
}
