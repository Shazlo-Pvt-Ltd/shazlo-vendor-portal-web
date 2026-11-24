import { expect, test } from '@playwright/test'
import { CHOSEN_PASSWORD, E2E, TEMPORARY_PASSWORD } from './support/env'
import { createAdmin } from './support/identity'
import { moduleFrame, signInFirstTime, submitSignIn } from './support/shell'

test.describe('roles', () => {
  test('a super admin creates a reviewer, who sees only what the role allows; deactivating them ends their session', async ({ browser, request }) => {
    const superAdmin = await createAdmin(request, 'boss', ['super_admin'])
    const boss = await (await browser.newContext({ baseURL: E2E.shellUrl })).newPage()
    await signInFirstTime(boss, superAdmin)

    // The super admin creates a vendor_reviewer from the Admins screen.
    await boss.locator('nav[aria-label="Modules"]').getByRole('link', { name: 'Admins' }).click()
    await expect(boss.getByRole('heading', { level: 1, name: 'Admins' })).toBeVisible()
    await boss.getByRole('button', { name: 'Create an admin' }).click()
    const dialog = boss.getByRole('dialog', { name: 'Create an admin' })
    const email = `reviewer-${Date.now().toString(36)}@e2e.shazlo.test`
    await dialog.getByLabel('Email address').fill(email)
    await dialog.getByLabel('Name').fill('E2E Reviewer')
    await dialog.getByLabel('vendor reviewer').check()
    await dialog.getByLabel('Temporary password', { exact: true }).fill(TEMPORARY_PASSWORD)
    await dialog.getByRole('button', { name: 'Create admin' }).click()
    await expect(boss.getByRole('dialog')).toHaveCount(0)
    await expect(boss.getByRole('row', { name: new RegExp(email) })).toBeVisible()

    // The reviewer signs in, chooses a password, and sees only the modules their role allows.
    const reviewerContext = await browser.newContext({ baseURL: E2E.shellUrl })
    const reviewer = await reviewerContext.newPage()
    await reviewer.goto('/login')
    await submitSignIn(reviewer, email, TEMPORARY_PASSWORD)
    await reviewer.getByLabel('Current (temporary) password', { exact: true }).fill(TEMPORARY_PASSWORD)
    await reviewer.getByLabel('New password', { exact: true }).fill(CHOSEN_PASSWORD)
    await reviewer.getByLabel('Repeat the new password', { exact: true }).fill(CHOSEN_PASSWORD)
    await reviewer.getByRole('button', { name: 'Save and continue' }).click()
    await expect(reviewer.getByRole('heading', { level: 1, name: 'Shazlo-One' })).toBeVisible()
    const nav = reviewer.locator('nav[aria-label="Modules"]')
    await expect(nav.getByRole('link', { name: 'Reference module' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Admins' })).toHaveCount(0)

    // "Admins" is the 403 page, and asked for nothing: no admin data is on it.
    await reviewer.goto('/admins')
    await expect(reviewer.getByRole('heading', { level: 1, name: "You don't have access to this page" })).toBeVisible()
    await expect(reviewer.getByText(superAdmin.email)).toHaveCount(0)

    // The reviewer can open their module and it works with a token for their role.
    await reviewer.goto('/m/reference')
    await expect(moduleFrame(reviewer).getByText(/vendor-api answered 200/)).toBeVisible()

    // The super admin deactivates them: their session ends, and they cannot get back in.
    await boss.getByRole('button', { name: 'Edit E2E Reviewer' }).click()
    await boss.getByRole('button', { name: 'Deactivate' }).click()
    await boss.getByRole('dialog', { name: 'Deactivate E2E Reviewer?' }).getByRole('button', { name: 'Deactivate' }).click()
    await expect(boss.getByText('E2E Reviewer was deactivated. Their sessions ended at once.')).toBeVisible()

    // Their refresh token was revoked, so the next load has no session.
    await reviewer.reload()
    await expect(reviewer.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(reviewer.locator('iframe')).toHaveCount(0)
    await submitSignIn(reviewer, email, CHOSEN_PASSWORD)
    await expect(reviewer.getByRole('alert')).toBeVisible()
    await expect(reviewer.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  })
})
