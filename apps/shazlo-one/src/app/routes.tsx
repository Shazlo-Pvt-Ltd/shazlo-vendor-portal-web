import type { RouteObject } from 'react-router'
import { NotFound } from '../components/NotFound'
import { RouteError } from '../components/RouteError'
import { ChangePasswordPage } from '../pages/ChangePasswordPage'
import { HomePage } from '../pages/HomePage'
import { LoginPage } from '../pages/LoginPage'
import { PublicOnly, RequireAuth, RequirePasswordChange } from '../session/guards'
import { CHANGE_PASSWORD_PATH, LOGIN_PATH } from './shellPaths'

/** Every path here must also be listed in `shellPaths`, which the `return-to` check reads. */
export const routes: RouteObject[] = [
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [{ path: '/', element: <HomePage />, errorElement: <RouteError /> }],
  },
  {
    element: <PublicOnly />,
    errorElement: <RouteError />,
    children: [{ path: LOGIN_PATH, element: <LoginPage />, errorElement: <RouteError /> }],
  },
  {
    element: <RequirePasswordChange />,
    errorElement: <RouteError />,
    children: [{ path: CHANGE_PASSWORD_PATH, element: <ChangePasswordPage />, errorElement: <RouteError /> }],
  },
  { path: '*', element: <NotFound />, errorElement: <RouteError /> },
]
