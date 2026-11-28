import { expect, test } from '@playwright/test'
import { E2E, TEMPORARY_PASSWORD, VENDORS } from './support/env'
import { createAdmin } from './support/identity'
import {
  CHANGE_PASSWORD_HEADING,
  HOME_HEADING,
  moduleFrame,
  moduleIframe,
  moduleQueueAnswer,
  openReviewQueue,
  SIGN_IN_HEADING,
  signInFirstTime,
  signOutFromSidebar,
  submitSignIn,
} from './support/shell'

test.describe('the main journey', () => {
  test('a new admin signs in, chooses a password, sees Home, opens the Vendors module with a token, and the shell follows it', async ({ page, request }) => {
    const admin = await createAdmin(request, 'journey', ['super_admin'])

    // Sign-in, then the forced password change, then Home.
    await signInFirstTime(page, admin)
    await expect(page).toHaveTitle('Shazlo One')
    // Home reads the module's summary from vendor-admin-api with a module token of its own (ADR 0011).
    await expect(page.getByRole('group', { name: 'Vendors' })).toBeVisible()
    await expect(page.getByText('Vendors figures did not load')).toHaveCount(0)

    // The sidebar lists the module from its manifest; opening it frames it on its home page, and the
    // module renders its dashboard only after the shell's `auth` reached it.
    await page.getByRole('navigation', { name: 'Shazlo One sections' }).getByRole('link', { name: /^Vendors/ }).click()
    await expect(page).toHaveURL(new RegExp(`${VENDORS.basePath}/dashboard$`))
    await expect(moduleFrame(page).getByRole('heading', { level: 1, name: 'Vendor dashboard' })).toBeVisible()
    await expect(moduleIframe(page)).toHaveAttribute('src', `${E2E.moduleUrl}/dashboard`)
    await expect(moduleIframe(page)).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads')

    // A page picked in the shell moves the module; the module calls its API with the token it was sent,
    // and the title and the address follow what the module says it shows.
    await openReviewQueue(page)
    await expect(page).toHaveTitle('Review queue · Vendors · Shazlo One')
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Review queue')

    // A deep link reopens the same module page after a full reload, with a new token.
    const reopened = moduleQueueAnswer(page)
    await page.reload()
    await expect(moduleFrame(page).getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible()
    await reopened
    await expect(page).toHaveURL(new RegExp(`${VENDORS.basePath}/queue$`))
    await expect(page).toHaveTitle('Review queue · Vendors · Shazlo One')

    await signOutFromSidebar(page)
    await expect(page.getByRole('heading', { level: 1, name: SIGN_IN_HEADING })).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
  })

  test('the shell holds a new admin at the password change until they choose one', async ({ page, request }) => {
    const admin = await createAdmin(request, 'forced', ['super_admin'])
    await page.goto('/sign-in')
    await submitSignIn(page, admin.email, TEMPORARY_PASSWORD)
    await expect(page.getByRole('heading', { level: 1, name: CHANGE_PASSWORD_HEADING })).toBeVisible()
    for (const path of ['/', `${VENDORS.basePath}/queue`, '/admins']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/change-password$/)
      await expect(page.getByRole('heading', { level: 1, name: CHANGE_PASSWORD_HEADING })).toBeVisible()
    }
    // No module was framed, so no module token was asked for.
    await expect(page.locator('iframe')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: HOME_HEADING })).toHaveCount(0)
  })

  test('a wrong password is refused with a message, and the admin stays signed out', async ({ page, request }) => {
    const admin = await createAdmin(request, 'wrongpw', ['super_admin'])
    await page.goto('/sign-in')
    await submitSignIn(page, admin.email, 'not the password at all 0000')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/sign-in$/)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: SIGN_IN_HEADING })).toBeVisible()
  })
})
