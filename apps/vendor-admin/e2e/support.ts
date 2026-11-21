import AxeBuilder from '@axe-core/playwright'
import { expect, type APIRequestContext, type FrameLocator, type Locator, type Page, type TestInfo } from '@playwright/test'

export const MOCK_API = 'http://localhost:5194'
// The demo reviewer from apps/shazlo-one/README.md (mock identity-api in the browser, mock data only).
const REVIEWER = { email: 'priya@shazlo.store', password: 'shazlo-one-2026' }

// A token the mock vendor-api accepts, for checking its state directly (the format of
// `mockModuleToken` in packages/mock-vendor-api: mock.vendor-api.<admin id>.<name>.<expiry>).
export const mockToken = () => `mock.vendor-api.a_e2e.${encodeURIComponent('E2E check')}.${Math.floor(Date.now() / 1000) + 300}`

// Every test starts from the seed: the shell and the module share the mock's one database.
export async function resetMock(request: APIRequestContext) {
  const response = await request.post(`${MOCK_API}/__reset`)
  expect(response.status()).toBe(204)
}

export async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel('Work email').fill(REVIEWER.email)
  await page.getByLabel('Password', { exact: true }).fill(REVIEWER.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/')
}

// The Vendors module runs in Shazlo One's iframe, on its own origin.
export const vendorsModule = (page: Page): FrameLocator => page.frameLocator('iframe[title="Vendors"]')
export const moduleFrame = (page: Page) => {
  const frame = page.frames().find((f) => f.url().startsWith('http://localhost:5193'))
  if (!frame) throw new Error('The Vendors module is not loaded')
  return frame
}

export async function openInShell(page: Page, path: string, heading: string) {
  await page.goto(`/vendors${path}`)
  await expect(vendorsModule(page).getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 30_000 })
  await expect(vendorsModule(page).locator('[aria-busy="true"]')).toHaveCount(0)
}

// Whether `locator` is the focused element of its frame. (Playwright's toBeFocused also wants the
// frame's document to have system focus, which a headless browser does not give a cross-origin iframe.)
export const isActive = (locator: Locator) => locator.evaluate((el) => el === el.ownerDocument.activeElement)

// Whether keyboard focus is on one of the commission card's buttons, inside the module's frame.
export const focusInCardActions = (page: Page) => moduleFrame(page).evaluate(() => Boolean(document.activeElement?.closest('[role="group"][aria-label="Commission actions"]')))

export async function box(locator: { boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> }) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('Not visible')
  return b
}

// Fails on serious or critical WCAG A/AA problems inside the Vendors module's frame (the shell's
// own chrome is Shazlo One's to check).
export async function expectAccessible(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).include('iframe[title="Vendors"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  await testInfo.attach('axe-violations', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' })
  // One line per element: where it is (frame >> element), the start of its markup (quoted as text,
  // never rendered), and what axe measured.
  const lines = blocking.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' >> ')} ${JSON.stringify(n.html.slice(0, 80))} ${n.any[0]?.message ?? v.help}`))
  expect(lines).toEqual([])
}
