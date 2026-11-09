import type { RouteObject } from 'react-router'
import { ModuleHost } from './ModuleHost'
import { modules } from './registry'
import { RequireSession } from './session'
import { ShellLayout } from './ShellLayout'
import { Admins } from '../screens/Admins'
import { Home } from '../screens/Home'
import { SignIn } from '../screens/SignIn'

export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignIn /> },
  {
    element: <RequireSession><ShellLayout /></RequireSession>,
    children: [
      { index: true, element: <Home /> },
      ...modules.map(m => ({ path: `${m.basePath.slice(1)}/*`, element: <ModuleHost key={m.id} module={m} /> })),
      { path: 'admins', element: <RequireSession role="super_admin"><Admins /></RequireSession> },
    ],
  },
]
