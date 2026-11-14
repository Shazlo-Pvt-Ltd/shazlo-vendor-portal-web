import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetApiClient } from '../../api/instance'
import { renderRoute } from '../../test/renderRoute'

const BASE = 'https://api.test'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  vi.stubEnv('VITE_VENDOR_API_URL', BASE)
  resetApiClient()
  server.use(http.post(`${BASE}/v1/auth/refresh`, () => HttpResponse.json({ error: { code: 'unauthorized', message: 'no' } }, { status: 401 })))
})
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const invalid = () => HttpResponse.json({ error: { code: 'invalid_token', message: 'Invalid or expired token' } }, { status: 400 })

describe('the verify-email page', () => {
  it('spends the token, then offers sign in', async () => {
    let received: unknown
    server.use(http.post(`${BASE}/v1/auth/verify-email`, async ({ request }) => { received = await request.json(); return new HttpResponse(null, { status: 204 }) }))
    renderRoute('/verify-email?token=abc123')
    expect(await screen.findByRole('heading', { level: 1, name: 'Your email is verified' })).toBeTruthy()
    expect(received).toEqual({ token: 'abc123' })
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
  })

  it('spends the token exactly once, even when effects run twice (StrictMode)', async () => {
    let calls = 0
    server.use(http.post(`${BASE}/v1/auth/verify-email`, () => { calls += 1; return new HttpResponse(null, { status: 204 }) }))
    renderRoute('/verify-email?token=abc123', { strict: true })
    await screen.findByRole('heading', { level: 1, name: 'Your email is verified' })
    expect(calls).toBe(1)
  })

  it('removes the token from the address bar', async () => {
    server.use(http.post(`${BASE}/v1/auth/verify-email`, () => new HttpResponse(null, { status: 204 })))
    const router = renderRoute('/verify-email?token=abc123')
    await screen.findByRole('heading', { level: 1, name: 'Your email is verified' })
    expect(router.state.location.search).toBe('')
    expect(router.state.location.pathname).toBe('/verify-email')
  })

  it('says the link expired or was used, and offers a new one, on a 400', async () => {
    server.use(http.post(`${BASE}/v1/auth/verify-email`, invalid))
    renderRoute('/verify-email?token=old')
    expect(await screen.findByRole('heading', { level: 1, name: 'This link has expired or was already used' })).toBeTruthy()
    expect(screen.getByRole('form', { name: 'Send a new verification link' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'sign in' }).getAttribute('href')).toBe('/login')
  })

  it('shows the same expired page when there is no token at all, without calling the API', async () => {
    const called = vi.fn()
    server.use(http.post(`${BASE}/v1/auth/verify-email`, () => { called(); return new HttpResponse(null, { status: 204 }) }))
    renderRoute('/verify-email')
    expect(await screen.findByRole('heading', { level: 1, name: 'This link has expired or was already used' })).toBeTruthy()
    expect(called).not.toHaveBeenCalled()
  })

  it('shows a retry, not "expired", when the server cannot be reached, and can succeed on retry', async () => {
    let attempt = 0
    server.use(http.post(`${BASE}/v1/auth/verify-email`, () => { attempt += 1; return attempt === 1 ? HttpResponse.error() : new HttpResponse(null, { status: 204 }) }))
    renderRoute('/verify-email?token=abc123')
    expect(await screen.findByRole('heading', { level: 1, name: "We couldn't verify your email" })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Your email is verified' })).toBeTruthy()
    expect(attempt).toBe(2)
  })

  it('counts down on a 429', async () => {
    server.use(http.post(`${BASE}/v1/auth/verify-email`, () => HttpResponse.json({ error: { code: 'rate_limited', message: 'x' } }, { status: 429, headers: { 'Retry-After': '30' } })))
    renderRoute('/verify-email?token=abc123')
    expect((await screen.findByRole('alert')).textContent).toMatch(/Try again in (30|29) s\./)
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('asking for a new link', () => {
  async function openExpired() {
    server.use(http.post(`${BASE}/v1/auth/verify-email`, invalid))
    renderRoute('/verify-email?token=old')
    await screen.findByRole('heading', { level: 1, name: 'This link has expired or was already used' })
    return userEvent.setup()
  }

  it('sends the address, says nothing about whether it exists, and starts a cooldown', async () => {
    let body: unknown
    server.use(http.post(`${BASE}/v1/auth/resend-verification`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ status: 'accepted', message: 'ok' }, { status: 202 }) }))
    const user = await openExpired()
    await user.type(screen.getByLabelText('Email address'), 'asha@kala.example')
    await user.click(screen.getByRole('button', { name: 'Send a new link' }))
    expect(await screen.findByText(/If that address needs a new link, it is on its way/)).toBeTruthy()
    expect(body).toEqual({ email: 'asha@kala.example' })
    const again = screen.getByRole('button', { name: /Send again in \d+ s/ }) as HTMLButtonElement
    expect(again.disabled).toBe(true)
    const confirmation = (await screen.findByText(/it is on its way/)).textContent ?? ''
    expect(confirmation).not.toMatch(/already|registered|no account|not found|exists/i)
  })

  it('cannot be double-clicked into sending twice', async () => {
    let calls = 0
    server.use(http.post(`${BASE}/v1/auth/resend-verification`, async () => { calls += 1; await new Promise((r) => setTimeout(r, 30)); return HttpResponse.json({}, { status: 202 }) }))
    const user = await openExpired()
    await user.type(screen.getByLabelText('Email address'), 'asha@kala.example')
    await user.dblClick(screen.getByRole('button', { name: 'Send a new link' }))
    await screen.findByText(/it is on its way/)
    expect((screen.getByRole('button', { name: /Send again in/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls).toBe(1)
  })

  it('asks for a valid address before sending anything', async () => {
    const sent = vi.fn()
    server.use(http.post(`${BASE}/v1/auth/resend-verification`, () => { sent(); return HttpResponse.json({}, { status: 202 }) }))
    const user = await openExpired()
    await user.type(screen.getByLabelText('Email address'), 'nope')
    await user.click(screen.getByRole('button', { name: 'Send a new link' }))
    expect(await screen.findByText('Enter the email address you signed up with.')).toBeTruthy()
    expect(sent).not.toHaveBeenCalled()
  })

  it('shows the wait from Retry-After on a 429', async () => {
    server.use(http.post(`${BASE}/v1/auth/resend-verification`, () => HttpResponse.json({ error: { code: 'rate_limited', message: 'x' } }, { status: 429, headers: { 'Retry-After': '90' } })))
    const user = await openExpired()
    await user.type(screen.getByLabelText('Email address'), 'asha@kala.example')
    await user.click(screen.getByRole('button', { name: 'Send a new link' }))
    expect(await screen.findByText('Too many attempts.')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: /Send again in (90|89) s/ })).toBeTruthy())
  })
})
