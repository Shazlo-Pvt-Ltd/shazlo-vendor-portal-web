import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { makeStore, sessionBody } from '../session/testing'
import { BASE, useApiServer } from '../test/msw'
import { renderRoute } from '../test/renderRoute'

const server = useApiServer()

async function openSignedIn(path = '/products') {
  const store = makeStore({
    refresh: async () => sessionBody(),
    logout: async () => { await fetch(`${BASE}/v1/auth/logout`, { method: 'POST' }) },
  }).store
  server.use(http.post(`${BASE}/v1/auth/logout`, () => new HttpResponse(null, { status: 204 })))
  const router = renderRoute(path, { store })
  await screen.findByRole('heading', { level: 1, name: 'Products' })
  return { router, store, user: userEvent.setup() }
}

describe('signing out', () => {
  it('shows who is signed in in the account menu', async () => {
    const { user } = await openSignedIn()
    await user.click(screen.getByRole('button', { name: 'Account' }))
    expect(await screen.findByText('owner@brand.test')).toBeTruthy()
    expect(screen.getByText(/Brand · Owner/)).toBeTruthy()
  })

  it('signs out from the app bar, ends the session and goes to a plain login', async () => {
    const { router, store, user } = await openSignedIn()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(store.getSnapshot().status).toBe('signedOut')
    expect(store.getAccessToken()).toBeNull()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('')
  })

  it('signs out from the account menu too', async () => {
    const { router, user } = await openSignedIn()
    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(router.state.location.search).toBe('')
  })

  it('does not send the next login "back" to the page the user signed out from', async () => {
    const { router, user } = await openSignedIn('/products')
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(new URLSearchParams(router.state.location.search).get('return-to')).toBeNull()
  })
})
