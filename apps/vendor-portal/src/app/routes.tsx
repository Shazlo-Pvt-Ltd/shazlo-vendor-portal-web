import { Outlet, type RouteObject } from 'react-router'
import { NotFound } from '../components/NotFound'
import { RouteError } from '../components/RouteError'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { PublicOnly, RequireAuth, RequireRole } from '../session/guards'
import { portalRoutes, type PortalRoute } from './portalRoutes'

export { portalRoutes }
export type { Access, PortalRoute } from './portalRoutes'

function page(route: PortalRoute): RouteObject {
  return { path: route.path, element: <PlaceholderPage title={route.title} /> }
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
