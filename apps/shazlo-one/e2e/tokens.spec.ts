import { expect, test } from '@playwright/test'
import { E2E } from './support/env'
import { createAdmin } from './support/identity'
import { moduleFrame, openReferenceModule, signInFirstTime, signOutFromMenu } from './support/shell'

test.describe('tokens across the frame', () => {
  test('with the clock moved forward, the module is given a fresh token and keeps working', async ({ page, request }) => {
    const admin = await createAdmin(request, 'clock', ['super_admin'])
    // Fake timers from the start, so the shell's refresh timer is one the test can move.
    await page.clock.install({ time: new Date() })
    const exchanges: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url() === `${E2E.identityUrl}/v1/auth/token`) exchanges.push(req.url())
    })

    await signInFirstTime(page, admin)
    await openReferenceModule(page)
    const module = moduleFrame(page)
    const before = await module.locator('dd').nth(2).textContent()
    expect(exchanges.length).toBeGreaterThanOrEqual(1)
    const exchangesBefore = exchanges.length

    // A module token lasts 5 minutes and the shell replaces it at 80% of its life.
    await page.clock.fastForward('04:30')
    await expect.poll(() => exchanges.length, { message: 'the shell exchanged a new token' }).toBeGreaterThan(exchangesBefore)
    await expect.poll(async () => module.locator('dd').nth(2).textContent(), { message: 'the module was sent a later expiry' }).not.toBe(before)

    // The fresh token works against vendor-api.
    await module.getByRole('button', { name: 'Call GET /v1/admin/me' }).click()
    await expect(module.getByText(/vendor-api answered 200/)).toBeVisible()
  })

  test('when the session ends, the module is removed and loses its token', async ({ page, request }) => {
    const admin = await createAdmin(request, 'signout', ['super_admin'])
    await signInFirstTime(page, admin)
    await openReferenceModule(page)

    await signOutFromMenu(page, admin)
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)

    // Going back does not bring the module, or its session, back.
    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
  })

  test('the module can end the session itself', async ({ page, request }) => {
    const admin = await createAdmin(request, 'modlogout', ['super_admin'])
    await signInFirstTime(page, admin)
    await openReferenceModule(page)

    await moduleFrame(page).getByRole('button', { name: 'Sign out of Shazlo-One' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
  })
})
