import { expect, test } from '@playwright/test'
import { expectAccessible, expectNoHorizontalScroll, freezeTime, settle, signIn } from './support'

// Every screen at 1440 px and 390 px: renders its heading, passes axe, never scrolls sideways,
// and matches its screenshot.

const signedOut = [
  { name: 'v01-sign-in', path: '/sign-in', heading: 'Sign in to your seller account' },
  { name: 'v02-apply', path: '/apply', heading: 'Apply to sell' },
  { name: 'v03-set-password', path: '/set-password?token=invite-kalki-demo', heading: 'Set your password' },
]

const signedIn = [
  { name: 'v04-overview', path: '/', heading: 'Overview' },
  { name: 'v05-brand-page', path: '/brand', heading: 'Brand page' },
  { name: 'v06-products', path: '/products', heading: 'Products' },
  { name: 'v07-product-editor', path: '/products/p_001', heading: 'Ajrakh Block-Print Kurta' },
  { name: 'v08-bulk-import', path: '/products/import', heading: 'Bulk import' },
  { name: 'v09-review-status', path: '/review', heading: 'Review status' },
]

for (const screen of signedOut) {
  test(`${screen.name} renders, is accessible and matches its screenshot`, async ({ page }, testInfo) => {
    await freezeTime(page)
    await page.goto(screen.path)
    await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible()
    await settle(page)
    await expectNoHorizontalScroll(page)
    await expectAccessible(page, testInfo)
    await expect(page).toHaveScreenshot(`${screen.name}.png`, { fullPage: true })
  })
}

for (const screen of signedIn) {
  test(`${screen.name} renders, is accessible and matches its screenshot`, async ({ page }, testInfo) => {
    await signIn(page)
    await page.goto(screen.path)
    await expect(page.getByRole('heading', { name: screen.heading }).first()).toBeVisible()
    await settle(page)
    await expectNoHorizontalScroll(page)
    await expectAccessible(page, testInfo)
    await expect(page).toHaveScreenshot(`${screen.name}.png`, { fullPage: true })
  })
}
