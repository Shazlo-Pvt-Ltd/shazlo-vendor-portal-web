import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type TestInfo } from '@playwright/test'

// The seed data is relative to "now"; freezing the clock keeps dates and screenshots stable.
export const FROZEN_NOW = new Date('2026-10-31T12:00:00+05:30')
export const DEMO = { email: 'kiran@kalkistudio.in', password: 'ajrakh-indigo-26' }

export async function freezeTime(page: Page) {
  await page.clock.setFixedTime(FROZEN_NOW)
}

export async function signIn(page: Page, next = '/') {
  await freezeTime(page)
  await page.goto(next === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Work email').fill(DEMO.email)
  await page.getByLabel('Password', { exact: true }).fill(DEMO.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === (next.split('?')[0] ?? '/'))
}

// Fails on serious or critical WCAG A/AA problems; lists them so the report says what to fix.
export async function expectAccessible(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  await testInfo.attach('axe-violations', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' })
  expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([])
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

export async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
}
