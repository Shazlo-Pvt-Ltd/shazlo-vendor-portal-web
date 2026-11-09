import { lazy, Suspense, type ReactNode } from 'react'
import { Outlet, type RouteObject } from 'react-router'
import { GuestOnly, RequireAuth } from '../auth/session'
import { ComingSoon, NotFound, RouteError } from '../screens/misc/Misc'
import { AppShell } from '../shell/AppShell'
import { PageFallback } from '../shell/PageFallback'
import { CrumbProvider, type RouteHandle } from './crumbs'

// Each screen is its own chunk, so signing in does not download the product editor.
const SignIn = lazy(() => import('../screens/auth/SignIn'))
const Apply = lazy(() => import('../screens/auth/Apply'))
const SetPassword = lazy(() => import('../screens/auth/SetPassword'))
const ForgotPassword = lazy(() => import('../screens/auth/ForgotPassword'))
const Overview = lazy(() => import('../screens/overview/Overview'))
const BrandEditor = lazy(() => import('../screens/brand/BrandEditor'))
const ProductList = lazy(() => import('../screens/products/ProductList'))
const ProductEditor = lazy(() => import('../screens/products/ProductEditor'))
const ReviewStatus = lazy(() => import('../screens/review/ReviewStatus'))

const page = (node: ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>
const crumbs = (...list: RouteHandle['crumbs'] & object): RouteHandle => ({ crumbs: list })

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <GuestOnly><Outlet /></GuestOnly>,
        children: [
          { path: '/sign-in', element: page(<SignIn />) },
          { path: '/apply', element: page(<Apply />) },
          { path: '/forgot-password', element: page(<ForgotPassword />) },
        ],
      },
      // Reached from the invite email, so it works signed in or out.
      { path: '/set-password', element: page(<SetPassword />) },
      {
        path: '/',
        element: (
          <RequireAuth>
            <CrumbProvider>
              <AppShell />
            </CrumbProvider>
          </RequireAuth>
        ),
        children: [
          { index: true, element: <Overview />, handle: crumbs({ label: 'Overview' }) },
          { path: 'brand', element: <BrandEditor />, handle: crumbs({ label: 'Brand page' }) },
          {
            path: 'products',
            handle: crumbs({ label: 'Products', to: '/products' }),
            children: [
              { index: true, element: <ProductList /> },
              { path: 'import', element: <ProductList importOpen />, handle: crumbs({ label: 'Bulk import' }) },
              { path: 'new', element: <ProductEditor />, handle: crumbs({ label: 'New product' }) },
              { path: ':id', element: <ProductEditor /> },
            ],
          },
          { path: 'review', element: <ReviewStatus />, handle: crumbs({ label: 'Review status' }) },
          { path: 'settings', element: <ComingSoon page="settings" />, handle: crumbs({ label: 'Store settings' }) },
          { path: 'team', element: <ComingSoon page="team" />, handle: crumbs({ label: 'Team' }) },
          { path: 'help', element: <ComingSoon page="help" />, handle: crumbs({ label: 'Help & support' }) },
          { path: '*', element: <NotFound />, handle: crumbs({ label: 'Not found' }) },
        ],
      },
    ],
  },
]
