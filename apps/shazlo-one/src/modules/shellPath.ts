import { isModulePath } from '@shazlo/shell-protocol'

/** Any origin works: the URL parser only normalises the path, and a result on another origin is refused. */
const PLACEHOLDER_ORIGIN = 'https://shell.invalid'

/** Where a module lives in the shell's own address: `/m/<id>`. */
export const moduleBasePath = (moduleId: string): string => `/m/${moduleId}`

/**
 * The shell address for a path inside a module (`/orders/42?tab=2` becomes `/m/vendor-admin/orders/42?tab=2`),
 * or undefined when that is not an address inside this module. A module reports where it is with `title`,
 * and the shell puts it in its own address bar, so the path is never trusted: it must start with `/` and
 * not be `//host` (the protocol's own check), and after the browser's own path rules (dot segments,
 * `%2e%2e`, `\`) it must still be `/m/<id>` or below it. A path like `/../admins` would otherwise walk the
 * shell to another screen.
 */
export function shellUrlFor(moduleId: string, modulePath: string): string | undefined {
  if (!isModulePath(modulePath)) return undefined
  const base = moduleBasePath(moduleId)
  let url: URL
  try {
    url = new URL(`${base}${modulePath}`, PLACEHOLDER_ORIGIN)
  } catch {
    return undefined
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return undefined
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return undefined
  // The module's root is `/m/<id>`, not `/m/<id>/`.
  const pathname = url.pathname === `${base}/` ? base : url.pathname
  return `${pathname}${url.search}${url.hash}`
}

/**
 * The path inside the module that the shell's address stands for: `/m/vendor-admin/orders/42?tab=2` is
 * `/orders/42?tab=2`, and the module's root is `/`. This is what a deep link sends the module in `navigate`.
 */
export function modulePathFrom(moduleId: string, location: { pathname: string; search: string; hash: string }): string {
  const rest = location.pathname.slice(moduleBasePath(moduleId).length)
  return `${rest === '' ? '/' : rest}${location.search}${location.hash}`
}
