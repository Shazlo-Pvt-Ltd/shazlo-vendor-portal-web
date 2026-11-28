import { expect, test } from '@playwright/test'
import { CHOSEN_PASSWORD, E2E, VENDORS } from './support/env'
import { createAdmin, deactivateAdmin } from './support/identity'
import { moduleFrame, moduleQueueAnswer, SIGN_IN_HEADING, sidebar, signInFirstTime, submitSignIn } from './support/shell'

const FORBIDDEN_ADMINS = 'Only super admins can manage admins'

test.describe('roles', () => {
  test('a vendor reviewer gets the 403 page for Admins & roles, opens the Vendors module, and loses the session when deactivated', async ({ page, request }) => {
    const reviewer = await createAdmin(request, 'reviewer', ['vendor_reviewer'])
    await signInFirstTime(page, reviewer)

    // The sidebar offers only what the role allows: the Vendors module, not Admins & roles.
    await expect(sidebar(page).getByRole('link', { name: /^Vendors/ })).toBeVisible()
    await expect(sidebar(page).getByRole('link', { name: 'Admins & roles' })).toHaveCount(0)

    // Typing the address gets the 403 page, which asked identity-api for nothing: no admin is listed on it.
    // (Home's activity may still read `/v1/admins/names`, which every admin may; the list routes are super admin only.)
    const adminCalls: string[] = []
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname
      if (path.startsWith('/v1/admins') && !path.startsWith('/v1/admins/names')) adminCalls.push(req.url())
    })
    await page.goto('/admins')
    await expect(page.getByRole('heading', { name: FORBIDDEN_ADMINS })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByText(E2E.adminEmail)).toHaveCount(0)
    expect(adminCalls, 'the 403 page called no admin route').toEqual([])

    // The module their role allows opens, with a token vendor-admin-api accepts for a reviewer.
    const answered = moduleQueueAnswer(page)
    await page.goto(`${VENDORS.basePath}/queue`)
    await expect(moduleFrame(page).getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible()
    await answered

    // A super admin deactivates them: identity-api revokes their sessions, so the next load has none,
    // and they cannot sign in again.
    await deactivateAdmin(request, reviewer)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: SIGN_IN_HEADING })).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
    await submitSignIn(page, reviewer.email, CHOSEN_PASSWORD)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: SIGN_IN_HEADING })).toBeVisible()
  })

  test('a super admin sees Admins & roles with the admin list', async ({ page, request }) => {
    const boss = await createAdmin(request, 'boss', ['super_admin'])
    await signInFirstTime(page, boss)
    await sidebar(page).getByRole('link', { name: 'Admins & roles' }).click()
    await expect(page).toHaveURL(/\/admins$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Admins & roles' })).toBeVisible()
    await expect(page.getByRole('heading', { name: FORBIDDEN_ADMINS })).toHaveCount(0)
    await expect(page.getByText(boss.email)).toBeVisible()
  })
})
