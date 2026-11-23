import { PROTOCOL_VERSION } from './constants'
import { createDropLogger, type DropLogger } from './logger'
import { assertExactOrigin } from './origin'
import { createEnvelope, newMessageId, postExact } from './post'
import { isWithinSizeLimit } from './size'
import { isTrustedMessage } from './trust'
import type {
  AuthPayload,
  ModuleErrorPayload,
  ModuleToShell,
  TitlePayload,
  ToastPayload,
  TokenRequestPayload,
  LogoutPayload,
} from './types'
import { parseModuleToShell, payloadChecks } from './validate'
import { negotiateVersion, shellSupportedVersions } from './version'

/** What the shell learns from a module's `ready`. */
export interface ReadyInfo {
  /** The `id` of the `ready` message: pass it to `sendAuth` as `replyTo`. */
  id: string
  module: string
  moduleVersion: string
  supportedVersions: number[]
  /** The version both sides will use. */
  version: number
}

export interface ShellChannelOptions {
  /** The frame to talk to. Create the channel **before** setting its `src`, so an early `ready` is never missed. */
  iframe: HTMLIFrameElement
  /** The module's exact origin, from the registry. */
  origin: string
  /** True in a development build: allows `http://localhost` origins and logs every dropped message. */
  development?: boolean
  /** Versions the shell speaks; defaults to the current and the previous one. */
  supportedVersions?: readonly number[]
  /** The window to listen on; defaults to the iframe's own page. */
  window?: Window
  newId?: () => string
  now?: () => number
  logger?: DropLogger

  onReady?: (info: ReadyInfo) => void
  /** `ready` named versions the shell does not speak. The channel has already answered `version_unsupported`. */
  onVersionUnsupported?: (info: Omit<ReadyInfo, 'version'>) => void
  onTitle?: (payload: TitlePayload, message: { id: string }) => void
  onTokenRequest?: (payload: TokenRequestPayload, message: { id: string }) => void
  onLogout?: (payload: LogoutPayload, message: { id: string }) => void
  onToast?: (payload: ToastPayload, message: { id: string }) => void
  onModuleError?: (payload: ModuleErrorPayload, message: { id: string }) => void
}

export interface ShellChannel {
  /** The version agreed with the module, or undefined before its `ready`. */
  readonly version: number | undefined
  /** Sends `auth`. False when there is no handshake yet, no frame window, or the payload is not valid. */
  sendAuth: (payload: AuthPayload, options?: { replyTo?: string }) => boolean
  sendNavigate: (path: string) => boolean
  sendError: (code: string, message: string) => boolean
  /** Stops listening. Call it when the frame is removed. */
  dispose: () => void
}

/**
 * The shell's end of the channel to one module (ADR 0001). It listens before anything is sent, accepts
 * a message only from the module's exact origin **and** its frame's window, drops everything that is
 * oversize, malformed, of another protocol or version, or unknown, and only ever posts to the module's
 * exact origin. Until the module's `ready` has been accepted nothing else from it is read.
 */
export function createShellChannel(options: ShellChannelOptions): ShellChannel {
  const development = options.development === true
  const origin = assertExactOrigin(options.origin, { development, name: 'The module origin' })
  const supported = options.supportedVersions ?? shellSupportedVersions(PROTOCOL_VERSION)
  const listenOn = options.window ?? options.iframe.ownerDocument.defaultView
  if (listenOn === null || listenOn === undefined) throw new Error('The shell channel needs a window to listen on.')
  const logger = options.logger ?? createDropLogger({ development })
  const newId = options.newId ?? newMessageId
  const now = options.now ?? (() => Date.now())

  let version: number | undefined
  let disposed = false

  const send = <T extends string, P>(type: T, payload: P, replyTo?: string): boolean => {
    if (disposed || version === undefined) return false
    const message = createEnvelope(type, payload, { version, newId, now }, replyTo)
    return postExact(options.iframe.contentWindow, message, origin)
  }

  /** `version_unsupported` has to be sent before any version is agreed, so it uses the shell's own highest. */
  const sendUnsupported = (replyTo: string): void => {
    const shellVersion = Math.max(...supported)
    const message = createEnvelope(
      'error',
      { code: 'version_unsupported', message: 'The shell and this module share no protocol version.' },
      { version: shellVersion, newId, now },
      replyTo,
    )
    postExact(options.iframe.contentWindow, message, origin)
  }

  const guarded = <A extends unknown[]>(handler: ((...args: A) => void) | undefined, ...args: A): void => {
    try {
      handler?.(...args)
    } catch {
      // A bug in the shell's handler must not stop the channel from reading the next message.
      logger('handler_error')
    }
  }

  const handle = (event: MessageEvent): void => {
    if (disposed) return
    if (!isTrustedMessage(event, { origin, source: options.iframe.contentWindow })) {
      // Not from our module: other frames and other pages are ignored without a word, even in
      // development (a page that frames us would otherwise fill the console).
      return
    }
    const drop = (reason: Parameters<DropLogger>[0], type?: string) => logger(reason, { type, origin: event.origin })
    if (!isWithinSizeLimit(event.data)) return drop('too_large')
    const parsed = parseModuleToShell(event.data, { acceptedVersions: version === undefined ? supported : [version] })
    if (!parsed.ok) return drop(parsed.reason, parsed.type)
    dispatch(parsed.message, drop)
  }

  const dispatch = (message: ModuleToShell, drop: (reason: Parameters<DropLogger>[0], type?: string) => void): void => {
    const meta = { id: message.id }
    if (message.type === 'ready') {
      const common = negotiateVersion(supported, message.payload.supportedVersions)
      const info = {
        id: message.id,
        module: message.payload.module,
        moduleVersion: message.payload.moduleVersion,
        supportedVersions: message.payload.supportedVersions,
      }
      if (common === undefined) {
        version = undefined
        sendUnsupported(message.id)
        guarded(options.onVersionUnsupported, info)
        return
      }
      // A module that reloads sends `ready` again: the handshake is idempotent.
      version = common
      guarded(options.onReady, { ...info, version: common })
      return
    }
    if (version === undefined) return drop('before_ready', message.type)
    switch (message.type) {
      case 'title':
        return guarded(options.onTitle, message.payload, meta)
      case 'token:request':
        return guarded(options.onTokenRequest, message.payload, meta)
      case 'logout':
        return guarded(options.onLogout, message.payload, meta)
      case 'toast':
        return guarded(options.onToast, message.payload, meta)
      case 'error':
        return guarded(options.onModuleError, message.payload, meta)
    }
  }

  // Listening starts here, at construction, before the caller sets the iframe's `src`.
  listenOn.addEventListener('message', handle)

  return {
    get version() {
      return version
    },
    sendAuth(payload, sendOptions) {
      const checked = payloadChecks.auth(payload)
      if (checked === undefined) {
        logger('invalid_payload', { type: 'auth' })
        return false
      }
      return send('auth', checked, sendOptions?.replyTo)
    },
    sendNavigate(path) {
      const checked = payloadChecks.navigate({ path })
      if (checked === undefined) {
        logger('invalid_payload', { type: 'navigate' })
        return false
      }
      return send('navigate', checked)
    },
    sendError(code, message) {
      const checked = payloadChecks.shellError({ code, message })
      if (checked === undefined) {
        logger('invalid_payload', { type: 'error' })
        return false
      }
      return send('error', checked)
    },
    dispose() {
      disposed = true
      listenOn.removeEventListener('message', handle)
    },
  }
}

