import { expect, test } from '@playwright/test'
import { DEMO, freezeTime, signIn } from './support'

// The seller journeys from the roadmap's definition of done, end to end in a real browser.

// A 1×1 PNG, enough for the mock upload to accept as a photo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('a new brand applies to sell in seven short steps', async ({ page }) => {
  await freezeTime(page)
  await page.goto('/signup')
  const step = (title: string) => expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  const next = () => page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Start' }).click()

  await step('Your brand')
  await page.getByRole('textbox', { name: 'Store name' }).fill('Neel Indigo House')
  await page.getByRole('group', { name: 'Who do you sell for?' }).getByRole('radio', { name: 'Both' }).check()
  await page.getByRole('textbox', { name: 'City or area you ship from' }).fill('Jaipur')
  await next()

  await step('Contact')
  await page.getByRole('textbox', { name: 'Your name' }).fill('Meera Joshi')
  await page.getByRole('textbox', { name: 'Mobile number' }).fill('98290 12345')
  await page.getByRole('textbox', { name: 'Email' }).fill('meera@neelindigo.in')
  await page.getByLabel('Choose a password', { exact: true }).fill('indigo-house-2026')
  await next()

  await step('Delivery')
  await page.getByRole('radio', { name: /^Shazlo delivery service/ }).check()
  await page.getByRole('textbox', { name: 'House or shop number, building and street' }).fill('14 Bagru Road')
  await page.getByRole('textbox', { name: 'Area' }).fill('Sanganer')
  await page.getByRole('textbox', { name: 'City', exact: true }).fill('Jaipur')
  await page.getByRole('textbox', { name: 'PIN code' }).fill('302029')
  await next()

  await step('Returns')
  await page.getByRole('radio', { name: 'No returns' }).check()
  await next()

  await step('Payment on delivery')
  await page.getByRole('checkbox', { name: 'UPI on delivery' }).check()
  await next()

  await step('Payouts')
  await page.getByRole('radio', { name: 'UPI ID' }).check()
  await page.getByRole('textbox', { name: 'UPI ID' }).fill('meera@okhdfcbank')
  await next()

  await step('Business details and commission')
  await page.getByRole('textbox', { name: 'Legal business name' }).fill('Meera Joshi')
  await page.getByRole('group', { name: 'Is your business registered for GST?' }).getByRole('radio', { name: /^No, not registered/ }).check()
  await page.getByRole('radio', { name: 'Propose a rate' }).check()
  await page.getByRole('textbox', { name: 'Rate you propose, in %' }).fill('12')
  await page.getByRole('checkbox', { name: /I agree to the/ }).check()
  await page.getByRole('checkbox', { name: /never be higher than my price anywhere else/ }).check()
  await next()

  await step('Check your answers')
  await page.getByRole('button', { name: 'Send application' }).click()
  await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible()
  await expect(page.getByText(/We sent an email to meera@neelindigo\.in/)).toBeVisible()
})

test('a seller fixes a sent-back product and resubmits it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Same flow; the desktop run covers it')
  await signIn(page)
  await expect(page.getByRole('alert').filter({ hasText: '2 products were sent back' })).toBeVisible()
  await page.getByRole('link', { name: 'See feedback' }).or(page.getByRole('button', { name: 'See feedback' })).click()
  await page.getByRole('link', { name: 'Fix and resubmit Ajrakh Block-Print Kurta' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Ajrakh Block-Print Kurta' })).toBeVisible()
  await expect(page.getByLabel('Add back photo')).toBeVisible()

  // The back photo fills the empty Back slot; three try-on photos make five.
  const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG })
  await page.getByLabel('Product photo files').setInputFiles(png('back.png'))
  await expect(page.getByAltText('Back photo')).toBeVisible()
  await page.getByLabel('Try-on photo files').setInputFiles([png('t3.png'), png('t4.png'), png('t5.png')])
  await expect(page.getByText('9 of 9 added')).toBeVisible()

  // The demo store has no payout details yet, so sending lists that first.
  await page.getByRole('button', { name: 'Send for review again' }).click()
  await page.getByRole('link', { name: 'Store details: Finish your store details first.' }).click()
  await page.getByRole('region', { name: 'Payouts' }).getByRole('link', { name: 'Change Payouts' }).click()
  await page.getByRole('radio', { name: 'UPI ID' }).check()
  await page.getByRole('textbox', { name: 'UPI ID' }).fill('kiran@okhdfcbank')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Your store details are complete. You can send products for review.')).toBeVisible()

  // Back to the product through the app: a reload would sign out of the demo.
  await page.getByRole('navigation', { name: 'Seller sections' }).getByRole('link', { name: /^Products/ }).click()
  await page.getByRole('link', { name: /Ajrakh Block-Print Kurta/ }).first().click()
  await page.getByRole('button', { name: 'Send for review again' }).click()
  await expect(page.getByText(/Sent for review/).first()).toBeVisible()
})

test('a seller edits the brand page draft and sends it for review', async ({ page }) => {
  await signIn(page, '/brand')
  const story = page.getByRole('textbox', { name: /^Story/ })
  await story.fill('We work with Ajrakh printers in Kutch and dye every metre by hand.')
  // The brand page has no tagline any more.
  await expect(page.getByRole('textbox', { name: /^Tagline/ })).toHaveCount(0)
  await expect(page.getByText(/Saved · /).first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await expect(page.getByText('Sent for review. Your live page stays as it is until we approve the changes.')).toBeVisible()
})

// Staying signed in across reloads is vendor-api's refresh cookie; demo mode keeps its data in page
// memory, so these journeys move with in-app links rather than reloads.
test('signing in lands on Home and signing out ends the session', async ({ page }, testInfo) => {
  await freezeTime(page)
  await page.goto('/login')
  await page.getByLabel('Work email').fill(DEMO.email)
  await page.getByLabel('Password', { exact: true }).fill(DEMO.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  const home = page.getByRole('heading', { level: 1, name: testInfo.project.name === 'mobile' ? 'Home' : 'Overview' })
  await expect(home).toBeVisible()
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Account' }).click()
  }
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to your seller account' })).toBeVisible()
  // Signing in and out replace the history entry, so Back never shows the signed-in pages again.
  await page.goBack()
  await expect(home).toHaveCount(0)
})

test('a signed-out deep link returns to its page after signing in', async ({ page }) => {
  await freezeTime(page)
  await page.goto('/store/details')
  await expect(page).toHaveURL(/\/login\?next=%2Fstore%2Fdetails$/)
  await page.getByLabel('Work email').fill(DEMO.email)
  await page.getByLabel('Password', { exact: true }).fill(DEMO.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Store details' })).toBeVisible()
})

test('phones move between the four tabs and back from inner pages', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Phone navigation only')
  await signIn(page)
  const tabs = page.getByRole('navigation', { name: 'Main' })
  await tabs.getByRole('link', { name: 'Products' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible()
  await tabs.getByRole('link', { name: 'Home' }).click()
  await page.getByRole('link', { name: 'See all review decisions' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Review status' })).toBeVisible()
  await tabs.getByRole('link', { name: 'Store' }).click()
  await page.getByRole('navigation', { name: 'Store pages' }).getByRole('link', { name: /^Brand page/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Brand page' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Store' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Store' })).toBeVisible()
})
