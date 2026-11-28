import { expect, type Page, type Request, type Response } from '@playwright/test'
import { CHOSEN_PASSWORD, E2E, TEMPORARY_PASSWORD, VENDORS } from './env'
import type { TestAdmin } from './identity'

// The words below are the shell's own (src/copy/auth.ts, src/copy/shell.ts) and the Vendors module's
// (apps/vendor-admin/src/copy). A change to either shows up here as a failing locator.

export const SIGN_IN_HEADING = 'Sign in to Shazlo One'
export const CHANGE_PASSWORD_HEADING = 'Choose your own password'
/** Home's greeting: "Good morning, E2E" for every test admin (their display name is "E2E <label>"). */
export const HOME_HEADING = /^Good (morning|afternoon|evening), E2E$/

/** Fills the sign-in form and submits it. */
export async function submitSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

/** Fills the first-login password change and submits it. */
export async function choosePassword(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: CHANGE_PASSWORD_HEADING })).toBeVisible()
  await page.getByLabel('Temporary password', { exact: true }).fill(TEMPORARY_PASSWORD)
  await page.getByLabel('New password', { exact: true }).fill(CHOSEN_PASSWORD)
  await page.getByLabel('Confirm new password', { exact: true }).fill(CHOSEN_PASSWORD)
  await page.getByRole('button', { name: 'Save password and continue' }).click()
}

/** Signs a new admin in and has them choose their own password, which the shell makes them do first; ends on Home. */
export async function signInFirstTime(page: Page, admin: TestAdmin): Promise<void> {
  await page.goto('/sign-in')
  await submitSignIn(page, admin.email, TEMPORARY_PASSWORD)
  await expect(page).toHaveURL(/\/change-password$/)
  await choosePassword(page)
  await expect(page).toHaveURL(new RegExp(`^${E2E.shellUrl}/$`))
  await expect(page.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeVisible()
}

/** The shell's own navigation (the desktop sidebar). */
export function sidebar(page: Page) {
  return page.getByRole('navigation', { name: 'Shazlo One sections' })
}

/** The Vendors module's frame. Its title is the module's title (ModuleHost). */
export function moduleFrame(page: Page) {
  return page.frameLocator(`iframe[title="${VENDORS.title}"]`)
}

export function moduleIframe(page: Page) {
  return page.locator(`iframe[title="${VENDORS.title}"]`)
}

/** The bearer token a request carried, or null. */
export function bearerOf(request: Request): string | null {
  const header = request.headers()['authorization'] ?? ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

/**
 * Waits for the module (not the shell) to call vendor-admin-api's review queue with a token and get a
 * 200: proof that the token the shell exchanged and sent across the frame is one vendor-admin-api accepts.
 * `accept` narrows it further (a token other than the one it held before, say).
 */
export function moduleQueueAnswer(page: Page, accept: (token: string) => boolean = () => true): Promise<Response> {
  return page.waitForResponse((response) => {
    const request = response.request()
    const token = bearerOf(request)
    return (
      request.frame() !== page.mainFrame() &&
      response.url().startsWith(`${E2E.vendorAdminApiUrl}/v1/admin/queue`) &&
      response.status() === 200 &&
      token !== null &&
      accept(token)
    )
  })
}

/**
 * Opens the Vendors module's review queue from the shell's navigation and waits until the module has
 * its session and has used it: the module renders nothing that could call its API before the shell's
 * `auth` arrives (apps/vendor-admin/src/app/App.tsx, Gate).
 */
export async function openReviewQueue(page: Page): Promise<string> {
  const answered = moduleQueueAnswer(page)
  await sidebar(page).getByRole('link', { name: 'Review queue' }).click()
  await expect(page).toHaveURL(new RegExp(`${VENDORS.basePath}/queue$`))
  await expect(moduleFrame(page).getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible()
  const token = bearerOf((await answered).request())
  expect(token, 'the module called vendor-admin-api with a token').not.toBeNull()
  return token!
}

/** The real module sends a toast: the queue's CSV export (the stack is seeded with a demo vendor whose products wait for review). */
export const MODULE_TOAST = /^(Exported \d+ rows?|The export did not finish\. Try again\.)$/

export async function sendModuleToast(page: Page): Promise<void> {
  await moduleFrame(page).getByRole('button', { name: 'Export CSV' }).click()
  await expect(page.getByRole('status').filter({ hasText: MODULE_TOAST })).toBeVisible()
}

export async function signOutFromSidebar(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
}
