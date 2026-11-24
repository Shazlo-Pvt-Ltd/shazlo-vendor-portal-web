/** Where the end-to-end stack lives. The defaults are docker-compose's ports and the dev servers on this machine. */
export const E2E = {
  shellUrl: process.env.E2E_SHELL_URL ?? 'http://localhost:5173',
  moduleUrl: process.env.E2E_MODULE_URL ?? 'http://localhost:5175',
  identityUrl: process.env.E2E_IDENTITY_URL ?? 'http://localhost:8001',
  vendorApiUrl: process.env.E2E_VENDOR_API_URL ?? 'http://localhost:8002',
  /** The admin seeded into identity-api (`identity_api.cli seed`): the tests use it only to create other admins. */
  adminEmail: process.env.E2E_ADMIN_EMAIL ?? 'admin@shazlo.test',
  /** The password the tests give the seeded admin. A freshly seeded admin must change theirs first: see `identity.ts`. */
  adminPassword: process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password-2',
  /** The password the admin was seeded with, changed to `adminPassword` on first use. */
  adminSeedPassword: process.env.E2E_ADMIN_SEED_PASSWORD ?? 'e2e-admin-password-1',
} as const

/** The temporary password every test admin is created with, and the one they choose at first sign-in. */
export const TEMPORARY_PASSWORD = 'e2e temporary passphrase 4821'
export const CHOSEN_PASSWORD = 'e2e chosen passphrase 7350'

/** An address no other run has used, so tests never meet each other's admins. */
export function uniqueEmail(label: string): string {
  return `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@e2e.shazlo.test`
}
