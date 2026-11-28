import { expect, test, type Page, type Request } from '@playwright/test'
import { E2E, VENDORS } from './support/env'
import { CONTROL_PAGE, framingPage, startEvilSite, type EvilSite } from './support/evil'
import { createAdmin } from './support/identity'
import { moduleFrame, moduleIframe, moduleQueueAnswer, openReviewQueue, SIGN_IN_HEADING, sendModuleToast, signInFirstTime } from './support/shell'

const FORGED_TOAST = 'A forged toast.'
const FORGED_TITLE = 'Forged title'

/** What a page that is neither the module nor the shell could send: a well-formed message of each kind a module sends. */
const FORGED = [
  { type: 'title', payload: { path: '/forged', title: FORGED_TITLE } },
  { type: 'toast', payload: { level: 'error', message: FORGED_TOAST } },
  { type: 'logout', payload: {} },
].map((message, index) => ({ protocol: 'shazlo-one', v: 1, id: `00000000-0000-4000-8000-00000000000${index}`, sentAt: Date.now(), ...message }))

/**
 * Watches the shell's page from now on and records whether a forged message ever had an effect: its
 * toast text anywhere in the document, its title in `document.title`, or its path in the address. The
 * shell shows one toast at a time, so checking the screen only at the end would miss a forged toast the
 * real one replaced.
 */
async function watchForForgeries(page: Page): Promise<void> {
  await page.evaluate(
    ({ toast, title }) => {
      const seen: string[] = []
      ;(window as unknown as { __forgeries: string[] }).__forgeries = seen
      const check = () => {
        if (document.body.textContent?.includes(toast)) seen.push('toast')
        if (document.title.includes(title)) seen.push('title')
        if (location.pathname.includes('forged')) seen.push('path')
      }
      new MutationObserver(check).observe(document.documentElement, { subtree: true, childList: true, characterData: true })
    },
    { toast: FORGED_TOAST, title: FORGED_TITLE },
  )
}

async function forgeriesSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __forgeries: string[] }).__forgeries)
}

/**
 * Frames `target` from an attacker's origin, next to a control frame from another attacker origin, and
 * checks that the target never rendered. The page retitles itself once both frames fired `load` (a
 * blocked frame fires it too), so the checks run after the browser decided, not before the frame
 * started. The control frame rendering proves that this browser frames another local origin here, and
 * the server answered before this is called, so a refusal is the target's own headers.
 */
async function expectFramingRefused(page: Page, target: string): Promise<void> {
  const site: EvilSite = await startEvilSite()
  try {
    site.page('/control', CONTROL_PAGE)
    site.page('/', framingPage(site, target))
    await page.goto(`${site.origin}/`)
    await expect(page).toHaveTitle('framed')
    await expect(page.frameLocator('#control').getByRole('heading', { level: 1, name: 'control frame' })).toBeVisible()
    const victim = await (await page.locator('#victim').elementHandle())?.contentFrame()
    expect(victim, 'the page has its frame').toBeTruthy()
    expect(victim!.url(), 'the frame never showed the target').not.toContain(new URL(target).host)
    // Both apps render into #root (index.html); a refused frame holds the browser's error page instead.
    expect(await victim!.locator('#root').count(), 'the target never rendered in the frame').toBe(0)
  } finally {
    await site.close()
  }
}

