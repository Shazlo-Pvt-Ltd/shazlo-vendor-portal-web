import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { clearSensitiveState } from '../security/sensitiveState'
import { apiError, makeStore, sessionBody } from '../session/testing'
import { countdownClock } from '../test/countdown'
import { BASE, apiErrorResponse, useApiServer } from '../test/msw'
import { renderRoute } from '../test/renderRoute'
import { typeFast } from '../test/typeFast'

const server = useApiServer()

const OLD = 'temporary-password-1'
const NEW = 'a brand new passphrase'

function storeFor(options: { mustChange: boolean }) {
  return makeStore({
    refresh: async () => sessionBody({ must_change_password: options.mustChange }),
    fetchMe: async () => sessionBody().admin,
  }).store
}

async function open(path: string, mustChange: boolean, name: string) {
  const store = storeFor({ mustChange })
  const router = renderRoute(path, { store })
  await screen.findByRole('heading', { level: 1, name })
  return { user: userEvent.setup(), router, store }
}

async function fill(user: ReturnType<typeof userEvent.setup>, current = OLD, next = NEW, confirm = NEW) {
  await typeFast(user, screen.getByLabelText(/^Current/), current)
  await typeFast(user, screen.getByLabelText(/^New password/), next)
  await typeFast(user, screen.getByLabelText(/^Repeat/), confirm)
}

const save = (name: string | RegExp) => screen.getByRole('button', { name })

