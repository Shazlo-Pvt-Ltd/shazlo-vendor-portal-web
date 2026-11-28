/**
 * Who may open a route: `public` (signed-out users; signed-in ones go to where they were headed),
 * `open` (anyone: the links in emails, which must work whoever is signed in),
 * `authenticated` (any signed-in vendor user) or `owner` (the vendor's owner only). The guards in
 * `session/guards.tsx` enforce it; `routes.tsx` gives every path its screen.
 */
export type Access = 'public' | 'open' | 'authenticated' | 'owner'

export interface PortalRoute {
  path: string
  /** The page title (`<title>`), also what a screen reader announces on arrival. */
  title: string
  access: Access
}

export const portalRoutes: PortalRoute[] = [
  // Main's addresses: vendor-api's emails link to them (services/vendor-api .../email/templates.py).
  { path: '/login', title: 'Sign in', access: 'public' },
  { path: '/signup', title: 'Apply to sell', access: 'public' },
  { path: '/forgot-password', title: 'Reset your password', access: 'public' },
  { path: '/verify-email', title: 'Verify your email', access: 'open' },
  { path: '/set-password', title: 'Set your password', access: 'open' },
  // A password reset and a staff invite: the same screen as /set-password.
  { path: '/reset-password', title: 'Set your password', access: 'open' },
  { path: '/accept-invite', title: 'Set your password', access: 'open' },
  // Build 2's seller pages.
  { path: '/', title: 'Home', access: 'authenticated' },
  { path: '/brand', title: 'Brand page', access: 'authenticated' },
  { path: '/products', title: 'Products', access: 'authenticated' },
  { path: '/products/import', title: 'Bulk import', access: 'authenticated' },
  { path: '/products/new', title: 'New product', access: 'authenticated' },
  { path: '/products/:id', title: 'Edit product', access: 'authenticated' },
  { path: '/review', title: 'Review status', access: 'authenticated' },
  { path: '/store', title: 'Store', access: 'authenticated' },
  { path: '/store/details', title: 'Store details', access: 'authenticated' },
  { path: '/store/details/:section', title: 'Store details', access: 'authenticated' },
  { path: '/account', title: 'Account', access: 'authenticated' },
  { path: '/account/password', title: 'Change password', access: 'authenticated' },
  { path: '/help', title: 'Help & support', access: 'authenticated' },
  { path: '/team', title: 'Team', access: 'owner' },
]

/**
 * Old addresses that still work: Build 2's own (`/sign-in`, `/apply`, `/settings`) and main's
 * (`/submissions`, `/import`). The query and the fragment go along, so `/sign-in?next=…` keeps its
 * destination. They are not in `portalRoutes`, so a `next` link can never name one.
 */
export const redirects: Record<string, string> = {
  '/sign-in': '/login',
  '/apply': '/signup',
  '/submissions': '/review',
  '/settings': '/store/details',
  '/import': '/products/import',
}

/** The suffix of every page title. */
export const TITLE_SUFFIX = 'Shazlo Seller'
