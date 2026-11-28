import type { RouteObject } from 'react-router'
import { NotFound } from '../components/NotFound'
import { RouteError } from '../components/RouteError'
import { ShellLayout } from '../components/ShellLayout'
import { SUPER_ADMIN } from '../modules/registry'
import { AdminsPage } from '../pages/AdminsPage'
import { ChangePasswordPage } from '../pages/ChangePasswordPage'
import { HomePage } from '../pages/HomePage'
import { LoginPage } from '../pages/LoginPage'
import { ModulePage } from '../pages/ModulePage'
import { PublicOnly, RequireAuth, RequirePasswordChange, RequireRole } from '../session/guards'
import { ADMINS_PATH, CHANGE_PASSWORD_PATH, LOGIN_PATH } from './shellPaths'

/** Every path here must also be listed in `shellPaths`, which the `return-to` check reads. */
export const routes: RouteObject[] = [
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <ShellLayout />,
        children: [
          { path: '/', element: <HomePage />, errorElement: <RouteError /> },
          // The module id picks a registry entry; the rest of the path belongs to the module.
          { path: '/m/:moduleId/*', element: <ModulePage />, errorElement: <RouteError /> },
          {
            path: ADMINS_PATH,
            element: (
              <RequireRole anyOf={[SUPER_ADMIN]}>
                <AdminsPage />
              </RequireRole>
            ),
            errorElement: <RouteError />,
          },
        ],
      },
    ],
  },
  {
    element: <PublicOnly />,
    errorElement: <RouteError />,
    children: [{ path: LOGIN_PATH, element: <LoginPage />, errorElement: <RouteError /> }],
  },
  {
    element: <RequirePasswordChange />,
    errorElement: <RouteError />,
    children: [
      {
        element: <ShellLayout />,
        children: [{ path: CHANGE_PASSWORD_PATH, element: <ChangePasswordPage />, errorElement: <RouteError /> }],
      },
    ],
  },
  { path: '*', element: <NotFound />, errorElement: <RouteError /> },
]
