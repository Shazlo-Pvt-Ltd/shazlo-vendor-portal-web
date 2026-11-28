import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation, type RouteObject } from 'react-router'
import { NotFound } from '../components/NotFound'
import { RouteError } from '../components/RouteError'
import { ComingSoon } from '../screens/misc/Misc'
import { OpenLink, PublicOnly, RequireAuth, RequireRole } from '../session/guards'
import { AppShell } from '../shell/AppShell'
import { PageFallback } from '../shell/PageFallback'
import { CrumbProvider, type BackLink, type RouteHandle } from './crumbs'
import { paths } from './paths'
import { portalRoutes, redirects, type Access, type PortalRoute } from './portalRoutes'
import { useDocumentTitle } from './title'

export { portalRoutes, redirects }
export { TITLE_SUFFIX } from './portalRoutes'
export type { Access, PortalRoute } from './portalRoutes'

// Each screen is its own chunk, so signing in does not download the product editor.
const SignIn = lazy(() => import('../screens/auth/SignIn'))
const Apply = lazy(() => import('../screens/auth/Apply'))
const SetPassword = lazy(() => import('../screens/auth/SetPassword'))
const ForgotPassword = lazy(() => import('../screens/auth/ForgotPassword'))
const VerifyEmail = lazy(() => import('../screens/auth/VerifyEmail'))
const Overview = lazy(() => import('../screens/overview/Overview'))
const BrandEditor = lazy(() => import('../screens/brand/BrandEditor'))
const ProductList = lazy(() => import('../screens/products/ProductList'))
const ProductEditor = lazy(() => import('../screens/products/ProductEditor'))
const ReviewStatus = lazy(() => import('../screens/review/ReviewStatus'))
const StoreHub = lazy(() => import('../screens/hubs/StoreHub'))
const AccountHub = lazy(() => import('../screens/hubs/AccountHub'))
const ChangePassword = lazy(() => import('../screens/account/ChangePassword'))
const Team = lazy(() => import('../screens/team/Team'))
const StoreDetails = lazy(() => import('../screens/store/StoreDetails').then((m) => ({ default: m.StoreDetailsPage })))
const StoreSection = lazy(() => import('../screens/store/StoreSection').then((m) => ({ default: m.StoreSectionPage })))

// Where the phone top bar's Back link goes from inner pages (the four tab pages have none).
const back = {
  home: { to: paths.overview, label: 'Home' },
  products: { to: paths.products, label: 'Products' },
  store: { to: paths.store, label: 'Store' },
  storeDetails: { to: paths.storeDetails, label: 'Store details' },
  account: { to: paths.account, label: 'Account' },
} satisfies Record<string, BackLink>

const productsCrumb = { label: 'Products', to: paths.products }
const storeDetailsCrumb = { label: 'Store details', to: paths.storeDetails }

interface Screen {
  element: ReactNode
  /**
   * Breadcrumbs, the phone Back link and full-screen tasks (see src/shell/task.tsx): on phones a
   * task hides the tab bar and the top bar keeps only Back. A screen can also declare itself a task
   * with useFullScreenTask(), and name its own last crumb with useCrumb().
   */
  handle?: RouteHandle
}

/** The screen of every route in `portalRoutes`, by path (a test checks they match). */
export const screens: Record<string, Screen> = {
  '/login': { element: <SignIn /> },
  '/signup': { element: <Apply /> },
  '/forgot-password': { element: <ForgotPassword /> },
  '/verify-email': { element: <VerifyEmail /> },
  '/set-password': { element: <SetPassword /> },
  '/reset-password': { element: <SetPassword /> },
  '/accept-invite': { element: <SetPassword /> },
  '/': { element: <Overview />, handle: { crumbs: [{ label: 'Overview' }] } },
  '/brand': { element: <BrandEditor />, handle: { crumbs: [{ label: 'Brand page' }], back: back.store } },
  '/products': { element: <ProductList />, handle: { crumbs: [{ label: 'Products' }] } },
  // Bulk import opens as a dialog over Products; the address stays so links keep working.
  '/products/import': { element: <ProductList importOpen />, handle: { crumbs: [productsCrumb, { label: 'Bulk import' }], back: back.products } },
  '/products/new': { element: <ProductEditor />, handle: { crumbs: [productsCrumb, { label: 'New product' }], back: back.products, fullScreen: true } },
  // The editor names its last crumb (the product) once it has loaded.
  '/products/:id': { element: <ProductEditor />, handle: { crumbs: [productsCrumb], back: back.products, fullScreen: true } },
  '/review': { element: <ReviewStatus />, handle: { crumbs: [{ label: 'Review status' }], back: back.home } },
  '/store': { element: <StoreHub />, handle: { crumbs: [{ label: 'Store' }] } },
  '/store/details': { element: <StoreDetails />, handle: { crumbs: [{ label: 'Store details' }], back: back.store } },
  // One topic (pickup, payouts…); the page names its own crumb.
  '/store/details/:section': { element: <StoreSection />, handle: { crumbs: [storeDetailsCrumb], back: back.storeDetails, fullScreen: true } },
  '/account': { element: <AccountHub />, handle: { crumbs: [{ label: 'Account' }] } },
  '/account/password': { element: <ChangePassword />, handle: { crumbs: [{ label: 'Account', to: paths.account }, { label: 'Change password' }], back: back.account } },
  '/help': { element: <ComingSoon page="help" />, handle: { crumbs: [{ label: 'Help & support' }], back: back.account } },
  '/team': { element: <Team />, handle: { crumbs: [{ label: 'Team' }], back: back.account } },
}

/** A route's screen with its page title; signed-out pages load inside their own Suspense. */
function Page({ title, children, ownSuspense }: { title: string; children: ReactNode; ownSuspense: boolean }) {
  useDocumentTitle(title)
  // The signed-in shell has its own Suspense around the page, so its navigation stays on screen.
  return ownSuspense ? <Suspense fallback={<PageFallback />}>{children}</Suspense> : <>{children}</>
}

function route(portal: PortalRoute): RouteObject {
  const screen = screens[portal.path]!
  const signedOut = portal.access === 'public' || portal.access === 'open'
  return {
    path: portal.path,
    handle: screen.handle,
    element: (
      <Page title={portal.title} ownSuspense={signedOut}>
        {screen.element}
      </Page>
    ),
  }
}

const only = (access: Access) => portalRoutes.filter((portal) => portal.access === access).map(route)

/** An old address: the same query and fragment, at the new path. */
function Redirect({ to }: { to: string }) {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: to, search, hash }} replace />
}

function NotFoundPage() {
  return <NotFound embedded />
}

export const routes: RouteObject[] = [
  {
    element: <Outlet />,
    errorElement: <RouteError />,
    children: [
      ...Object.entries(redirects).map(([from, to]) => ({ path: from, element: <Redirect to={to} /> })),
      // Signed-out visitors only: login, sign-up, forgot password.
      { element: <PublicOnly />, children: only('public') },
      // Links from an email work whoever is signed in (a signed-in seller is asked first).
      { element: <OpenLink />, children: only('open') },
      {
        element: (
          <RequireAuth>
            <CrumbProvider>
              <AppShell />
            </CrumbProvider>
          </RequireAuth>
        ),
        children: [
          ...only('authenticated'),
          { element: <RequireRole role="owner" />, children: only('owner') },
          // An unknown address keeps the frame: the navigation is still there to find the way.
          { path: '*', element: <NotFoundPage />, handle: { crumbs: [{ label: 'Not found' }], back: back.home } satisfies RouteHandle },
        ],
      },
    ],
  },
]
