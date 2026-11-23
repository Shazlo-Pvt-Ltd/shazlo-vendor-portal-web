import { QueryClient } from '@tanstack/react-query'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { clearSensitiveState } from '../security/sensitiveState'
import { apiError, makeStore, sessionBody } from '../session/testing'
import { countdownClock } from '../test/countdown'
import { BASE, apiErrorResponse, useApiServer } from '../test/msw'
import { renderRoute } from '../test/renderRoute'
import { typeFast } from '../test/typeFast'
import { BAD_LOGIN_MESSAGE } from './LoginPage'

const server = useApiServer()

async function open(path = '/login', store = makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') } }).store) {
  const router = renderRoute(path, { store })
  await screen.findByRole('heading', { level: 1, name: 'Sign in' })
  return { user: userEvent.setup(), router, store }
}

async function signIn(user: ReturnType<typeof userEvent.setup>, email = 'asha@shazlo.test', password = 'correct horse battery') {
  await typeFast(user, screen.getByLabelText(/^Email address/), email)
  await typeFast(user, screen.getByLabelText(/^Password/), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('login', () => {
  it('signs in and lands in the shell', async () => {
    let body: unknown
    server.use(http.post(`${BASE}/v1/auth/login`, async ({ request }) => { body = await request.json(); return HttpResponse.json(sessionBody({ token: 'login-token' })) }))
    const { user, router, store } = await open()
    await signIn(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })).toBeTruthy()
    expect(body).toEqual({ email: 'asha@shazlo.test', password: 'correct horse battery' })
    expect(router.state.location.pathname).toBe('/')
    expect(store.getAccessToken()).toBe('login-token')
  })

  it('returns to the screen the admin was sent from', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => HttpResponse.json(sessionBody())))
    const { user, router } = await open('/login?return-to=%2F%3Ftab%3D2')
    await signIn(user)
    await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })
    expect(router.state.location.pathname + router.state.location.search).toBe('/?tab=2')
  })

  it('ignores a return-to that points anywhere else', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => HttpResponse.json(sessionBody())))
    const { user, router } = await open('/login?return-to=https%3A%2F%2Fevil.example%2Fphish')
    await signIn(user)
    await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toBe('')
  })

  it('sends an admin who must change their password to that step, keeping the return-to', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => HttpResponse.json(sessionBody({ must_change_password: true }))))
    const { user, router } = await open('/login?return-to=%2F%3Ftab%3D2')
    await signIn(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose your password' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/change-password')
    expect(new URLSearchParams(router.state.location.search).get('return-to')).toBe('/?tab=2')
  })

  it('gives one message for every kind of bad login, whatever the server says', async () => {
    const seen: string[] = []
    for (const message of ['Invalid email or password', 'No such admin', 'Admin is deactivated']) {
      server.use(http.post(`${BASE}/v1/auth/login`, () => apiErrorResponse(401, 'invalid_credentials', message)))
      const { user } = await open()
      await signIn(user, `someone${seen.length}@example.com`)
      seen.push((await screen.findByRole('alert')).textContent ?? '')
      cleanup()
    }
    expect(new Set(seen)).toEqual(new Set([BAD_LOGIN_MESSAGE]))
  })

  it('never hints whether an email is registered: the screen offers no sign-up, reset or lookup', async () => {
    await open()
    expect(BAD_LOGIN_MESSAGE).not.toMatch(/not found|no such|inactive|disabled|exist|register|unknown/i)
    expect(screen.queryByRole('link')).toBeNull()
    expect(document.body.textContent).not.toMatch(/sign up|create an account|forgot your password/i)
  })

  it('gives the same message and the same fields for a known and an unknown email', async () => {
    const answers: string[] = []
    for (const email of ['known@shazlo.test', 'unknown@shazlo.test']) {
      server.use(http.post(`${BASE}/v1/auth/login`, () => apiErrorResponse(401, 'invalid_credentials')))
      const { user } = await open()
      await signIn(user, email)
      answers.push(`${(await screen.findByRole('alert')).textContent}|${(screen.getByLabelText(/^Email address/) as HTMLInputElement).getAttribute('aria-invalid')}`)
      cleanup()
    }
    expect(answers[0]).toBe(answers[1])
  })

  it('does not keep the password in the form after submitting, success or not', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => apiErrorResponse(401, 'invalid_credentials')))
    const { user } = await open()
    await signIn(user)
    await screen.findByRole('alert')
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^Email address/) as HTMLInputElement).value).toBe('asha@shazlo.test')
  })

  it.each([
    ['accepted', () => HttpResponse.json(sessionBody())],
    ['refused', () => apiErrorResponse(401, 'invalid_credentials')],
    ['rate limited', () => apiErrorResponse(429, 'rate_limited', 'slow', { 'Retry-After': '5' })],
  ])('keeps no copy of the password in the query cache once the call has ended (%s)', async (_name, answer) => {
    let sent = false
    server.use(http.post(`${BASE}/v1/auth/login`, () => { sent = true; return answer() }))
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    renderRoute('/login', { queryClient })
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    await signIn(userEvent.setup())
    await waitFor(() => expect(sent).toBe(true))
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
  })

  it('counts down on a 429 and blocks another try until it ends', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => apiErrorResponse(429, 'rate_limited', 'slow', { 'Retry-After': '45' })))
    const { user } = await open()
    const countdown = countdownClock(45)
    await signIn(user)
    countdown((await screen.findByText(/Try again in \d+ s\./)).textContent, /Try again in (\d+) s\./)
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says plainly when the server cannot be reached', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => HttpResponse.error()))
    const { user } = await open()
    await signIn(user)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reach the server/)
  })

  it('says "our side" for a server error, without its details', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => apiErrorResponse(503, 'rate_limiter_unavailable', 'redis is down at 10.0.0.4')))
    const { user } = await open()
    await signIn(user)
    const text = (await screen.findByRole('alert')).textContent
    expect(text).toMatch(/Something went wrong on our side/)
    expect(text).not.toMatch(/redis|10\.0/)
  })

  it('does not trust an answer that is not a session', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => HttpResponse.json({ access_token: 'x' })))
    const { user, store } = await open()
    await signIn(user)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Something went wrong/)
    expect(store.getAccessToken()).toBeNull()
  })

  it('answers a 422 without echoing the server’s detail', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => apiErrorResponse(422, 'validation_error', 'body.email: leaked detail')))
    const { user } = await open()
    await signIn(user)
    const text = (await screen.findByRole('alert')).textContent
    expect(text).toMatch(/Check your email address and password/)
    expect(text).not.toMatch(/leaked/)
  })

  it('asks for what is missing, focuses it, and sends nothing', async () => {
    const sent = vi.fn()
    server.use(http.post(`${BASE}/v1/auth/login`, () => { sent(); return HttpResponse.json(sessionBody()) }))
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your email address.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Email address/))
    await typeFast(user, screen.getByLabelText(/^Email address/), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/Enter a valid email address/)).toBeTruthy()
    await typeFast(user, screen.getByLabelText(/^Email address/), '@shazlo.test')
    await user.clear(screen.getByLabelText(/^Email address/))
    await typeFast(user, screen.getByLabelText(/^Email address/), 'asha@shazlo.test')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your password.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Password/))
    expect(sent).not.toHaveBeenCalled()
  })

  it('tells the admin their session ended, and brings them back to the same screen after login', async () => {
    let expired = false
    const store = makeStore({
      refresh: async () => {
        if (expired) throw apiError(401, 'unauthorized')
        return sessionBody()
      },
    }).store
    server.use(http.post(`${BASE}/v1/auth/login`, () => HttpResponse.json(sessionBody())))
    const router = renderRoute('/?tab=1', { store })
    await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })
    expired = true
    await store.renew()
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(await screen.findByText(/Your session ended/)).toBeTruthy()
    expect(new URLSearchParams(router.state.location.search).get('return-to')).toBe('/?tab=1')
    await signIn(userEvent.setup())
    await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })
    expect(router.state.location.pathname + router.state.location.search).toBe('/?tab=1')
  })

  it('does not claim the session ended for someone who just arrived', async () => {
    await open()
    expect(screen.queryByText(/Your session ended/)).toBeNull()
  })

  it('has a show/hide toggle, the right autocomplete, and lets a password be pasted', async () => {
    const { user } = await open()
    const password = screen.getByLabelText(/^Password/) as HTMLInputElement
    expect(password.type).toBe('password')
    expect(password.getAttribute('autocomplete')).toBe('current-password')
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await user.click(toggle)
    expect(password.type).toBe('text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password.type).toBe('password')
    await user.click(password)
    await user.paste('pasted-from-a-manager')
    expect(password.value).toBe('pasted-from-a-manager')
    expect(screen.getByLabelText(/^Email address/).getAttribute('autocomplete')).toBe('username')
  })

  it('clears a typed password when the session ends', async () => {
    const { user } = await open()
    await typeFast(user, screen.getByLabelText(/^Password/), 'half typed')
    clearSensitiveState()
    await waitFor(() => expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe(''))
  })
})
