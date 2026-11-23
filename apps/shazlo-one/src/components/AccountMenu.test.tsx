import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { fakeChannels, makeStore, sessionBody } from '../session/testing'
import { BASE, useApiServer } from '../test/msw'
import { renderRoute } from '../test/renderRoute'

const server = useApiServer()

const profile = {
  id: 'a1',
  email: 'asha@shazlo.test',
  display_name: 'Asha Admin',
  roles: ['super_admin', 'reviewer'],
  must_change_password: false,
}

function signedInStore(overrides: Parameters<typeof makeStore>[0] = {}) {
  return makeStore({
    refresh: async () => ({ ...sessionBody(), admin: profile }),
    fetchMe: async () => profile,
    ...overrides,
  }).store
}

describe('the account menu', () => {
  it('shows the admin’s name, email and roles', async () => {
    renderRoute('/', { store: signedInStore() })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Asha Admin' }))
    const menu = screen.getByRole('menu')
    expect(menu.textContent).toContain('asha@shazlo.test')
    expect(menu.textContent).toContain('Roles: super admin, reviewer')
    expect(screen.getByRole('menuitem', { name: 'Change password' }).getAttribute('href')).toBe('/change-password')
  })

  it('signs out: calls the server, ends the session and shows the login screen', async () => {
    const logout = vi.fn()
    server.use(http.post(`${BASE}/v1/auth/logout`, () => { logout(); return new HttpResponse(null, { status: 204 }) }))
    const store = signedInStore({ logout: async () => { logout() } })
    const router = renderRoute('/', { store })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Asha Admin' }))
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
    expect(logout).toHaveBeenCalledOnce()
    expect(store.getAccessToken()).toBeNull()
    expect(router.state.location.pathname).toBe('/login')
    // A deliberate sign-out starts the next sign-in fresh: no return-to, no "session ended" notice.
    expect(router.state.location.search).toBe('')
    expect(screen.queryByText(/Your session ended/)).toBeNull()
  })

  it('signs out even when the server cannot be told', async () => {
    const store = signedInStore({ logout: async () => { throw new Error('offline') } })
    renderRoute('/', { store })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Asha Admin' }))
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
  })

  it('signing out in one tab shows the login screen in every other tab', async () => {
    const channels = fakeChannels()
    const first = signedInStore({ channel: channels() })
    const second = signedInStore({ channel: channels() })
    renderRoute('/', { store: second })
    await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })
    await first.start()
    await first.logout()
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
    await waitFor(() => expect(second.getSnapshot().status).toBe('signedOut'))
    first.close()
  })
})
