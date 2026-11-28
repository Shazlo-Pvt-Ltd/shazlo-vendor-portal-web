import { expect, test } from '@playwright/test'
import { E2E, VENDORS } from './support/env'
import { createAdmin } from './support/identity'
import { moduleFrame, moduleQueueAnswer, openReviewQueue, SIGN_IN_HEADING, sidebar, signInFirstTime, signOutFromSidebar } from './support/shell'

test.describe('the session and module tokens', () => {
  test('with the clock moved forward, the shell exchanges a fresh token and the module keeps working with it', async ({ page, request }) => {
    const admin = await createAdmin(request, 'clock', ['super_admin'])
    // Fake timers from the start, so the shell's refresh timer is one the test can move.
    await page.clock.install({ time: new Date() })
    let exchanges = 0
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url() === `${E2E.shellUrl}/v1/auth/token`) exchanges += 1
    })

    await signInFirstTime(page, admin)
    const first = await openReviewQueue(page)
    expect(exchanges, 'the shell exchanged a module token').toBeGreaterThanOrEqual(1)
    const exchangesBefore = exchanges

    // A module token lasts 5 minutes; the shell replaces it at 80% of its life (src/shell/refreshSchedule.ts).
    await page.clock.fastForward('04:30')
    await expect.poll(() => exchanges, { message: 'the shell exchanged a new module token' }).toBeGreaterThan(exchangesBefore)

    // The module's next call carries the new token, and vendor-admin-api accepts it. The module's home
    // page (the sidebar's Vendors row) reads the queue too.
    const fresh = moduleQueueAnswer(page, (token) => token !== first)
    await sidebar(page).getByRole('link', { name: /^Vendors/ }).click()
    await expect(page).toHaveURL(new RegExp(`${VENDORS.basePath}/dashboard$`))
    await expect(moduleFrame(page).getByRole('heading', { level: 1, name: 'Vendor dashboard' })).toBeVisible()
    await fresh
  })

  test('signing out in one tab ends the session in the other, and its module frame goes with it', async ({ context, page, request }) => {
    const admin = await createAdmin(request, 'tabs', ['super_admin'])
    await signInFirstTime(page, admin)

    // A second tab of the same browser restores the session from the refresh cookie and opens the module.
    const other = await context.newPage()
    const answered = moduleQueueAnswer(other)
    await other.goto(`${VENDORS.basePath}/queue`)
    await expect(moduleFrame(other).getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible()
    await answered

    await signOutFromSidebar(page)
    await expect(page.getByRole('heading', { level: 1, name: SIGN_IN_HEADING })).toBeVisible()

    // The other tab heard it (BroadcastChannel): signed out, the frame and its token gone, without a reload.
    await expect(other.getByRole('heading', { level: 1, name: SIGN_IN_HEADING })).toBeVisible()
    await expect(other.locator('iframe')).toHaveCount(0)
    // And a reload there does not bring the session back: the refresh cookie was revoked.
    await other.reload()
    await expect(other.getByRole('heading', { level: 1, name: SIGN_IN_HEADING })).toBeVisible()
    await expect(other.locator('iframe')).toHaveCount(0)
  })

  test('after sign-out, going back does not bring the module or its session back', async ({ page, request }) => {
    const admin = await createAdmin(request, 'back', ['super_admin'])
    await signInFirstTime(page, admin)
    await openReviewQueue(page)

    await signOutFromSidebar(page)
    await expect(page.getByRole('heading', { level: 1, name: SIGN_IN_HEADING })).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)

    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: SIGN_IN_HEADING })).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
  })
})
