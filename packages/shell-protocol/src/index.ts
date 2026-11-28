// ADR 0001: the postMessage protocol between the Shazlo One shell and each module it frames. The
// shell uses createShellChannel, a module createModuleClient; nothing else posts or reads
// cross-frame messages (test/source-guard.test.ts fails if app code does). These files have no
// runtime dependency.
export {
  MAX_MESSAGE_BYTES,
  MAX_TOAST_MESSAGE_LENGTH,
  PROTOCOL,
  PROTOCOL_VERSION,
  TOKEN_REQUEST_INTERVAL_MS,
  TOKEN_SLACK_SECONDS,
} from './constants'
export { createDropLogger } from './logger'
export type { DropInfo, DropLogger } from './logger'
export { createModuleClient } from './moduleClient'
export type { ModuleClient, ModuleClientOptions } from './moduleClient'
export { ProtocolConfigError, assertExactOrigin } from './origin'
export { newMessageId } from './post'
export { createShellChannel } from './shellChannel'
export type { ReadyInfo, ShellChannel, ShellChannelOptions } from './shellChannel'
export { isWithinSizeLimit } from './size'
export { isTrustedMessage } from './trust'
export type * from './types'
export { isEnvelope, parseModuleToShell, parseShellToModule } from './validate'
export type { ParseOptions } from './validate'
export { negotiateVersion, shellSupportedVersions } from './version'
export { isModulePath, MAX_MODULE_PATH } from './paths'

// ADR 0011: the module registry (trust), each module's manifest (looks) and its summary (Home and
// the badge). These are read from build files and over HTTP, not postMessage, and use zod.
export * from './manifest'
export * from './registry'
export * from './summary'
