import type { ReactNode } from 'react'
import { Outlet, type RouteObject } from 'react-router'
import { NotFound } from '../components/NotFound'
import { RouteError } from '../components/RouteError'
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage'
import { LoginPage } from '../features/auth/LoginPage'
import { SetPasswordPage } from '../features/auth/SetPasswordPage'
import { SignupPage } from '../features/signup/SignupPage'
import { VerifyEmailPage } from '../features/signup/VerifyEmailPage'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { PublicOnly, RequireAuth, RequireRole } from '../session/guards'
import { AuthenticatedLayout } from './AppBar'
import { portalRoutes, type PortalRoute } from './portalRoutes'

export { portalRoutes }
export type { Access, PortalRoute } from './portalRoutes'

/** Screens that are built. Every other route shows a placeholder until its issue is done. */
const screens: Record<string, ReactNode> = {
  '/login': <LoginPage />,
  '/forgot-password': <ForgotPasswordPage />,
  '/set-password': <SetPasswordPage />,
  '/signup': <SignupPage />,
  '/verify-email': <VerifyEmailPage />,
}

function page(route: PortalRoute): RouteObject {
  return { path: route.path, element: screens[route.path] ?? <PlaceholderPage title={route.title} /> }
}

const only = (access: PortalRoute['access']) => portalRoutes.filter((route) => route.access === access).map(page)

export const routes: RouteObject[] = [
  {
    element: <Outlet />,
    errorElement: <RouteError />,
    children: [
      // Signed-out visitors only: login, signup, forgot password.
      { element: <PublicOnly />, children: only('public') },
      // Links from an email work whether or not someone is signed in.
      ...only('open'),
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AuthenticatedLayout />,
            children: [
              ...only('authenticated'),
              { element: <RequireRole role="owner" />, children: only('owner') },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]
