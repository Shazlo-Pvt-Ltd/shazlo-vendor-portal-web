import { portalRoutes } from '../app/portalRoutes'

/**
 * Turns the `return-to` value of a login link into a place inside the portal, or `/`. Only a
 * relative path to a screen the portal has is accepted: no other site, no scheme, no `//host`, no
 * backslashes, no control characters. A link that sends a vendor elsewhere after login is a phishing tool.
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
    if (route.access === 'public') return false
    const pattern = new RegExp(`^${route.path.replace(/:[^/]+/g, '[^/]+')}$`)
    return pattern.test(url.pathname)
  })
  return known ? `${url.pathname}${url.search}${url.hash}` : '/'
}
