import { defineConfig, devices } from '@playwright/test'
import { E2E } from './e2e/support/env'

/**
 * The shell's browser tests, against the real stack (docker-compose.yml + docker-compose.e2e.yml:
 * identity-api, vendor-api, Postgres, Redis, Mailpit and the image-host stub). README.md, "End-to-end
 * tests", has the steps. The shell and the reference module run as Vite dev servers: the reference
 * module is development-only and is in the development registry only, so a production build of the
 * shell does not frame it. The ports are the origins the APIs' CORS and the SameSite=Strict refresh
 * cookie expect (shell 5173, module 5175).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // One worker: the journeys share one stack and its per-IP rate limits, and each test makes its own admin.
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
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev',
      url: E2E.shellUrl,
      env: { VITE_IDENTITY_API_URL: E2E.identityUrl },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev:module',
      url: E2E.moduleUrl,
      env: { VITE_SHELL_ORIGIN: E2E.shellUrl, VITE_VENDOR_API_URL: E2E.vendorApiUrl },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
