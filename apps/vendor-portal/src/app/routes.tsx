import type { ReactNode } from 'react'
import { Outlet, type RouteObject } from 'react-router'
import { NotFound } from '../components/NotFound'
import { RouteError } from '../components/RouteError'
import { SignupPage } from '../features/signup/SignupPage'
import { VerifyEmailPage } from '../features/signup/VerifyEmailPage'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { PublicOnly, RequireAuth, RequireRole } from '../session/guards'
import { portalRoutes, type PortalRoute } from './portalRoutes'

export { portalRoutes }
export type { Access, PortalRoute } from './portalRoutes'

/** Screens that are built. Every other route shows a placeholder until its issue is done. */
const screens: Record<string, ReactNode> = {
  '/signup': <SignupPage />,
  '/verify-email': <VerifyEmailPage />,
}

function page(route: PortalRoute): RouteObject {
  return { path: route.path, element: screens[route.path] ?? <PlaceholderPage title={route.title} /> }
}

export const routes: RouteObject[] = [
  {
    element: <Outlet />,
    errorElement: <RouteError />,
    children: [
      { element: <PublicOnly />, children: portalRoutes.filter((r) => r.access === 'public').map(page) },
      {
        element: <RequireAuth />,
        children: [
          ...portalRoutes.filter((r) => r.access === 'authenticated').map(page),
          { element: <RequireRole role="owner" />, children: portalRoutes.filter((r) => r.access === 'owner').map(page) },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]
