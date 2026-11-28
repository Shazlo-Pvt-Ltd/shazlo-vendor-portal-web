import type { DropReason } from './types'

export interface DropInfo {
  /** The message type, when it was a short safe word. */
  type?: string | undefined
  /** The origin the message claimed. */
  origin?: string | undefined
}

export type DropLogger = (reason: DropReason, info?: DropInfo) => void

/**
 * Reports each dropped message and why, in a development build only; a production build stays silent
 * (a page that frames us must not be able to fill our console or learn what we reject). It logs the
 * reason, the type and the origin and never the content of a message, which could hold a token.
 */
export function createDropLogger(options: { development: boolean; log?: (...args: unknown[]) => void }): DropLogger {
  if (!options.development) return () => {}
  const log = options.log ?? ((...args: unknown[]) => console.warn(...args))
  return (reason, info = {}) => {
    const parts = [`[shell-protocol] dropped a message: ${reason}`]
    if (info.type) parts.push(`type=${info.type}`)
    if (info.origin) parts.push(`origin=${info.origin}`)
    log(parts.join(' '))
  }
}
