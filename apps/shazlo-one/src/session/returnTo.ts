import { paths } from '../app/paths'
import { registry } from '../app/registry'

/**
 * The `next` value of a sign-in link, as a place inside the shell, or Home. Only a relative path to a
 * signed-in shell screen is accepted (Home, Admins & roles, or a registered module and anything under
 * it): no other site, no scheme, no `//host`, no backslash (browsers read `/\host` as `//host`), no
 * control character. A link that sends an admin elsewhere after sign-in is a phishing tool.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 2000) return paths.home
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return paths.home
  if (!value.startsWith('/') || value.startsWith('//')) return paths.home
  let url: URL
  try {
    url = new URL(value, 'https://shell.invalid')
  } catch {
    return paths.home
  }
  if (url.origin !== 'https://shell.invalid') return paths.home
  // The URL parser has resolved any "." and ".." segments: the path checked is the one the router gets.
  const known = url.pathname === paths.home || url.pathname === paths.admins || registry.some((m) => url.pathname === m.basePath || url.pathname.startsWith(`${m.basePath}/`))
  return known ? `${url.pathname}${url.search}${url.hash}` : paths.home
}
