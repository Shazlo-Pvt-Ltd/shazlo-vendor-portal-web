import { assertExactOrigin, PROTOCOL_VERSION, type ModuleRegistration } from '@shazlo/shell-protocol'
import type { IconName } from '@shazlo/ui/components'
import type { Role } from '../api/mock'

const vendorAdminUrl = import.meta.env.VITE_VENDOR_ADMIN_URL ?? 'http://localhost:5175/'

export interface ShellModule extends ModuleRegistration {
  /** Shell route prefix, e.g. /vendors. */
  basePath: string
  icon: IconName
  requiredRoles: Role[]
}

/**
 * Module registry (ADR 0001 §4). Adding a service is a new entry here — id, URL, exact origin,
 * required roles — not a shell redesign.
 */
export const modules: ShellModule[] = [
  {
    id: 'vendor-admin',
    title: 'Vendors',
    basePath: '/vendors',
    icon: 'layers',
    url: vendorAdminUrl,
    origin: assertExactOrigin(new URL(vendorAdminUrl).origin),
    requiredRoles: ['vendor_reviewer', 'super_admin'],
    supportedVersions: [PROTOCOL_VERSION],
  },
]

export const canUse = (roles: Role[], m: Pick<ShellModule, 'requiredRoles'>) => m.requiredRoles.some(r => roles.includes(r))
