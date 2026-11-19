import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Outlet, type RouteObject } from 'react-router'
import { GuestOnly, RequireAuth } from '../auth/session'
import { ComingSoon, NotFound, RouteError } from '../screens/misc/Misc'
import { AppShell } from '../shell/AppShell'
import { PageFallback } from '../shell/PageFallback'
import { CrumbProvider, type BackLink, type RouteHandle } from './crumbs'
import { paths } from './paths'

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
const StoreHub = lazy(() => import('../screens/hubs/StoreHub'))
const AccountHub = lazy(() => import('../screens/hubs/AccountHub'))
const StoreDetails = lazy(() => import('../screens/store/StoreDetails').then((m) => ({ default: m.StoreDetailsPage })))
const StoreSection = lazy(() => import('../screens/store/StoreSection').then((m) => ({ default: m.StoreSectionPage })))

const page = (node: ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>
const crumbs = (...list: RouteHandle['crumbs'] & object): RouteHandle => ({ crumbs: list })

// Where the phone top bar's Back link goes from inner pages (the four tab pages have none).
const back = {
  home: { to: paths.overview, label: 'Home' },
  products: { to: paths.products, label: 'Products' },
  store: { to: paths.store, label: 'Store' },
  storeDetails: { to: paths.storeDetails, label: 'Store details' },
  account: { to: paths.account, label: 'Account' },
} satisfies Record<string, BackLink>

/*
 * Full-screen tasks set `fullScreen: true` in the handle (see src/shell/task.tsx): on phones the tab bar
 * hides and the top bar keeps only Back. A screen can also declare itself with useFullScreenTask().
 */
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
          { path: 'brand', element: <BrandEditor />, handle: { ...crumbs({ label: 'Brand page' }), back: back.store } },
          {
            path: 'products',
            handle: crumbs({ label: 'Products', to: paths.products }),
            children: [
              { index: true, element: <ProductList /> },
              // Bulk import opens from a button on Products; the address stays so links keep working.
              { path: 'import', element: <ProductList importOpen />, handle: { ...crumbs({ label: 'Bulk import' }), back: back.products } },
              { path: 'new', element: <ProductEditor />, handle: { ...crumbs({ label: 'New product' }), back: back.products, fullScreen: true } },
              { path: ':id', element: <ProductEditor />, handle: { back: back.products, fullScreen: true } },
            ],
          },
          { path: 'review', element: <ReviewStatus />, handle: { ...crumbs({ label: 'Review status' }), back: back.home } },
          {
            path: 'store',
            children: [
              { index: true, element: <StoreHub />, handle: crumbs({ label: 'Store' }) },
              {
                path: 'details',
                handle: { ...crumbs({ label: 'Store details', to: paths.storeDetails }), back: back.store },
                children: [
                  { index: true, element: <StoreDetails /> },
                  // One topic (pickup, payouts…); the page names its own crumb with useCrumb.
                  { path: ':section', element: <StoreSection />, handle: { back: back.storeDetails, fullScreen: true } },
                ],
              },
            ],
          },
          { path: 'account', element: <AccountHub />, handle: crumbs({ label: 'Account' }) },
          // "Store settings" became Store details.
          { path: 'settings', element: <Navigate to={paths.storeDetails} replace /> },
          { path: 'team', element: <ComingSoon page="team" />, handle: { ...crumbs({ label: 'Team' }), back: back.account } },
          { path: 'help', element: <ComingSoon page="help" />, handle: { ...crumbs({ label: 'Help & support' }), back: back.account } },
          { path: '*', element: <NotFound />, handle: { ...crumbs({ label: 'Not found' }), back: back.home } },
        ],
      },
    ],
  },
]
