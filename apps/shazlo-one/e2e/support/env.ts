/**
 * Where the end-to-end stack lives. The defaults are docker-compose.yml's ports and the two Vite dev
 * servers on this machine: the shell on 5192 and the Vendors module on 5193, the origins identity-api's
 * CORS list, vendor-admin-api's CORS list and the shell's development registry already name.
 */
export const E2E = {
  shellUrl: process.env.E2E_SHELL_URL ?? 'http://localhost:5192',
  moduleUrl: process.env.E2E_MODULE_URL ?? 'http://localhost:5193',
  identityUrl: process.env.E2E_IDENTITY_URL ?? 'http://localhost:8001',
  /** vendor-api's admin app (ADR 0011): the Vendors module's backend and the source of Home's summary. */
  vendorAdminApiUrl: process.env.E2E_VENDOR_ADMIN_API_URL ?? 'http://localhost:8004',
  /** The super admin seeded into identity-api (`identity_api.cli seed`). The tests use it only to create and deactivate other admins. */
  adminEmail: process.env.E2E_ADMIN_EMAIL ?? 'admin@shazlo.test',
  /** The password the seeded admin is given on first use: a freshly seeded admin must change theirs first (identity.ts). */
  adminPassword: process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password-2',
  /** The password the admin was seeded with. */
  adminSeedPassword: process.env.E2E_ADMIN_SEED_PASSWORD ?? 'e2e-admin-password-1',
} as const

/** The temporary password every test admin is created with, and the one they choose at first sign-in. */
export const TEMPORARY_PASSWORD = 'e2e temporary passphrase 4821'
export const CHOSEN_PASSWORD = 'e2e chosen passphrase 7350'

/** The module's registry entry (registry/development.json) and its manifest title (apps/vendor-admin/public/shazlo-module.json). */
export const VENDORS = { title: 'Vendors', basePath: '/vendors' } as const

/** An address no other run has used, so tests never meet each other's admins. */
export function uniqueEmail(label: string): string {
  return `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@e2e.shazlo.test`
}
