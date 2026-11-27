import { lazy, Suspense, type ReactNode } from 'react'
import { Outlet, type RouteObject } from 'react-router'
import { ModuleRoute, NotFound, RouteError, SuperAdminOnly } from '../screens/Misc'
import { GuestOnly, RequireAdmin } from '../session/guards'
import { PageFallback } from '../shell/PageFallback'
import { ShellLayout } from '../shell/ShellLayout'
import { CrumbProvider, type RouteHandle } from './crumbs'
import { registry } from './registry'

const SignIn = lazy(() => import('../screens/SignIn'))
const ChangePassword = lazy(() => import('../screens/ChangePassword'))
const Home = lazy(() => import('../screens/Home'))
const Admins = lazy(() => import('../screens/Admins'))

const page = (node: ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>
const crumbs = (...list: NonNullable<RouteHandle['crumbs']>): RouteHandle => ({ crumbs: list })

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      { element: <GuestOnly><Outlet /></GuestOnly>, children: [{ path: '/sign-in', element: page(<SignIn />) }] },
      { path: '/change-password', element: <RequireAdmin>{page(<ChangePassword />)}</RequireAdmin> },
      {
        path: '/',
        element: (
          <RequireAdmin>
            <CrumbProvider>
              <ShellLayout />
            </CrumbProvider>
          </RequireAdmin>
        ),
        children: [
          { index: true, element: <Home />, handle: crumbs({ label: 'Home' }) },
          { path: 'admins', element: <SuperAdminOnly><Admins /></SuperAdminOnly>, handle: crumbs({ label: 'Admins & roles' }) },
          // One route per registered module (ADR 0011); the crumb uses the registry title, which a module's
          // manifest title should match.
          ...registry.map((m) => ({ path: `${m.basePath.slice(1)}/*`, element: <ModuleRoute entry={m} />, handle: crumbs({ label: m.fallbackTitle, to: m.basePath }) })),
          { path: '*', element: <NotFound />, handle: crumbs({ label: 'Not found' }) },
        ],
      },
    ],
  },
]
