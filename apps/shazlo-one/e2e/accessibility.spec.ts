import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { CHOSEN_PASSWORD, TEMPORARY_PASSWORD } from './support/env'
import { createAdmin, type TestAdmin } from './support/identity'
import { openReferenceModule } from './support/shell'

/** WCAG 2.1 A and AA rules; a serious or critical violation fails the test. The module's own frame is not the shell's chrome. */
async function expectNoSeriousViolations(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('iframe')
    .analyze()
  const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  const report = serious.map((v) => `${v.impact} ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')
  expect(serious, `${name} has serious or critical accessibility problems:\n${report}`).toEqual([])
}

test.describe('signed out', () => {
  test('the login screen', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expectNoSeriousViolations(page, 'Login')
  })
})

test.describe('signed in', () => {
  let admin: TestAdmin

  test.beforeAll(async ({ request }) => {
    admin = await createAdmin(request, 'a11y', ['super_admin'])
  })

  test('the first-login password change, the home page, a module page and the admin screens', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email address').fill(admin.email)
    await page.getByLabel(/^Password(?: \*)?$/).fill(TEMPORARY_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Choose your password' })).toBeVisible()
    await expectNoSeriousViolations(page, 'First-login password change')

    // Finish the change, then walk the rest.
    await page.getByLabel(/^Current \(temporary\) password(?: \*)?$/).fill(TEMPORARY_PASSWORD)
    await page.getByLabel(/^New password(?: \*)?$/).fill(CHOSEN_PASSWORD)
    await page.getByLabel(/^Repeat the new password(?: \*)?$/).fill(CHOSEN_PASSWORD)
    await page.getByRole('button', { name: 'Save and continue' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Shazlo-One' })).toBeVisible()
    await expectNoSeriousViolations(page, 'Home')

    await openReferenceModule(page)
    await expectNoSeriousViolations(page, 'A module page (the shell around it)')

    await page.goto('/change-password')
    await expect(page.getByRole('heading', { level: 1, name: 'Change your password' })).toBeVisible()
    await expectNoSeriousViolations(page, 'Change password')

    await page.goto('/admins')
    await expect(page.getByRole('heading', { level: 1, name: 'Admins' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Admins' })).toBeVisible()
    await expectNoSeriousViolations(page, 'Admins list')

    await page.getByRole('button', { name: 'Create an admin' }).click()
    await expect(page.getByRole('dialog', { name: 'Create an admin' })).toBeVisible()
    await expectNoSeriousViolations(page, 'Create an admin dialog')
    await page.getByRole('button', { name: 'Cancel' }).click()

    await page.getByRole('button', { name: `Edit ${admin.name}` }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectNoSeriousViolations(page, 'Edit an admin dialog')
  })
})

