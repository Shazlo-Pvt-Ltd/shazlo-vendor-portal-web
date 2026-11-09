import { Navigate, type RouteObject } from 'react-router'
import { ModuleFrame } from './ModuleFrame'
import { ReviewQueue } from '../screens/queue/ReviewQueue'
import { ProductReview } from '../screens/review/ProductReview'
import { BrandReview } from '../screens/review/BrandReview'
import { VendorList } from '../screens/vendors/VendorList'
import { VendorApplication } from '../screens/vendors/VendorApplication'
import { PublishingStatus } from '../screens/publishing/PublishingStatus'

// Paths are relative to the module; the shell mounts them under /vendors.
export const routes: RouteObject[] = [
  {
    element: <ModuleFrame />,
    children: [
      { index: true, element: <Navigate to="/queue" replace /> },
      { path: 'queue', element: <ReviewQueue /> },
      { path: 'review/product/:id', element: <ProductReview /> },
      { path: 'review/brand/:id', element: <BrandReview /> },
      { path: 'vendors', element: <VendorList /> },
      { path: 'vendors/:id', element: <VendorApplication /> },
      { path: 'publishing', element: <PublishingStatus /> },
      { path: '*', element: <Navigate to="/queue" replace /> },
    ],
  },
]
