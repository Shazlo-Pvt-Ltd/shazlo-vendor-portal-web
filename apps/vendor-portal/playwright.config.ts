import { defineConfig, devices } from '@playwright/test'

// Browser checks against the production build in demo mode: the mock API (MSW, src/mocks) answers
// in a service worker. main's preview port, 5174. Screenshots are compared per platform: CI (Linux)
// keeps its own baselines.
const PORT = 5174

// Demo builds still need a valid API address (src/config/env.ts); the mocks answer for it, so it is
// never contacted. `.invalid` can never resolve.
export const DEMO_API_URL = 'https://demo-api.shazlo.invalid'

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: `http://localhost:${PORT}`,
    // Build and preview read these; vite.config.ts relaxes nothing else for the demo.
    env: { VITE_MOCK_API: 'on', VITE_VENDOR_API_URL: DEMO_API_URL },
    reuseExistingServer: !process.env.CI,
    // Type-checking and building take several minutes on a slow machine.
    timeout: 600_000,
  },
})
