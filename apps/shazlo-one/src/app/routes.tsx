import type { RouteObject } from 'react-router'
import { NotFound } from '../components/NotFound'
import { RouteError } from '../components/RouteError'
import { StartPage } from '../pages/StartPage'

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      { index: true, element: <StartPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]
