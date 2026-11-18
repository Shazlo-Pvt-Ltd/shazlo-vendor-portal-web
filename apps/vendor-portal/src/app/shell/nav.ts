import type { Role } from '../../session/store'

export interface NavItem {
  to: string
  label: string
  /** Only for this role. Everyone sees an item with no `role`. */
  role?: Role
  /** Match this path exactly (the Overview is `/`, which every path starts with). */
  end?: boolean
}

/** The sections of the portal, in the order the navigation lists them. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', end: true },
  { to: '/brand', label: 'Brand page' },
  { to: '/products', label: 'Products' },
  { to: '/import', label: 'Bulk import' },
  { to: '/submissions', label: 'Submissions' },
  { to: '/team', label: 'Team', role: 'owner' },
  { to: '/account', label: 'Account' },
]

/** The items this role may see. Team is the owner's alone. */
export function navFor(role: Role | null): NavItem[] {
  return NAV_ITEMS.filter((item) => item.role === undefined || item.role === role)
}
