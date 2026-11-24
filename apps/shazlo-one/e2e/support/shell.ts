import { expect, type Page } from '@playwright/test'
import { CHOSEN_PASSWORD, TEMPORARY_PASSWORD } from './env'
import type { TestAdmin } from './identity'

/** Fills the sign-in form and submits it. */
export async function submitSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Signs a new admin in and chooses their own password, which is what the shell makes them do first. */
export async function signInFirstTime(page: Page, admin: TestAdmin): Promise<void> {
  await page.goto('/login')
  await submitSignIn(page, admin.email, TEMPORARY_PASSWORD)
  await expect(page.getByRole('heading', { level: 1, name: 'Choose your password' })).toBeVisible()
  await page.getByLabel('Current (temporary) password', { exact: true }).fill(TEMPORARY_PASSWORD)
  await page.getByLabel('New password', { exact: true }).fill(CHOSEN_PASSWORD)
  await page.getByLabel('Repeat the new password', { exact: true }).fill(CHOSEN_PASSWORD)
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Shazlo-One' })).toBeVisible()
}

/** The frame of the module the page is showing. */
export function moduleFrame(page: Page, title = 'Reference module') {
  return page.frameLocator(`iframe[title="${title}"]`)
}

/** Opens a module from the navigation and waits until it has its session. */
export async function openReferenceModule(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Modules"]').getByRole('link', { name: 'Reference module' }).click()
  const module = moduleFrame(page)
  await expect(module.getByRole('heading', { level: 1, name: 'Reference module' })).toBeVisible()
  await expect(module.getByText(/vendor-api answered 200/)).toBeVisible()
}

export async function signOutFromMenu(page: Page, admin: TestAdmin): Promise<void> {
  await page.getByRole('button', { name: admin.name }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
}
