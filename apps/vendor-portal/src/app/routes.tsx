import { Outlet, type RouteObject } from 'react-router'
import { NotFound } from '../components/NotFound'
import { RouteError } from '../components/RouteError'
import { PlaceholderPage } from '../pages/PlaceholderPage'

/**
 * Who may open a route. The scaffold only records it; the session issue adds the guards that
 * enforce it (`RequireAuth` for `authenticated`, `PublicOnly` for `public`).
 */
export type Access = 'public' | 'authenticated'

export interface PortalRoute {
  path: string
  title: string
  access: Access
}

export const portalRoutes: PortalRoute[] = [
  { path: '/login', title: 'Sign in', access: 'public' },
  { path: '/signup', title: 'Create your vendor account', access: 'public' },
  { path: '/verify-email', title: 'Verify your email', access: 'public' },
  { path: '/forgot-password', title: 'Reset your password', access: 'public' },
  { path: '/set-password', title: 'Set your password', access: 'public' },
  { path: '/', title: 'Overview', access: 'authenticated' },
  { path: '/brand', title: 'Brand page', access: 'authenticated' },
  { path: '/products', title: 'Products', access: 'authenticated' },
  { path: '/products/new', title: 'New product', access: 'authenticated' },
  { path: '/products/:productId', title: 'Edit product', access: 'authenticated' },
  { path: '/import', title: 'Bulk import', access: 'authenticated' },
  { path: '/submissions', title: 'Submissions', access: 'authenticated' },
  { path: '/team', title: 'Team', access: 'authenticated' },
  { path: '/account', title: 'Account', access: 'authenticated' },
]

export const routes: RouteObject[] = [
  {
    element: <Outlet />,
    errorElement: <RouteError />,
    children: [
      ...portalRoutes.map((route) => ({
        path: route.path,
        element: <PlaceholderPage title={route.title} />,
      })),
      { path: '*', element: <NotFound /> },
    ],
  },
]
