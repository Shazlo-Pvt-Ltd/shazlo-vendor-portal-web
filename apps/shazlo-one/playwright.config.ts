import { defineConfig, devices } from '@playwright/test'
import { E2E } from './e2e/support/env'

/**
 * The shell's browser tests, against the real stack from docker-compose.yml: identity-api, vendor-api's
 * admin app (vendor-admin-api), Postgres, Redis and Mailpit. README.md, "End-to-end tests", has the
 * steps; CI runs them in .github/workflows/e2e-shazlo-one.yml.
 *
 * The shell and the Vendors module run as Vite dev servers on the origins everything already names:
 * the shell on 5192 with the browser mock off (so it uses registry/development.json: the module on
 * 5193, its summary on vendor-admin-api's 8004, and identity-api through the shell's own origin, which
 * keeps the SameSite=Strict refresh cookie first-party), the module on 5193 calling vendor-admin-api.
 * The headers are the same definition as production's, apart from the dev-only inline script.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // One worker: the tests share one stack and identity-api's per-address rate limits; each makes its own admin.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: E2E.shellUrl,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  // Desktop only: the sidebar the helpers use is the desktop one (below 900 px it is a drawer).
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'npm run dev',
      url: E2E.shellUrl,
      env: { VITE_MOCK_API: 'off', VITE_IDENTITY_PROXY_TARGET: E2E.identityUrl },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev',
      cwd: '../vendor-admin',
      url: E2E.moduleUrl,
      env: { VITE_SHELL_ORIGIN: E2E.shellUrl, VITE_VENDOR_API_URL: E2E.vendorAdminApiUrl },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
