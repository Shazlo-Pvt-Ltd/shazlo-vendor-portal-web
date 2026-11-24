import { expect, test, type Request } from '@playwright/test'
import { E2E } from './support/env'
import { createAdmin } from './support/identity'
import { openReferenceModule, signInFirstTime } from './support/shell'

/** What a page that is not the module (and not the shell) could send: a well-formed message of every kind a module sends. */
const FORGED = [
  { type: 'title', payload: { path: '/forged', title: 'Forged title' } },
  { type: 'toast', payload: { level: 'error', message: 'A forged toast.' } },
  { type: 'logout', payload: {} },
].map((message, index) => ({
  protocol: 'shazlo-one',
  v: 1,
  id: `00000000-0000-4000-8000-00000000000${index}`,
  sentAt: Date.now(),
  ...message,
}))

const EVIL = 'http://evil.e2e.test'

test.describe('security, in the browser', () => {
  test('the shell ignores messages from another origin and from a window that is not the module', async ({ page, context, request }) => {
    const admin = await createAdmin(request, 'forged', ['super_admin'])
    await signInFirstTime(page, admin)
    await openReferenceModule(page)
    const titleBefore = await page.title()

    // 1. From the shell's own window: the right shape, but the wrong origin and the wrong window.
    await page.evaluate((messages) => messages.forEach((message) => window.postMessage(message, '*')), FORGED)
    await expect(page.getByText('A forged toast.')).toHaveCount(0)
    expect(await page.title()).toBe(titleBefore)
    await expect(page.locator('iframe[title="Reference module"]')).toHaveCount(1)

    // 2. From a real page on another origin that opens the shell and posts to it. The cookie is shared by
    //    the context, so the opened shell is signed in and has the module framed.
    await context.route(`${EVIL}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>evil</title>' }))
    const evil = await context.newPage()
    await evil.goto(`${EVIL}/`)
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      evil.evaluate((url) => {
        ;(window as unknown as { victim: Window | null }).victim = window.open(url)
      }, `${E2E.shellUrl}/m/reference`),
    ])
    await expect(popup.frameLocator('iframe[title="Reference module"]').getByRole('heading', { level: 1, name: 'Reference module' })).toBeVisible()
    const popupTitle = await popup.title()
    await evil.evaluate((messages) => {
      const victim = (window as unknown as { victim: Window }).victim
      messages.forEach((message) => victim.postMessage(message, '*'))
    }, FORGED)

    // The forged `logout` would have signed the admin out, the forged `toast` would show, the forged `title` would stick.
    await expect(popup.getByText('A forged toast.')).toHaveCount(0)
    expect(await popup.title()).toBe(popupTitle)
    expect(popup.url()).not.toContain('forged')
    await expect(popup.locator('iframe[title="Reference module"]')).toHaveCount(1)
    await expect(popup.getByRole('heading', { level: 1, name: 'Sign in' })).toHaveCount(0)
    await popup.close()
  })

  test('the module refuses to be framed by another origin', async ({ page, context, request }) => {
    // The header the browser enforces.
    const answer = await request.get(E2E.moduleUrl)
    const policy = answer.headers()['content-security-policy'] ?? ''
    expect(policy).toContain('frame-ancestors')
    expect(policy).toContain(E2E.shellUrl)
    expect(policy).not.toMatch(/\*/)
    expect(answer.headers()['referrer-policy']).toBe('no-referrer')

    // And the browser doing it: another origin frames the module and gets nothing.
    await context.route(`${EVIL}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>evil</title><iframe id="victim" src="${E2E.moduleUrl}/"></iframe>` }),
    )
    await page.goto(`${EVIL}/`)
    await expect
      .poll(() => page.frames().find((frame) => frame !== page.mainFrame())?.url() ?? '', { message: 'the framed page was blocked' })
      .toMatch(/^chrome-error:|^about:blank$/)
    expect(await page.frames().find((frame) => frame !== page.mainFrame())?.locator('h1').count()).toBe(0)
  })

  test('the shell is never framed and frames only the registered module', async ({ page, request }) => {
    const answer = await request.get(E2E.shellUrl)
    const policy = answer.headers()['content-security-policy'] ?? ''
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain(`frame-src ${E2E.moduleUrl}`)
    expect(policy).toContain(`connect-src ${E2E.identityUrl}`)
    await page.goto('/login')
  })

  test('no token appears in a URL, a request header that names a page, web storage or a readable cookie', async ({ page, request }) => {
    const admin = await createAdmin(request, 'secrets', ['super_admin'])
    const tokens = new Set<string>()
    const requests: Request[] = []
    page.on('request', (req) => requests.push(req))
    page.on('response', async (response) => {
      if (/\/v1\/auth\/(login|refresh|token|change-password)$/.test(new URL(response.url()).pathname) && response.ok()) {
        const body = (await response.json().catch(() => undefined)) as { access_token?: string } | undefined
        if (body?.access_token) tokens.add(body.access_token)
      }
    })

    await signInFirstTime(page, admin)
    await openReferenceModule(page)
    await page.goto(`${E2E.shellUrl}/m/reference/pages/reports`)
    await expect(page.frameLocator('iframe[title="Reference module"]').getByRole('heading', { level: 1 })).toBeVisible()
    expect(tokens.size, 'the test saw the tokens it is looking for').toBeGreaterThanOrEqual(2)

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
