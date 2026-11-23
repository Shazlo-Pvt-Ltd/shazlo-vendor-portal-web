import { SHELL_DEV_ORIGIN } from './config'

/**
 * The origins that may frame the module (CSP `frame-ancestors`): the shell, and in development the
 * local shell too. Nothing else, so any other page that tries to frame the module is refused by the
 * browser. Exact origins only: no `*`, no `'self'`.
 */
export function frameAncestors(shellOrigin: string, development: boolean): string[] {
  return [...new Set([shellOrigin, ...(development ? [SHELL_DEV_ORIGIN] : [])])]
}

/**
 * The headers on every response from the module (ADR 0001, section 5). `frame-ancestors` replaces
 * `X-Frame-Options`, so the older header is not sent. `Referrer-Policy: no-referrer` keeps the shell's
 * address (and anything in it) out of the module's requests.
 */
export function moduleHeaders(options: { shellOrigin: string; development: boolean }): Record<string, string> {
  return {
    'Content-Security-Policy': `frame-ancestors ${frameAncestors(options.shellOrigin, options.development).join(' ')}`,
    'Referrer-Policy': 'no-referrer',
  }
}
