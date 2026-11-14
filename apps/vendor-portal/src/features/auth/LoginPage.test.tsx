import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { apiError, makeStore, sessionBody } from '../../session/testing'
import { clearSensitiveState } from '../../security/sensitiveState'
import { BASE, apiErrorResponse, useApiServer } from '../../test/msw'
import { renderRoute } from '../../test/renderRoute'
import { BAD_LOGIN_MESSAGE } from './LoginPage'

const server = useApiServer()

async function open(path = '/login', store = makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') } }).store) {
  const router = renderRoute(path, { store })
  await screen.findByRole('heading', { level: 1, name: 'Sign in' })
  return { user: userEvent.setup(), router, store }
}

async function signIn(user: ReturnType<typeof userEvent.setup>, email = 'asha@kala.example', password = 'correct horse battery') {
  await user.type(screen.getByLabelText(/^Email address/), email)
  await user.type(screen.getByLabelText(/^Password/), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('login', () => {
  it('signs in and lands on the dashboard', async () => {
    let body: unknown
    server.use(http.post(`${BASE}/v1/auth/login`, async ({ request }) => { body = await request.json(); return HttpResponse.json(sessionBody({ token: 'login-token' })) }))
    const { user, router, store } = await open()
    await signIn(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy()
    expect(body).toEqual({ email: 'asha@kala.example', password: 'correct horse battery' })
    expect(router.state.location.pathname).toBe('/')
    expect(store.getAccessToken()).toBe('login-token')
  })

  it('returns to the screen the user was sent from', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => HttpResponse.json(sessionBody())))
    const { user, router } = await open('/login?return-to=%2Fproducts')
    await signIn(user)
    await screen.findByRole('heading', { level: 1, name: 'Products' })
    expect(router.state.location.pathname).toBe('/products')
  })

  it('ignores a return-to that points anywhere else', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => HttpResponse.json(sessionBody())))
    const { user, router } = await open('/login?return-to=https%3A%2F%2Fevil.example%2Fphish')
    await signIn(user)
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    expect(router.state.location.pathname).toBe('/')
  })

  it('gives one message for every kind of bad login, whatever the server says', async () => {
    const seen: string[] = []
    for (const message of ['Invalid email or password', 'No such user', 'Email not verified']) {
      server.use(http.post(`${BASE}/v1/auth/login`, () => apiErrorResponse(401, 'invalid_credentials', message)))
      const { user } = await open()
      await signIn(user, `someone${seen.length}@example.com`)
      seen.push((await screen.findByRole('alert')).textContent ?? '')
      document.body.innerHTML = ''
    }
    expect(new Set(seen)).toEqual(new Set([BAD_LOGIN_MESSAGE]))
    expect(BAD_LOGIN_MESSAGE).not.toMatch(/not found|no such|unverified|disabled|exist|register/i)
  })

  it('does not keep the password in the form after submitting, success or not', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => apiErrorResponse(401, 'invalid_credentials')))
    const { user } = await open()
    await signIn(user)
    await screen.findByRole('alert')
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^Email address/) as HTMLInputElement).value).toBe('asha@kala.example')
  })

  it('shows the explanation page, not a loop, for a rejected or suspended vendor', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => apiErrorResponse(403, 'vendor_not_allowed')))
    const { user, router, store } = await open()
    await signIn(user)
    expect(await screen.findByRole('heading', { level: 1, name: "This account can't use the portal" })).toBeTruthy()
    expect(store.getSnapshot().status).toBe('blocked')
    expect(router.state.location.pathname).toBe('/')
  })

  it('counts down on a 429 and blocks another try until it ends', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => apiErrorResponse(429, 'rate_limited', 'slow', { 'Retry-After': '45' })))
    const { user } = await open()
    await signIn(user)
    expect(await screen.findByText(/Try again in (45|44) s\./)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says plainly when the server cannot be reached', async () => {
    server.use(http.post(`${BASE}/v1/auth/login`, () => HttpResponse.error()))
    const { user } = await open()
    await signIn(user)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reach the server/)
  })

  it('asks for what is missing, focuses it, and sends nothing', async () => {
    const sent = vi.fn()
    server.use(http.post(`${BASE}/v1/auth/login`, () => { sent(); return HttpResponse.json(sessionBody()) }))
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your email address.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Email address/))
    await user.type(screen.getByLabelText(/^Email address/), 'asha@kala.example')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your password.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Password/))
    expect(sent).not.toHaveBeenCalled()
  })

  it('tells the user their session ended, and brings them back to the same screen after login', async () => {
    let expired = false
    const store = makeStore({
      refresh: async () => {
        if (expired) throw apiError(401, 'unauthorized')
        return sessionBody()
      },
    }).store
    server.use(http.post(`${BASE}/v1/auth/login`, () => HttpResponse.json(sessionBody())))
    const router = renderRoute('/products', { store })
    await screen.findByRole('heading', { level: 1, name: 'Products' })
    expired = true
    await store.renew()
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(await screen.findByText(/Your session ended/)).toBeTruthy()
    expect(new URLSearchParams(router.state.location.search).get('return-to')).toBe('/products')
    const user = userEvent.setup()
    await signIn(user)
    await screen.findByRole('heading', { level: 1, name: 'Products' })
    expect(router.state.location.pathname).toBe('/products')
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
    expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password.type).toBe('password')
    await user.click(password)
    await user.paste('pasted-from-a-manager')
    expect(password.value).toBe('pasted-from-a-manager')
    expect(screen.getByLabelText(/^Email address/).getAttribute('autocomplete')).toBe('username')
  })

  it('links to forgot password and signup', async () => {
    await open()
    expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe('/forgot-password')
    expect(screen.getByRole('link', { name: 'Create a vendor account' }).getAttribute('href')).toBe('/signup')
  })

  it('clears a typed password when the session ends', async () => {
    const { user } = await open()
    await user.type(screen.getByLabelText(/^Password/), 'half typed')
    clearSensitiveState()
    await waitFor(() => expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe(''))
  })
})
