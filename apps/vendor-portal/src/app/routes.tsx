import { lazy, type ReactNode } from 'react'
import { Outlet, type RouteObject } from 'react-router'
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage'
import { LoginPage } from '../features/auth/LoginPage'
import { SetPasswordPage } from '../features/auth/SetPasswordPage'
import { SignupPage } from '../features/signup/SignupPage'
import { VerifyEmailPage } from '../features/signup/VerifyEmailPage'
import { NotFound } from '../components/NotFound'
import { RouteError } from '../components/RouteError'
import { PublicOnly, RequireAuth, RequireRole } from '../session/guards'
import { AppShell } from './shell/AppShell'
import { portalRoutes, type PortalRoute } from './portalRoutes'

export { portalRoutes }
export type { Access, PortalRoute } from './portalRoutes'

// Each signed-in screen is its own chunk, loaded when first opened (the shell shows a page skeleton).
const OverviewPage = lazy(() => import('../pages/OverviewPage'))
const BrandPage = lazy(() => import('../pages/BrandPage'))
const ProductsPage = lazy(() => import('../pages/ProductsPage'))
const NewProductPage = lazy(() => import('../pages/NewProductPage'))
const EditProductPage = lazy(() => import('../pages/EditProductPage'))
const ImportPage = lazy(() => import('../pages/ImportPage'))
const SubmissionsPage = lazy(() => import('../pages/SubmissionsPage'))
const TeamPage = lazy(() => import('../pages/TeamPage'))
const AccountPage = lazy(() => import('../pages/AccountPage'))

/** The screens, by path. Every route in `portalRoutes` must have one (a test checks). */
export const screens: Record<string, ReactNode> = {
  '/login': <LoginPage />,
  '/forgot-password': <ForgotPasswordPage />,
  '/set-password': <SetPasswordPage />,
  '/reset-password': <SetPasswordPage />,
  '/accept-invite': <SetPasswordPage />,
  '/signup': <SignupPage />,
  '/verify-email': <VerifyEmailPage />,
  '/': <OverviewPage />,
  '/brand': <BrandPage />,
  '/products': <ProductsPage />,
  '/products/new': <NewProductPage />,
  '/products/:productId': <EditProductPage />,
  '/import': <ImportPage />,
  '/submissions': <SubmissionsPage />,
  '/team': <TeamPage />,
  '/account': <AccountPage />,
}

function page(route: PortalRoute): RouteObject {
  return { path: route.path, element: screens[route.path] }
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
            element: <AppShell />,
            children: [
              ...only('authenticated'),
              { element: <RequireRole role="owner" />, children: only('owner') },
              // An unknown address keeps the frame: the menu is still there to find the way.
              { path: '*', element: <NotFound embedded /> },
            ],
          },
        ],
      },
    ],
  },
]
