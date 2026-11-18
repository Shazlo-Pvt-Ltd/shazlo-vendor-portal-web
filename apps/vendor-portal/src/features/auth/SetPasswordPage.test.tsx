import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { typeFast } from '../../test/typeFast'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { makeStore, sessionBody } from '../../session/testing'
import { BASE, apiErrorResponse, useApiServer } from '../../test/msw'
import { renderRoute } from '../../test/renderRoute'

const server = useApiServer()

async function open(path = '/set-password#token=tok-123', options: { strict?: boolean } = {}) {
  const router = renderRoute(path, options)
  const user = userEvent.setup()
  return { router, user }
}

async function fill(user: ReturnType<typeof userEvent.setup>, password = 'a-long-enough-password', confirm = password) {
  await typeFast(user, await screen.findByLabelText(/^New password/), password)
  await typeFast(user, screen.getByLabelText(/^Confirm new password/), confirm)
  await user.click(screen.getByRole('button', { name: 'Save password' }))
}

describe('set password', () => {
  it('takes the token out of the address bar and the history straight away', async () => {
    const { router } = await open()
    await screen.findByRole('heading', { level: 1, name: 'Set your password' })
    expect(router.state.location.search).toBe('')
    expect(router.state.location.hash).toBe('')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('also accepts the token as a ?token= query', async () => {
    const bodies: unknown[] = []
    server.use(http.post(`${BASE}/v1/auth/set-password`, async ({ request }) => { bodies.push(await request.json()); return new HttpResponse(null, { status: 204 }) }))
    const { router, user } = await open('/set-password?token=from-query')
    await fill(user)
    await screen.findByRole('heading', { level: 1, name: 'Your password is saved' })
    expect(bodies).toEqual([{ token: 'from-query', password: 'a-long-enough-password' }])
    expect(router.state.location.search).toBe('')
  })

  // The links vendor-api emails: /reset-password#token=… for a reset, /accept-invite#token=… for a staff invite.
  it.each(['/reset-password', '/accept-invite'])('works at %s, the address in the email, and stays on that address', async (path) => {
    const bodies: unknown[] = []
    server.use(http.post(`${BASE}/v1/auth/set-password`, async ({ request }) => { bodies.push(await request.json()); return new HttpResponse(null, { status: 204 }) }))
    const { router, user } = await open(`${path}#token=emailed-token`)
    await fill(user) // the form is still there: removing the token did not remount the page into 'expired'
    await screen.findByRole('heading', { level: 1, name: 'Your password is saved' })
    expect(bodies).toEqual([{ token: 'emailed-token', password: 'a-long-enough-password' }])
    expect(router.state.location.pathname).toBe(path)
    expect(router.state.location.hash).toBe('')
  })

  it.each([
    ['accepted', () => new HttpResponse(null, { status: 204 })],
    ['refused', () => apiErrorResponse(422, 'weak_password', 'Password is too common')],
  ])('keeps no copy of the token and password in the query cache once the call has ended (%s)', async (_name, answer) => {
    let sent = false
    server.use(http.post(`${BASE}/v1/auth/set-password`, () => { sent = true; return answer() }))
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    renderRoute('/set-password#token=tok-123', { queryClient })
    await screen.findByRole('heading', { level: 1, name: 'Set your password' })
    await fill(userEvent.setup())
    await waitFor(() => expect(sent).toBe(true))
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
  })

  it('still has the token after it left the address bar, and sends it once with the password', async () => {
    const bodies: unknown[] = []
    server.use(http.post(`${BASE}/v1/auth/set-password`, async ({ request }) => { bodies.push(await request.json()); return new HttpResponse(null, { status: 204 }) }))
    const { user } = await open()
    await fill(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Your password is saved' })).toBeTruthy()
    expect(bodies).toEqual([{ token: 'tok-123', password: 'a-long-enough-password' }])
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
  })

  it('works in StrictMode, where effects run twice', async () => {
    server.use(http.post(`${BASE}/v1/auth/set-password`, () => new HttpResponse(null, { status: 204 })))
    const { router, user } = await open('/set-password#token=tok-123', { strict: true })
    await fill(user)
    await screen.findByRole('heading', { level: 1, name: 'Your password is saved' })
    expect(router.state.location.search).toBe('')
  })

  it('works for a signed-in user too, as an invite or reset link must', async () => {
    const store = makeStore({ refresh: async () => sessionBody() }).store
    const router = renderRoute('/set-password#token=tok-123', { store })
    await screen.findByRole('heading', { level: 1, name: 'Set your password' })
    expect(router.state.location.pathname).toBe('/set-password')
  })

  it('shows the expired-or-used state on a 400, with a way to get a new link', async () => {
    server.use(http.post(`${BASE}/v1/auth/set-password`, () => apiErrorResponse(400, 'invalid_token', 'Invalid or expired token')))
    const { user } = await open()
    await fill(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'This link has expired or was already used' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Send a new link' }).getAttribute('href')).toBe('/forgot-password')
    expect(screen.queryByLabelText(/^New password/)).toBeNull()
  })

  it('shows the same state, without calling the API, when there is no token', async () => {
    const called = vi.fn()
    server.use(http.post(`${BASE}/v1/auth/set-password`, () => { called(); return new HttpResponse(null, { status: 204 }) }))
    await open('/set-password')
    expect(await screen.findByRole('heading', { level: 1, name: 'This link has expired or was already used' })).toBeTruthy()
    expect(called).not.toHaveBeenCalled()
  })

  it('checks length and confirmation before sending, and focuses the first problem', async () => {
    const sent = vi.fn()
    server.use(http.post(`${BASE}/v1/auth/set-password`, () => { sent(); return new HttpResponse(null, { status: 204 }) }))
    const { user } = await open()
    await fill(user, 'short', 'short')
    expect(await screen.findByText('Use at least 12 characters.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^New password/))
    await user.clear(screen.getByLabelText(/^New password/))
    await user.clear(screen.getByLabelText(/^Confirm new password/))
    await fill(user, 'a-long-enough-password', 'a-different-password!')
    expect(await screen.findByText('The two passwords do not match.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Confirm new password/))
    expect(sent).not.toHaveBeenCalled()
  })

  it("shows the server's weak_password answer on the password field", async () => {
    server.use(http.post(`${BASE}/v1/auth/set-password`, () => apiErrorResponse(422, 'weak_password', 'Password is too common')))
    const { user } = await open()
    await fill(user)
    expect(await screen.findByText('Password is too common')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^New password/))
  })

  it('counts down on a 429 and keeps the form', async () => {
    server.use(http.post(`${BASE}/v1/auth/set-password`, () => apiErrorResponse(429, 'rate_limited', 'x', { 'Retry-After': '30' })))
    const { user } = await open()
    await fill(user)
    expect(await screen.findByText(/Try again in (30|29) s\./)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save password' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the token and the form through a network failure so the user can retry', async () => {
    let attempt = 0
    server.use(http.post(`${BASE}/v1/auth/set-password`, () => { attempt += 1; return attempt === 1 ? HttpResponse.error() : new HttpResponse(null, { status: 204 }) }))
    const { user } = await open()
    await fill(user)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reach the server/)
    await user.click(screen.getByRole('button', { name: 'Save password' }))
    await screen.findByRole('heading', { level: 1, name: 'Your password is saved' })
    expect(attempt).toBe(2)
  })

  it('uses new-password autocomplete on both fields', async () => {
    await open()
    expect((await screen.findByLabelText(/^New password/)).getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getByLabelText(/^Confirm new password/).getAttribute('autocomplete')).toBe('new-password')
  })
})
