// Addresses the screens link to. The route table is src/app/portalRoutes.ts; old addresses
// (/sign-in, /apply, /settings, /submissions, /import) redirect there.
export const paths = {
  // Main's addresses: vendor-api's emails link to them.
  signIn: '/login',
  apply: '/signup',
  forgotPassword: '/forgot-password',
  verifyEmail: '/verify-email',
  setPassword: '/set-password',
  overview: '/',
  brand: '/brand',
  products: '/products',
  newProduct: '/products/new',
  product: (id: string) => `/products/${encodeURIComponent(id)}`,
  bulkImport: '/products/import',
  review: '/review',
  // The phone Store tab: Brand page, Store details and Commission.
  store: '/store',
  storeDetails: '/store/details',
  // One topic of the store details (pickup, payouts…), edited as a full-screen task.
  storeSection: (section: string) => `/store/details/${encodeURIComponent(section)}`,
  commission: '/store/details#commission',
  // The phone Account tab: Team (owners), password, Help & support and Sign out.
  account: '/account',
  accountPassword: '/account/password',
  team: '/team',
  help: '/help',
} as const