test.describe('security, in the browser', () => {
  test('the shell ignores messages from another origin and from a window that is not the module', async ({ page, context, request }) => {
    const admin = await createAdmin(request, 'forged', ['super_admin'])
    await signInFirstTime(page, admin)
    await openReviewQueue(page)
    const titleBefore = await page.title()

    // 1. From the shell's own window: the right shape, but the wrong origin and the wrong window.
    await watchForForgeries(page)
    await page.evaluate((messages) => messages.forEach((message) => window.postMessage(message, '*')), FORGED)
    // Messages are handled in the order they arrive. Once the module's own toast, sent after the forged
    // messages, is on screen, the forged ones have been handled too: the checks below are not made
    // before they arrived.
    await sendModuleToast(page)
    expect(await forgeriesSeen(page)).toEqual([])
    expect(await page.title()).toBe(titleBefore)
    await expect(moduleIframe(page)).toHaveCount(1)

    // 2. From a real page on another origin that opens the shell and posts to it. The refresh cookie is
    //    the context's, so the opened shell is signed in and frames the module.
    const site = await startEvilSite()
    site.page('/', '<!doctype html><title>evil</title>')
    const evil = await context.newPage()
    await evil.goto(`${site.origin}/`)
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      evil.evaluate((url) => {
        ;(window as unknown as { victim: Window | null }).victim = window.open(url)
      }, `${E2E.shellUrl}${VENDORS.basePath}/queue`),
    ])
    const popupReady = moduleQueueAnswer(popup)
    await expect(moduleFrame(popup).getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible()
    await popupReady
    const popupTitle = await popup.title()
    await watchForForgeries(popup)
    await evil.evaluate((messages) => {
      const victim = (window as unknown as { victim: Window }).victim
      messages.forEach((message) => victim.postMessage(message, '*'))
    }, FORGED)
    await sendModuleToast(popup)

    // The forged `logout` would have signed the admin out, the forged `toast` would have shown, the forged `title` would have stuck.
    expect(await forgeriesSeen(popup)).toEqual([])
    expect(await popup.title()).toBe(popupTitle)
    expect(popup.url()).not.toContain('forged')
    await expect(moduleIframe(popup)).toHaveCount(1)
    await expect(popup.getByRole('heading', { level: 1, name: SIGN_IN_HEADING })).toHaveCount(0)
    await popup.close()
    await evil.close()
    await site.close()
  })

  test('the shell refuses to be framed by any page', async ({ page, request }) => {
    // The headers the browser enforces.
    const answer = await request.get(`${E2E.shellUrl}/sign-in`)
    expect(answer.ok(), 'the shell is up').toBeTruthy()
    const policy = answer.headers()['content-security-policy'] ?? ''
    expect(policy).toContain("frame-ancestors 'none'")
    expect(answer.headers()['x-frame-options']).toBe('DENY')
    // It frames only the registered module.
    expect(policy).toContain(`frame-src ${E2E.moduleUrl}`)
    expect(policy).not.toMatch(/\*/)

    // And the browser doing it: another origin frames the shell and gets nothing.
    await expectFramingRefused(page, `${E2E.shellUrl}/sign-in`)
  })

  test('the module refuses to be framed by anything but the shell', async ({ page, request }) => {
    const answer = await request.get(`${E2E.moduleUrl}/`)
    expect(answer.ok(), 'the module server is up').toBeTruthy()
    const policy = answer.headers()['content-security-policy'] ?? ''
    expect(policy).toContain(`frame-ancestors ${E2E.shellUrl}`)
    expect(policy).not.toMatch(/\*/)
    expect(answer.headers()['referrer-policy']).toBe('no-referrer')

    await expectFramingRefused(page, `${E2E.moduleUrl}/queue`)
  })

  test('no token appears in an address, a Referer header, web storage or a readable cookie', async ({ page, request }) => {
    const admin = await createAdmin(request, 'secrets', ['super_admin'])
    const tokens = new Set<string>()
    const requests: Request[] = []
    page.on('request', (req) => requests.push(req))
    page.on('response', async (response) => {
      if (!/\/v1\/auth\/(login|refresh|token|change-password)$/.test(new URL(response.url()).pathname) || !response.ok()) return
      const body = (await response.json().catch(() => undefined)) as { access_token?: string } | undefined
      if (body?.access_token) tokens.add(body.access_token)
    })

    await signInFirstTime(page, admin)
    await openReviewQueue(page)
    expect(tokens.size, 'the test saw the tokens it is looking for (identity and module)').toBeGreaterThanOrEqual(2)

    for (const req of requests) {
      for (const token of tokens) {
        expect(req.url(), 'a request address').not.toContain(token)
        expect(req.headers()['referer'] ?? '', 'a Referer header').not.toContain(token)
      }
    }
    expect(page.url()).not.toMatch(/ey[A-Za-z0-9_-]{10,}\./)

    for (const frame of page.frames()) {
      const found = await frame.evaluate(async () => ({
        local: window.localStorage.length,
        session: window.sessionStorage.length,
        databases: 'databases' in indexedDB ? (await indexedDB.databases()).length : 0,
        cookie: document.cookie,
        href: location.href,
      }))
      expect(found.local, `localStorage of ${frame.url()}`).toBe(0)
      expect(found.session, `sessionStorage of ${frame.url()}`).toBe(0)
      expect(found.databases, `indexedDB of ${frame.url()}`).toBe(0)
      for (const token of tokens) {
        expect(found.cookie).not.toContain(token)
        expect(found.href).not.toContain(token)
      }
    }
  })
})
