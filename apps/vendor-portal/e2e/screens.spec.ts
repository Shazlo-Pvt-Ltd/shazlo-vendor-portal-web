import { expect, test } from '@playwright/test'
import { expectAccessible, expectNoHorizontalScroll, freezeTime, settle, signIn } from './support'

// Every screen at 1440 px and 390 px: renders its heading, passes axe, never scrolls sideways,
// and matches its screenshot.

const signedOut = [
  { name: 'v01-sign-in', path: '/login', heading: 'Sign in to your seller account' },
  { name: 'v02-apply', path: '/signup', heading: 'Apply to sell' },
  { name: 'v03-set-password', path: '/set-password#token=invite-kalki-demo', heading: 'Set your password' },
  { name: 'forgot-password', path: '/forgot-password', heading: 'Reset your password' },
  { name: 'verify-email-used-link', path: '/verify-email#token=not-a-real-token', heading: 'This link has expired or was already used' },
]

const signedIn = [
  // Phones get the calmer Home (spec §4); 1440 px keeps the Build 2 Overview.
  { name: 'v04-overview', path: '/', heading: /^(Overview|Home)$/ },
  { name: 'v05-brand-page', path: '/brand', heading: 'Brand page' },
  { name: 'v06-products', path: '/products', heading: 'Products' },
  // Product ids are uuids made by the mock, so the editor is opened from the list.
  // Phones edit one step at a time, so the heading there is the first step.
  { name: 'v07-product-editor', path: '/products', open: /Ajrakh Block-Print Kurta/, heading: /^(Ajrakh Block-Print Kurta|Photos)$/ },
  { name: 'v08-bulk-import', path: '/products/import', heading: 'Bulk import' },
  { name: 'v09-review-status', path: '/review', heading: 'Review status' },
  { name: 'store', path: '/store', heading: 'Store' },
  { name: 'store-details', path: '/store/details', heading: 'Store details' },
  { name: 'store-details-payout', path: '/store/details/payout', heading: 'Payouts' },
  { name: 'account', path: '/account', heading: 'Account' },
  { name: 'change-password', path: '/account/password', heading: 'Change password' },
  { name: 'team', path: '/team', heading: 'Team' },
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
    // Demo mode keeps its data in page memory, so a reload signs out: sign in straight to the page.
    await signIn(page, screen.path)
    if ('open' in screen && screen.open) await page.getByRole('link', { name: screen.open }).first().click()
    await expect(page.getByRole('heading', { name: screen.heading }).first()).toBeVisible()
    await settle(page)
    await expectNoHorizontalScroll(page)
    await expectAccessible(page, testInfo)
    await expect(page).toHaveScreenshot(`${screen.name}.png`, { fullPage: true })
  })
}
