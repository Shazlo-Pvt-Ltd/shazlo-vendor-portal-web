/** The portal's environment, checked once at start. */

export interface Env {
  /** The vendor-api origin, without a trailing slash. */
  apiUrl: string
}

export type EnvResult = { ok: true; env: Env } | { ok: false; problems: string[] }

interface RawEnv {
  VITE_VENDOR_API_URL?: string
}

/**
 * Reads `VITE_VENDOR_API_URL`. It is required, must be an http(s) origin without credentials, a
 * path, a query or a fragment, and must be https unless the app runs in development. The problems
 * say what is wrong and never repeat the value (it could hold a password somebody pasted).
 */
export function readEnv(raw: RawEnv, options: { dev: boolean }): EnvResult {
  const value = (raw.VITE_VENDOR_API_URL ?? '').trim()
  if (value === '') {
    return { ok: false, problems: ['VITE_VENDOR_API_URL is not set.'] }
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, problems: ['VITE_VENDOR_API_URL is not a valid URL.'] }
  }
  const problems: string[] = []
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    problems.push('VITE_VENDOR_API_URL must start with http:// or https://.')
  } else if (url.protocol === 'http:' && !options.dev) {
    problems.push('VITE_VENDOR_API_URL must use https outside development.')
  }
  if (url.username !== '' || url.password !== '') {
    problems.push('VITE_VENDOR_API_URL must not contain a user name or password.')
  }
  if (url.search !== '' || url.hash !== '') {
    problems.push('VITE_VENDOR_API_URL must not contain a query or a fragment.')
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    problems.push('VITE_VENDOR_API_URL must be an origin without a path (for example https://api.example.com).')
  }
  if (problems.length > 0) {
    return { ok: false, problems }
  }
  return { ok: true, env: { apiUrl: url.origin } }
}

/** The environment of this build. */
export function loadEnv(): EnvResult {
  return readEnv(import.meta.env, { dev: import.meta.env.DEV })
}
