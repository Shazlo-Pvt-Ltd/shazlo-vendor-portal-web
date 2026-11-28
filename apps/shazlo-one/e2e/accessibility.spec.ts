import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { TEMPORARY_PASSWORD, VENDORS } from './support/env'
import { createAdmin } from './support/identity'
import { choosePassword, HOME_HEADING, moduleQueueAnswer, SIGN_IN_HEADING, moduleFrame, signInFirstTime, submitSignIn } from './support/shell'

/**
 * WCAG 2.1 A and AA; a serious or critical violation fails the test, and every violation is attached
 * to the report. The module's frame is the module's own page (its tests check it), not the shell's chrome.
 */
async function expectNoSeriousViolations(page: Page, testInfo: TestInfo, name: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('iframe').analyze()
  await testInfo.attach(`axe ${name}`, { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' })
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  const report = serious.map((v) => `${v.impact} ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')
  expect(serious, `${name} has serious or critical accessibility problems:\n${report}`).toEqual([])
}

test.describe('accessibility (axe)', () => {
  test('sign-in, the first-login password change, Home, a module page, Admins & roles and the invite dialog', async ({ page, request }, testInfo) => {
    const admin = await createAdmin(request, 'a11y', ['super_admin'])

    await page.goto('/sign-in')
    await expect(page.getByRole('heading', { level: 1, name: SIGN_IN_HEADING })).toBeVisible()
    await expectNoSeriousViolations(page, testInfo, 'Sign in')

    await submitSignIn(page, admin.email, TEMPORARY_PASSWORD)
    await expect(page).toHaveURL(/\/change-password$/)
    await expectNoSeriousViolations(page, testInfo, 'First-login password change')
    await choosePassword(page)
    await expect(page.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Vendors' })).toBeVisible()
    await expectNoSeriousViolations(page, testInfo, 'Home')

    const answered = moduleQueueAnswer(page)
    await page.goto(`${VENDORS.basePath}/queue`)
    await expect(moduleFrame(page).getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible()
    await answered
    await expectNoSeriousViolations(page, testInfo, 'A module page (the shell around it)')

    await page.goto('/admins')
    await expect(page.getByRole('heading', { level: 1, name: 'Admins & roles' })).toBeVisible()
    await expect(page.getByText(admin.email)).toBeVisible()
    await expectNoSeriousViolations(page, testInfo, 'Admins & roles')

    await page.getByRole('button', { name: 'Invite admin' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectNoSeriousViolations(page, testInfo, 'Invite admin dialog')
  })

  test('the 403 page a vendor reviewer gets for Admins & roles', async ({ page, request }, testInfo) => {
    const reviewer = await createAdmin(request, 'a11y-403', ['vendor_reviewer'])
    await signInFirstTime(page, reviewer)
    await page.goto('/admins')
    await expect(page.getByRole('heading', { name: 'Only super admins can manage admins' })).toBeVisible()
    await expectNoSeriousViolations(page, testInfo, '403 page')
  })
})
