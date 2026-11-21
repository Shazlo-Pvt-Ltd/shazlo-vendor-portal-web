import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAppContext } from '../api/context'
import { App } from '../app/App'
import { routes } from '../app/routes'
import { renderApp, setViewport } from '../test/render'
import { mockDb, resetMockDb, server } from '../test/server'

// A page load: a fresh context (nothing in memory) and a fresh router, with the mock's cookie as it was.
function reload(route: string) {
  const context = createAppContext({ baseUrl: 'http://localhost' })
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  render(<App context={context} router={router} />)
  return { context, router }
}

const storedValues = () =>
  [localStorage, sessionStorage].flatMap((storage) => Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i)!) ?? ''))

// The screens are lazy-loaded; transform them once before the first test, which a slow machine can time out.
beforeAll(async () => {
  await Promise.all([import('../screens/overview/Overview'), import('../screens/review/ReviewStatus'), import('../screens/auth/SignIn')])
}, 60_000)

describe('the seller session', () => {
  it('survives a reload through the refresh cookie, with no token in web storage', async () => {
    const first = await renderApp({ route: '/' })
    const signedInAs = first.context.session.get()
    expect(signedInAs).not.toBeNull()
    expect(first.db.sessions.cookie).not.toBeNull()
    expect(storedValues().some((v) => v.includes(signedInAs!) || v.includes(first.db.sessions.cookie!))).toBe(false)
    first.unmount()

    const cookieBefore = mockDb.sessions.cookie
    const { context, router } = reload('/review')
    expect(await screen.findByRole('heading', { level: 1, name: 'Review status' }, { timeout: 8000 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/review')
    expect(context.session.status()).toBe('signedIn')
    expect(context.session.get()).not.toBe(signedInAs)
    // The refresh rotated the cookie; the old one no longer works.
    expect(mockDb.sessions.cookie).not.toBe(cookieBefore)
    expect(mockDb.sessions.refresh.has(cookieBefore!)).toBe(false)
  })

  it('waits for the cookie check instead of sending the seller to sign in', async () => {
    let answer: (() => void) | undefined
    resetMockDb()
    setViewport('desktop')
    server.use(
      http.post('*/api/v1/vendor/auth/refresh', async () => {
        await new Promise<void>((resolve) => (answer = resolve))
        return HttpResponse.json({ message: 'Your session has ended. Sign in again.', extra: { code: 'unauthenticated' } }, { status: 401 })
      }),
    )
    const { router } = reload('/review')
    expect(await screen.findByRole('status', { name: 'Checking your session…' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/review')
    await waitFor(() => expect(answer).toBeTypeOf('function'))
    answer!()
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(router.state.location.search).toBe('?next=%2Freview')
  })

  it('shows sign in after a reload once the cookie is gone', async () => {
    const { router } = await renderApp({ route: '/products', signedIn: false })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to your seller account' }, { timeout: 8000 })).toBeInTheDocument()
  })

  it('signing out revokes the cookie, so a reload does not sign back in', async () => {
    const { user, router, db, unmount } = await renderApp({ route: '/' })
    await screen.findByRole('heading', { level: 1, name: 'Overview' }, { timeout: 8000 })
    const cookie = db.sessions.cookie!
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    await waitFor(() => expect(db.sessions.cookie).toBeNull())
    expect(db.sessions.refresh.has(cookie)).toBe(false)
    unmount()

    const again = reload('/')
    await waitFor(() => expect(again.router.state.location.pathname).toBe('/sign-in'))
    expect(again.context.session.status()).toBe('signedOut')
  })
})
