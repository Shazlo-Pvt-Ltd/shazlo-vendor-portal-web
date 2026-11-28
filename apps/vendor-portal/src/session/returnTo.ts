import { portalRoutes } from '../app/portalRoutes'

/** The query parameter of the login link that says where to go after signing in. */
export const NEXT_PARAM = 'next'

/** Where the login screen is. */
export const LOGIN_PATH = '/login'

/**
 * Turns the `next` value of a login link into a place inside the portal, or `/`. Only a relative
 * path to a signed-in page the portal has is accepted: no other site, no scheme, no `//host`, no
 * backslashes, no control characters. A link that sends a seller elsewhere after login is a phishing tool.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > 2000) return '/'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return '/'
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  let url: URL
  try {
    url = new URL(value, 'https://portal.invalid')
  } catch {
    return '/'
  }
  if (url.origin !== 'https://portal.invalid') return '/'
  const known = portalRoutes.some((route) => {
    if (route.access === 'public' || route.access === 'open') return false
    const pattern = new RegExp(`^${route.path.replace(/:[^/]+/g, '[^/]+')}$`)
    return pattern.test(url.pathname)
  })
  return known ? `${url.pathname}${url.search}${url.hash}` : '/'
}

/** The login address that comes back to `target` afterwards (a plain `/login` for the dashboard). */
export function loginPath(target: string): string {
  const safe = safeReturnTo(target)
  return safe === '/' ? LOGIN_PATH : `${LOGIN_PATH}?${NEXT_PARAM}=${encodeURIComponent(safe)}`
}

/** Where a login link with this query string goes once the seller is signed in. */
export function nextFrom(search: string): string {
  return safeReturnTo(new URLSearchParams(search).get(NEXT_PARAM))
}