describe('the forced change ("Choose your password")', () => {
  it('holds the admin at the step from any address and explains why', async () => {
    const { router } = await open('/', true, 'Choose your password')
    expect(router.state.location.pathname).toBe('/change-password')
    await act(async () => {
      await router.navigate('/login')
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/change-password'))
    expect(screen.getByText(/signed in with a password someone else set/)).toBeTruthy()
  })

  it('offers only sign out in the account menu: no change-password link, no roles', async () => {
    const { user } = await open('/change-password', true, 'Choose your password')
    await user.click(screen.getByRole('button', { name: 'Asha Admin' }))
    expect(screen.queryByRole('menuitem', { name: 'Change password' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy()
    expect(screen.queryByText(/Roles:/)).toBeNull()
  })

  it('sends the passwords, adopts the new session and continues where the admin was going', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE}/v1/auth/change-password`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(sessionBody({ token: 'normal-token' }))
      }),
    )
    const { user, router, store } = await open('/?tab=3', true, 'Choose your password')
    expect(new URLSearchParams(router.state.location.search).get('return-to')).toBe('/?tab=3')
    await fill(user)
    await user.click(save('Save and continue'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })).toBeTruthy()
    expect(body).toEqual({ current_password: OLD, new_password: NEW })
    expect(router.state.location.pathname + router.state.location.search).toBe('/?tab=3')
    expect(store.getSnapshot()).toMatchObject({ status: 'signedIn', roles: ['super_admin'] })
    expect(store.getAccessToken()).toBe('normal-token')
  })

  it('never continues to a return-to that is not a shell path', async () => {
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => HttpResponse.json(sessionBody())))
    const { user, router } = await open('/change-password?return-to=https%3A%2F%2Fevil.example', true, 'Choose your password')
    await fill(user)
    await user.click(save('Save and continue'))
    await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toBe('')
  })

  it('shows 422 weak_password next to the new-password field and focuses it', async () => {
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => apiErrorResponse(422, 'weak_password', 'That password is too common.')))
    const { user } = await open('/change-password', true, 'Choose your password')
    await fill(user)
    await user.click(save('Save and continue'))
    expect(await screen.findByText('That password is too common.')).toBeTruthy()
    const field = screen.getByLabelText(/^New password/)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field)
  })

  it('shows invalid_current_password next to the current-password field', async () => {
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => apiErrorResponse(400, 'invalid_current_password')))
    const { user } = await open('/change-password', true, 'Choose your password')
    await fill(user)
    await user.click(save('Save and continue'))
    expect(await screen.findByText('This is not your current password.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Current/))
  })

  it('stays on the step after any failure, with every password field emptied', async () => {
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => apiErrorResponse(400, 'invalid_current_password')))
    const { user, router } = await open('/change-password', true, 'Choose your password')
    await fill(user)
    await user.click(save('Save and continue'))
    await screen.findByText('This is not your current password.')
    for (const label of [/^Current/, /^New password/, /^Repeat/]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('')
    }
    expect(router.state.location.pathname).toBe('/change-password')
  })

  it('counts down on a 429 and blocks another try until it ends', async () => {
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => apiErrorResponse(429, 'rate_limited', 'slow', { 'Retry-After': '30' })))
    const { user } = await open('/change-password', true, 'Choose your password')
    const countdown = countdownClock(30)
    await fill(user)
    await user.click(save('Save and continue'))
    countdown((await screen.findByText(/Try again in \d+ s\./)).textContent, /Try again in (\d+) s\./)
    expect((save('Save and continue') as HTMLButtonElement).disabled).toBe(true)
  })

  it('says plainly when the server cannot be reached', async () => {
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => HttpResponse.error()))
    const { user } = await open('/change-password', true, 'Choose your password')
    await fill(user)
    await user.click(save('Save and continue'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reach the server/)
  })

  it('checks before sending: empty, too short, same as current, and mismatched', async () => {
    const sent = vi.fn()
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => { sent(); return HttpResponse.json(sessionBody()) }))
    const { user } = await open('/change-password', true, 'Choose your password')
    await user.click(save('Save and continue'))
    expect(await screen.findByText('Enter your current password.')).toBeTruthy()
    expect(screen.getByText('Choose a new password.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Current/))

    await fill(user, OLD, 'short', 'short')
    await user.click(save('Save and continue'))
    expect(await screen.findByText(/Use at least 12 characters/, { selector: 'p.Mui-error' })).toBeTruthy()

    await user.clear(screen.getByLabelText(/^New password/))
    await user.clear(screen.getByLabelText(/^Repeat/))
    await typeFast(user, screen.getByLabelText(/^New password/), OLD)
    await typeFast(user, screen.getByLabelText(/^Repeat/), OLD)
    await user.click(save('Save and continue'))
    expect(await screen.findByText('Choose a password different from the current one.')).toBeTruthy()

    await user.clear(screen.getByLabelText(/^New password/))
    await typeFast(user, screen.getByLabelText(/^New password/), NEW)
    await user.click(save('Save and continue'))
    expect(await screen.findByText('The two new passwords do not match.')).toBeTruthy()
    expect(sent).not.toHaveBeenCalled()
  })

  it('does not trust an answer that is not a session', async () => {
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => HttpResponse.json({ access_token: 'x' })))
    const { user, store } = await open('/change-password', true, 'Choose your password')
    await fill(user)
    await user.click(save('Save and continue'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Something went wrong/)
    expect(store.getSnapshot().status).toBe('passwordChangeRequired')
  })

  it.each([
    ['accepted', () => HttpResponse.json(sessionBody())],
    ['weak', () => apiErrorResponse(422, 'weak_password', 'weak')],
    ['wrong current', () => apiErrorResponse(400, 'invalid_current_password')],
  ])('keeps no copy of the passwords in the query cache once the call has ended (%s)', async (_name, answer) => {
    let sent = false
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => { sent = true; return answer() }))
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const store = storeFor({ mustChange: true })
    renderRoute('/change-password', { store, queryClient })
    await screen.findByRole('heading', { level: 1, name: 'Choose your password' })
    await fill(userEvent.setup())
    await userEvent.setup().click(save('Save and continue'))
    await waitFor(() => expect(sent).toBe(true))
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
  })

  it('clears typed passwords when the session ends', async () => {
    const { user } = await open('/change-password', true, 'Choose your password')
    await typeFast(user, screen.getByLabelText(/^Current/), 'half typed')
    clearSensitiveState()
    await waitFor(() => expect((screen.getByLabelText(/^Current/) as HTMLInputElement).value).toBe(''))
  })

  it('has show/hide toggles, new-password autocomplete on the new fields, and allows paste', async () => {
    const { user } = await open('/change-password', true, 'Choose your password')
    expect(screen.getByLabelText(/^Current/).getAttribute('autocomplete')).toBe('current-password')
    expect(screen.getByLabelText(/^New password/).getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getByLabelText(/^Repeat/).getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getAllByRole('button', { name: 'Show password' })).toHaveLength(3)
    await user.click(screen.getByLabelText(/^New password/))
    await user.paste('pasted-from-a-manager')
    expect((screen.getByLabelText(/^New password/) as HTMLInputElement).value).toBe('pasted-from-a-manager')
  })
})

describe('changing the password later, from the account menu', () => {
  it('is reached from the menu, titled "Change your password", and keeps the admin where they are', async () => {
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => HttpResponse.json(sessionBody({ token: 'after-change' }))))
    const { user, router, store } = await open('/', false, 'Shazlo-One')
    await user.click(screen.getByRole('button', { name: 'Asha Admin' }))
    await user.click(screen.getByRole('menuitem', { name: 'Change password' }))
    await screen.findByRole('heading', { level: 1, name: 'Change your password' })
    expect(router.state.location.pathname).toBe('/change-password')
    await fill(user)
    await user.click(save('Change password'))
    expect(await screen.findByText(/You have been signed out everywhere else/)).toBeTruthy()
    expect(router.state.location.pathname).toBe('/change-password')
    expect(store.getAccessToken()).toBe('after-change')
    expect(store.getSnapshot().status).toBe('signedIn')
    for (const label of [/^Current/, /^New password/, /^Repeat/]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('')
    }
  })

  it('tells the other tabs, so they pick up the new session', async () => {
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => HttpResponse.json(sessionBody())))
    const post = vi.fn()
    const channel = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: post, close: () => {} }
    const store = makeStore({ channel, fetchMe: async () => sessionBody().admin }).store
    renderRoute('/change-password', { store })
    await screen.findByRole('heading', { level: 1, name: 'Change your password' })
    const user = userEvent.setup()
    await fill(user)
    await user.click(save('Change password'))
    await screen.findByText(/signed out everywhere else/)
    expect(post).toHaveBeenCalledWith({ type: 'login' })
  })
})

describe('changing the password, under pressure', () => {
  it('sends one request when the form is submitted twice before the first answer', async () => {
    let calls = 0
    server.use(http.post(`${BASE}/v1/auth/change-password`, async () => { calls += 1; await new Promise((r) => setTimeout(r, 50)); return apiErrorResponse(400, 'invalid_current_password') }))
    const { user } = await open('/change-password', true, 'Choose your password')
    await fill(user)
    const form = screen.getByRole('form', { name: 'Choose your password' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    await screen.findByText('This is not your current password.')
    expect(calls).toBe(1)
    expect(screen.queryByText('Choose a new password.')).toBeNull()
  })

  it('says "our side" for a server error, without its details', async () => {
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => apiErrorResponse(500, 'internal_error', 'stack at db.py:12')))
    const { user } = await open('/change-password', true, 'Choose your password')
    await fill(user)
    await user.click(save('Save and continue'))
    const text = (await screen.findByRole('alert')).textContent
    expect(text).toMatch(/Something went wrong on our side/)
    expect(text).not.toMatch(/db\.py/)
  })

  it.each(['invalid_credentials', 'unauthorized'])(
    'on a 401 (%s) checks the session again and, when it is gone, ends it instead of blaming the email',
    async (code) => {
      let revoked = false
      const store = makeStore({
        refresh: async () => {
          if (revoked) throw apiError(401, 'invalid_refresh_token')
          return sessionBody({ must_change_password: true })
        },
      }).store
      server.use(http.post(`${BASE}/v1/auth/change-password`, () => { revoked = true; return apiErrorResponse(401, code, 'Invalid email or password') }))
      const router = renderRoute('/change-password', { store })
      await screen.findByRole('heading', { level: 1, name: 'Choose your password' })
      await fill(userEvent.setup())
      await userEvent.setup().click(save('Save and continue'))
      await screen.findByRole('heading', { level: 1, name: 'Sign in' })
      expect(router.state.location.pathname).toBe('/login')
      expect(store.getSnapshot().status).toBe('signedOut')
      expect(document.body.textContent).not.toMatch(/Invalid email or password/)
    },
  )

  it('on a 401 for a token that merely expired, renews it and stays on the step', async () => {
    server.use(http.post(`${BASE}/v1/auth/change-password`, () => apiErrorResponse(401, 'unauthorized', 'Missing or invalid access token')))
    let refreshes = 0
    const store = makeStore({ refresh: async () => { refreshes += 1; return sessionBody({ must_change_password: true, token: `t${refreshes}` }) } }).store
    renderRoute('/change-password', { store })
    await screen.findByRole('heading', { level: 1, name: 'Choose your password' })
    const user = userEvent.setup()
    await fill(user)
    await user.click(save('Save and continue'))
    await waitFor(() => expect(store.getAccessToken()).toBe('t2'))
    await screen.findByRole('heading', { level: 1, name: 'Choose your password' })
    expect(store.getSnapshot().status).toBe('passwordChangeRequired')
    expect(document.body.textContent).not.toMatch(/access token/)
  })
})
