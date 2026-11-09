import type { RouteObject } from 'react-router'
import { RequireSession } from './session'
import { VendorShell } from './VendorShell'
import { SignIn } from '../screens/auth/SignIn'
import { Apply } from '../screens/auth/Apply'
import { SetPassword } from '../screens/auth/SetPassword'
import { Overview } from '../screens/overview/Overview'
import { BrandEditor } from '../screens/brand/BrandEditor'
import { ProductList } from '../screens/products/ProductList'
import { ProductEditor } from '../screens/products/ProductEditor'
import { BulkImport } from '../screens/import/BulkImport'
import { ReviewStatus } from '../screens/review/ReviewStatus'
import { ComingSoon, MoreMenu, NotFound } from '../screens/misc/Misc'

export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignIn /> },
  { path: '/apply', element: <Apply /> },
  { path: '/set-password', element: <SetPassword /> },
  {
    element: <RequireSession><VendorShell /></RequireSession>,
    children: [
      { index: true, element: <Overview /> },
      { path: 'brand', element: <BrandEditor /> },
      { path: 'products', element: <ProductList /> },
      { path: 'products/import', element: <BulkImport /> },
      { path: 'products/new', element: <ProductEditor /> },
      { path: 'products/:id', element: <ProductEditor /> },
      { path: 'review', element: <ReviewStatus /> },
      { path: 'more', element: <MoreMenu /> },
      { path: 'settings', element: <ComingSoon title="Store settings" /> },
      { path: 'team', element: <ComingSoon title="Team" /> },
      { path: 'help', element: <ComingSoon title="Help & support" /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]
