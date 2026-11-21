import { exactOrigin } from '@shazlo/shell-protocol'
import type { LucideIcon } from 'lucide-react'
import { Store } from 'lucide-react'

declare const __VENDOR_ADMIN_URL__: string | undefined

// The module registry (ADR 0001 §4): exact URL and origin, the roles that may open it, the backend
// audience its token is for, and the deep links the shell lists under it. A new service is a new entry.
export interface ShellModule {
  id: string
  title: string
  basePath: string
  url: string
  origin: string
  roles: string[]
  audience: string
  icon: LucideIcon
  links: { label: string; path: string }[]
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
    links: [
      { label: 'Review queue', path: '/queue' },
      { label: 'All vendors', path: '/vendors' },
      { label: 'Publishing', path: '/publishing' },
    ],
  },
]

export const moduleFor = (pathname: string) => modules.find((m) => pathname === m.basePath || pathname.startsWith(`${m.basePath}/`))
