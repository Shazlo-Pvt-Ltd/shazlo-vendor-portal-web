import { Button } from '@mui/material'
import { EmptyState } from '@shazlo/ui'
import { lazy } from 'react'
import { Link as RouterLink, Navigate, useRouteError, type RouteObject } from 'react-router'
import { useModuleTitle } from '../runtime/runtime'
import { ModuleRoot } from './App'

const Dashboard = lazy(() => import('../screens/dashboard/Dashboard'))
const ReviewQueue = lazy(() => import('../screens/queue/ReviewQueue'))
const ProductReview = lazy(() => import('../screens/review/ProductReview'))
const BrandReview = lazy(() => import('../screens/review/BrandReview'))
const VendorList = lazy(() => import('../screens/vendors/VendorList'))
const VendorDetail = lazy(() => import('../screens/vendors/VendorDetail'))
const Publishing = lazy(() => import('../screens/publishing/Publishing'))

export const modulePaths = {
  // The module's landing page: Shazlo One opens it when an admin clicks Vendors.
  dashboard: '/dashboard',
  queue: '/queue',
  product: (id: string) => `/review/product/${id}`,
  brand: (vendorId: string) => `/review/brand/${vendorId}`,
  vendors: '/vendors',
  vendor: (id: string) => `/vendors/${id}`,
  // Vendors whose proposed commission waits for Shazlo.
  rates: '/vendors?commission=proposed',
  publishing: '/publishing',
} as const

function NotFound() {
  useModuleTitle('Not found')
  return <EmptyState illustration="box" title="We could not find that page" body="The link may be old. Use the links under Vendors in the menu." action={<Button variant="contained" component={RouterLink} to={modulePaths.dashboard}>Open the vendor dashboard</Button>} />
}

function RouteError() {
  const error = useRouteError()
  if (import.meta.env.DEV) console.error(error)
  return <EmptyState illustration="sheet" title="This page did not load" body="Something went wrong on our side. Reload the page; nothing you decided is lost." action={<Button variant="contained" onClick={() => window.location.reload()}>Reload page</Button>} />
}

export const routes: RouteObject[] = [
  {
    element: <ModuleRoot />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to={modulePaths.dashboard} replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'queue', element: <ReviewQueue /> },
      { path: 'review/product/:id', element: <ProductReview /> },
      { path: 'review/brand/:vendorId', element: <BrandReview /> },
      { path: 'vendors', element: <VendorList /> },
      { path: 'vendors/:id', element: <VendorDetail /> },
      { path: 'publishing', element: <Publishing /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]
