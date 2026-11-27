import { expect, test } from '@playwright/test'
import { TEMPORARY_PASSWORD } from './support/env'
import { createAdmin } from './support/identity'
import { moduleFrame, openReferenceModule, signInFirstTime, signOutFromMenu } from './support/shell'

test.describe('the main journey', () => {
  test('a new admin signs in, chooses a password, opens the module, and the shell follows it', async ({ page, request }) => {
    const admin = await createAdmin(request, 'journey', ['super_admin'])

    await signInFirstTime(page, admin)
    await expect(page).toHaveTitle('Home · Shazlo-One')

    // The reference module calls vendor-api with the token the shell exchanged for it.
    await openReferenceModule(page)
    await expect(page).toHaveURL(/\/m\/reference$/)
    const module = moduleFrame(page)
    await expect(module.getByText(admin.email)).toBeVisible()

    // The title and the address follow the module's own navigation.
    await module.getByRole('button', { name: /Orders \(example\)/ }).click()
    await expect(page).toHaveURL(/\/m\/reference\/pages\/orders$/)
    await expect(page).toHaveTitle('Orders (example) · Reference module · Shazlo-One')

    // A toast is shown by the shell, not the module, and says who sent it.
    await module.getByRole('button', { name: 'Send a success toast' }).click()
    const toast = page.locator('[aria-live="polite"]').filter({ hasText: 'A success message from the reference module.' })
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('Reference module')

    // A deep link reopens the same module page, after a full reload.
    const deepLink = page.url()
    await page.goto(deepLink)
    await expect(moduleFrame(page).getByRole('heading', { level: 1, name: 'Reference module' })).toBeVisible()
    await expect(moduleFrame(page).locator('code')).toHaveText('/pages/orders')
    await expect(page).toHaveTitle('Orders (example) · Reference module · Shazlo-One')
    await expect(moduleFrame(page).getByText(/vendor-api answered 200/)).toBeVisible()

    await signOutFromMenu(page, admin)
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  })

  test('the shell holds a new admin at the password change until they choose one', async ({ page, request }) => {
    const admin = await createAdmin(request, 'forced', ['vendor_reviewer'])
    await page.goto('/login')
    await page.getByLabel('Email address').fill(admin.email)
    await page.getByLabel(/^Password(?: \*)?$/).fill(TEMPORARY_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Choose your password' })).toBeVisible()
    for (const path of ['/', '/m/reference', '/admins']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1, name: 'Choose your password' })).toBeVisible()
    }
    await expect(page.locator('iframe')).toHaveCount(0)
  })
})
