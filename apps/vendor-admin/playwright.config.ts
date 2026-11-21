import { defineConfig, devices } from '@playwright/test'

// Real-browser checks of the Vendors module inside Shazlo One, against the shared mock vendor-api.
// The three dev servers are the ones `apps/shazlo-one/README.md` starts; an already running set is
// reused locally. The tests share one mock database, so they run one at a time.
const SHELL = 'http://localhost:5192'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: SHELL,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
    // PW_CHANNEL=msedge (or chrome) runs an installed browser when Playwright's own is not downloaded.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  // Widths from the issue: a phone, a tablet, and a laptop where the shell's sidebar leaves the
  // module about 1,024 px.
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    // A 401 from a guarded route is enough to know the mock is up.
    { command: 'npm run serve -w @shazlo/mock-vendor-api', url: 'http://localhost:5194/api/v1/admin/summary', cwd: '../..', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'npm run dev -w @shazlo/vendor-admin', url: 'http://localhost:5193', cwd: '../..', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'npm run dev -w @shazlo/shazlo-one', url: SHELL, cwd: '../..', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
})
