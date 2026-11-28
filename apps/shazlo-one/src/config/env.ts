// The shell's settings, checked once: by vite.config.ts when it builds or serves (a bad production
// setting fails the build), and again by the page when it starts (it then shows "not set up correctly"
// instead of running half configured). This file has no imports, so Node can load it as it is.

export interface ShellEnv {
  /** identity-api's origin, or null for the shell's own origin (the Vite proxy in development). */
  identityOrigin: string | null
  /** identity-api (and the demo data) mocked in the browser, with demo passwords. */
  mock: boolean
}

export type EnvResult = { ok: true; env: ShellEnv } | { ok: false; problems: string[] }

export interface RawEnv {
  VITE_IDENTITY_API_URL?: string
  VITE_MOCK_API?: string
}

/**
 * A host name or nothing: lower-case letters, digits, dots and hyphens. The URL parser lets `;`, `,`
 * and quotes into a host name, and the origin is written into the Content-Security-Policy, where `;`
 * starts a new directive.
 */
export const PLAIN_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/

const LOOPBACK = new Set(['localhost', '127.0.0.1'])

/**
 * Checks an API origin setting. It must be an http(s) origin with no credentials, path, query or
 * fragment, a plain host, and https unless this is development on this machine. The problems say what
 * is wrong and never repeat the value (somebody may have pasted a password into it).
 */
export function originProblems(name: string, value: string, { dev }: { dev: boolean }): string[] {
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
  if (url.pathname !== '/' && url.pathname !== '') problems.push(`${name} must be an origin without a path (for example https://identity.shazlo.store).`)
  return problems
}

/**
 * Reads the shell's settings.
 *
 * - `VITE_MOCK_API`: `on` mocks identity-api in the browser (a demo build), `off` uses the real one.
 *   Unset, development mocks it and **a production build does not**: the mock and its demo passwords
 *   reach a production bundle only when asked for by name.
 * - `VITE_IDENTITY_API_URL`: identity-api's origin. Required for a production build that is not a
 *   demo; in development it may be left out, and the shell calls its own origin, which Vite forwards
 *   to identity-api (so the refresh cookie is first-party).
 */
export function readEnv(raw: RawEnv, { dev }: { dev: boolean }): EnvResult {
  const problems: string[] = []
  const mockSetting = (raw.VITE_MOCK_API ?? '').trim()
  if (mockSetting !== '' && mockSetting !== 'on' && mockSetting !== 'off') problems.push('VITE_MOCK_API must be "on", "off" or not set.')
  const mock = mockSetting === 'on' || (dev && mockSetting === '')
  const identity = (raw.VITE_IDENTITY_API_URL ?? '').trim()
  let identityOrigin: string | null = null
  if (identity !== '') {
    const found = originProblems('VITE_IDENTITY_API_URL', identity, { dev })
    problems.push(...found)
    if (found.length === 0) identityOrigin = new URL(identity).origin
  } else if (!dev && !mock) {
    problems.push('VITE_IDENTITY_API_URL is not set. A production build needs identity-api’s https origin (or VITE_MOCK_API=on for a demo).')
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, env: { identityOrigin, mock } }
}
