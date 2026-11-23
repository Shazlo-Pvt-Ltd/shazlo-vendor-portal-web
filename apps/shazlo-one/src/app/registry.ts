import { exactOrigin } from '@shazlo/shell-protocol'
import type { LucideIcon } from 'lucide-react'
import { Building2, Inbox, LayoutDashboard, Send, Store } from 'lucide-react'

declare const __VENDOR_ADMIN_URL__: string | undefined

// One of a module's pages, as a module path ("/queue"). `also` lists more module-path prefixes that
// belong to it, so the link stays current on the pages reached from it ("/review" for the queue).
export interface ModuleLink {
  label: string
  path: string
  icon: LucideIcon
  also?: string[]
}

// The module registry (ADR 0001 §4): exact URL and origin, the roles that may open it, the backend
// audience its token is for, the page the module opens on (`home`), and the pages the shell lists for
// it in the sidebar and the top bar, each with its icon. A new service is a new entry.
export interface ShellModule {
  id: string
  title: string
  basePath: string
  url: string
  origin: string
  roles: string[]
  audience: string
  icon: LucideIcon
  home: { label: string; path: string; icon: LucideIcon }
  links: ModuleLink[]
}

const vendorAdminUrl = (typeof __VENDOR_ADMIN_URL__ !== 'undefined' && __VENDOR_ADMIN_URL__) || 'http://localhost:5193/'

export const modules: ShellModule[] = [
  {
    id: 'vendor-admin',
    title: 'Vendors',
    basePath: '/vendors',
    url: vendorAdminUrl,
    origin: exactOrigin(vendorAdminUrl),
    roles: ['vendor_reviewer', 'super_admin'],
    audience: 'vendor-api',
    icon: Store,
    home: { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    links: [
      // Product and brand reviews are opened from the queue.
      { label: 'Review queue', path: '/queue', icon: Inbox, also: ['/review'] },
      // "/vendors/<id>" (a vendor's page) is under "/vendors" already.
      { label: 'All vendors', path: '/vendors', icon: Building2 },
      { label: 'Publishing', path: '/publishing', icon: Send },
    ],
  },
]

// `path` is `prefix` or a page under it: "/vendors/v_kalki" is under "/vendors", "/vendorsX" is not.
const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

export const moduleFor = (pathname: string) => modules.find((m) => under(pathname, m.basePath))

// The module path of a shell URL ("/vendors/queue" → "/queue", "/vendors" → ""), or null outside the module.
export function modulePath(module: ShellModule, pathname: string): string | null {
  return under(pathname, module.basePath) ? pathname.slice(module.basePath.length) : null
}

// The module page a shell URL shows: the bare base path ("/vendors", "/vendors/") opens the module's
// home ("/dashboard"), any other URL its own module path. Null outside the module. The module host
// loads this page, and the sidebar and top bar mark it, so they always agree.
export function moduleTarget(module: ShellModule, pathname: string): string | null {
  const path = modulePath(module, pathname)
  if (path === null) return null
  return path === '' || path === '/' ? module.home.path : path
}

// The module's own first page: its bare base path ("/vendors", "/vendors/") or its home page.
export function isModuleHome(module: ShellModule, pathname: string): boolean {
  const target = moduleTarget(module, pathname)
  return target !== null && under(target, module.home.path)
}

// Which of the module's pages the URL is on, for the sidebar and the top bar alike; none on its home.
export function currentLink(module: ShellModule, pathname: string): ModuleLink | undefined {
  const path = modulePath(module, pathname)
  if (path === null || isModuleHome(module, pathname)) return undefined
  return module.links.find((l) => [l.path, ...(l.also ?? [])].some((prefix) => under(path, prefix)))
}
