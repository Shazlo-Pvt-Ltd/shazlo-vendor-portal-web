import { expect, test } from '@playwright/test'
import { DEMO, freezeTime, signIn } from './support'

// The seller journeys from the roadmap's definition of done, end to end in a real browser.

// A 1×1 PNG, enough for the mock upload to accept as a photo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('a new brand applies to sell in three steps', async ({ page }) => {
  await freezeTime(page)
  await page.goto('/apply')
  await page.getByLabel('Brand name').fill('Neel Indigo House')
  await page.getByLabel('City').fill('Jaipur, Rajasthan')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Your name').fill('Meera Joshi')
  await page.getByLabel('Work email').fill('meera@neelindigo.in')
  await page.getByLabel('Mobile number').fill('98290 12345')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Kurtas' }).click()
  await page.getByLabel('Lowest price').fill('1,499')
  await page.getByLabel('Highest price').fill('4,999')
  await page.getByLabel('Tell us about your label').fill('Indigo-dyed cotton, block printed by a family workshop in Sanganer since 1998.')
  await page.getByRole('button', { name: 'Send application' }).click()
  await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible()
})

test('a seller fixes a sent-back product and resubmits it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Same flow; the desktop run covers it')
  await signIn(page)
  await expect(page.getByRole('alert').filter({ hasText: '2 products were sent back' })).toBeVisible()
  await page.getByRole('link', { name: 'See feedback' }).or(page.getByRole('button', { name: 'See feedback' })).click()
  await page.getByRole('link', { name: 'Fix and resubmit Ajrakh Block-Print Kurta' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Ajrakh Block-Print Kurta' })).toBeVisible()
  await expect(page.getByText('Back photo is missing.').first()).toBeVisible()

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload back' }).click()
  await (await chooser).setFiles({ name: 'back.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('button', { name: 'Upload back' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Resubmit for review' }).click()
  await expect(page.getByText(/Sent for review/).first()).toBeVisible()
  await expect(page.locator('[data-status="pending"]').first()).toBeVisible()
})

test('a seller edits the brand page draft and sends it for review', async ({ page }) => {
  await signIn(page, '/brand')
  const tagline = page.getByLabel('Tagline', { exact: false }).first()
  await tagline.fill('Hand block-printed in Kutch, naturally dyed.')
  await expect(page.getByText(/Saved · /).first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await expect(page.getByText('Sent for review. Your live page stays as it is until we approve the changes.')).toBeVisible()
})

test('"Keep me signed in" survives a reload and sign out ends the session', async ({ page }, testInfo) => {
  await freezeTime(page)
  await page.goto('/sign-in')
  await page.getByLabel('Work email').fill(DEMO.email)
  await page.getByLabel('Password', { exact: true }).fill(DEMO.password)
  await page.getByLabel('Keep me signed in on this device').check()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'More' }).click()
  }
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)
})

test('phones move between sections with the tab bar and More', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Phone navigation only')
  await signIn(page)
  const tabs = page.getByRole('navigation', { name: 'Main' })
  await tabs.getByRole('link', { name: 'Products' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible()
  await tabs.getByRole('link', { name: 'Review' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Review status' })).toBeVisible()
  await tabs.getByRole('button', { name: 'More' }).click()
  await page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'Brand page' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Brand page' })).toBeVisible()
})
