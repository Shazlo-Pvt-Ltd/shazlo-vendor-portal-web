export const paths = {
  signIn: '/sign-in',
  apply: '/apply',
  setPassword: '/set-password',
  forgotPassword: '/forgot-password',
  overview: '/',
  brand: '/brand',
  products: '/products',
  newProduct: '/products/new',
  product: (id: string) => `/products/${id}`,
  bulkImport: '/products/import',
  review: '/review',
  // The phone Store tab: Brand page, Store details and Commission.
  store: '/store',
  storeDetails: '/store/details',
  // One topic of the store details (pickup, payouts…), edited as a full-screen task.
  storeSection: (section: string) => `/store/details/${section}`,
  commission: '/store/details#commission',
  // The phone Account tab: Team, Help & support and Sign out.
  account: '/account',
  // Old address of Store details; it redirects there.
  settings: '/settings',
  team: '/team',
  help: '/help',
} as const
