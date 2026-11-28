// The Vendors module's settings, checked by vite.config.ts when it builds or serves (a bad production
// setting fails the build, with every problem listed) and by scripts/write-vercel-headers.mjs. This file
// has no imports, so Node can load it as it is.

export interface ModuleEnv {
  /** Shazlo One's exact origin: the only page that may frame the module, and the only one it talks to. */
  shellOrigin: string
  /** vendor-api's admin app (origin only). */
  apiOrigin: string
}

export type EnvResult = { ok: true; env: ModuleEnv } | { ok: false; problems: string[] }

export interface RawEnv {
  VITE_SHELL_ORIGIN?: string
  VITE_VENDOR_API_URL?: string
}

/** Development defaults: the shell's dev server, and the shared mock vendor-api (npm run serve -w @shazlo/mock-vendor-api). */
export const DEV_SHELL_ORIGIN = 'http://localhost:5192'
export const DEV_API_ORIGIN = 'http://localhost:5194'

/**
 * A host name: lower-case letters, digits, dots and hyphens. The URL parser lets `;`, `,` and quotes
 * into a host name, and both origins are written into the Content-Security-Policy (`frame-ancestors`,
 * `connect-src`), where `;` starts a new directive.
 */
export const PLAIN_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/
const LOOPBACK = new Set(['localhost', '127.0.0.1'])

/** What is wrong with an origin setting; the problems never repeat the value. */
export function originProblems(name: string, value: string, { dev }: { dev: boolean }): string[] {
  if (/[*]/.test(value)) return [`${name} must be one exact origin, not a wildcard.`]
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return [`${name} is not a valid URL.`]
  }
  const problems: string[] = []
  if (url.protocol !== 'http:' && url.protocol !== 'https:') problems.push(`${name} must start with https://.`)
  else if (url.protocol === 'http:' && !(dev && LOOPBACK.has(url.hostname))) problems.push(`${name} must use https (plain http is only for localhost in development).`)
  if (!PLAIN_HOST.test(url.hostname)) problems.push(`${name} must have a host of letters, digits, dots and hyphens only.`)
  if (url.username !== '' || url.password !== '') problems.push(`${name} must not contain a user name or password.`)
  if (url.search !== '' || url.hash !== '') problems.push(`${name} must not contain a query or a fragment.`)
  if (url.pathname !== '/' && url.pathname !== '') problems.push(`${name} must be an origin without a path.`)
  return problems
}

/**
 * Reads the settings. A production build needs both, as exact https origins; development falls back
 * to the shell's dev server and the mock vendor-api.
 */
export function readEnv(raw: RawEnv, { dev }: { dev: boolean }): EnvResult {
  const problems: string[] = []
  const read = (name: keyof RawEnv, fallback: string): string => {
    const value = (raw[name] ?? '').trim()
    if (value === '') {
      if (!dev) problems.push(`${name} is not set. A production build needs it as an exact https origin.`)
      return fallback
    }
    const found = originProblems(name, value, { dev })
    problems.push(...found)
    return found.length === 0 ? new URL(value).origin : fallback
  }
  const shellOrigin = read('VITE_SHELL_ORIGIN', DEV_SHELL_ORIGIN)
  const apiOrigin = read('VITE_VENDOR_API_URL', DEV_API_ORIGIN)
  return problems.length > 0 ? { ok: false, problems } : { ok: true, env: { shellOrigin, apiOrigin } }
}
