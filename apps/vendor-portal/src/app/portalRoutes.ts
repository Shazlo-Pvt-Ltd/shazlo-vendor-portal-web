/**
 * Who may open a route: `public` (signed-out users; signed-in ones go to the dashboard),
 * `open` (anyone: the links in emails, which must work whoever is signed in),
 * `authenticated` (any signed-in vendor user) or `owner` (the vendor's owner only). The guards in
 * `session/guards.tsx` enforce it.
 */
export type Access = 'public' | 'open' | 'authenticated' | 'owner'

export interface PortalRoute {
  path: string
  title: string
  access: Access
}

export const portalRoutes: PortalRoute[] = [
  { path: '/login', title: 'Sign in', access: 'public' },
  { path: '/signup', title: 'Create your vendor account', access: 'public' },
  { path: '/verify-email', title: 'Verify your email', access: 'open' },
  { path: '/forgot-password', title: 'Reset your password', access: 'public' },
  { path: '/set-password', title: 'Set your password', access: 'open' },
  { path: '/', title: 'Overview', access: 'authenticated' },
  { path: '/brand', title: 'Brand page', access: 'authenticated' },
  { path: '/products', title: 'Products', access: 'authenticated' },
  { path: '/products/new', title: 'New product', access: 'authenticated' },
  { path: '/products/:productId', title: 'Edit product', access: 'authenticated' },
  { path: '/import', title: 'Bulk import', access: 'authenticated' },
  { path: '/submissions', title: 'Submissions', access: 'authenticated' },
  { path: '/team', title: 'Team', access: 'owner' },
  { path: '/account', title: 'Account', access: 'authenticated' },
]

