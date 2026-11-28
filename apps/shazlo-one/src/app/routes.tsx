import type { RouteObject } from 'react-router'
import { NotFound } from '../components/NotFound'
import { RouteError } from '../components/RouteError'
import { HomePage } from '../pages/HomePage'

export const routes: RouteObject[] = [
  { path: '/', element: <HomePage />, errorElement: <RouteError /> },
  { path: '*', element: <NotFound />, errorElement: <RouteError /> },
]
