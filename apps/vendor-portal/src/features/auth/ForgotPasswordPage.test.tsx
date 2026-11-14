import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { BASE, apiErrorResponse, useApiServer } from '../../test/msw'
import { renderRoute } from '../../test/renderRoute'
import { FORGOT_CONFIRMATION } from './ForgotPasswordPage'

const server = useApiServer()

async function open() {
  renderRoute('/forgot-password')
  await screen.findByRole('heading', { level: 1, name: 'Reset your password' })
  return userEvent.setup()
}

async function send(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.type(screen.getByLabelText(/^Email address/), email)
  await user.click(screen.getByRole('button', { name: 'Send the link' }))
}

describe('forgot password', () => {
  it('shows the identical confirmation for a known and an unknown address', async () => {
    const pages: string[] = []
    for (const email of ['known@kala.example', 'nobody@nowhere.example']) {
      server.use(http.post(`${BASE}/v1/auth/forgot-password`, () => HttpResponse.json({ status: 'accepted', message: 'ok' }, { status: 202 })))
      const user = await open()
      await send(user, email)
      await screen.findByRole('heading', { level: 1, name: 'Check your email' })
      pages.push(document.querySelector('main')!.textContent ?? '')
      document.body.innerHTML = ''
    }
    expect(pages[0]).toBe(pages[1])
    expect(pages[0]).toContain(FORGOT_CONFIRMATION)
    expect(FORGOT_CONFIRMATION).not.toMatch(/we have sent a link to (you|that)|no account|not found|unknown/i)
  })

  it('does not even echo the address back', async () => {
    server.use(http.post(`${BASE}/v1/auth/forgot-password`, () => HttpResponse.json({}, { status: 202 })))
    const user = await open()
    await send(user, 'private@kala.example')
    await screen.findByRole('heading', { level: 1, name: 'Check your email' })
    expect(document.body.textContent).not.toContain('private@kala.example')
  })

  it('sends only the address', async () => {
    let body: unknown
    server.use(http.post(`${BASE}/v1/auth/forgot-password`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}, { status: 202 }) }))
    const user = await open()
    await send(user, '  asha@kala.example ')
    await screen.findByRole('heading', { level: 1, name: 'Check your email' })
    expect(body).toEqual({ email: 'asha@kala.example' })
  })

  it('asks for a valid address before sending anything', async () => {
    const sent = vi.fn()
    server.use(http.post(`${BASE}/v1/auth/forgot-password`, () => { sent(); return HttpResponse.json({}, { status: 202 }) }))
    const user = await open()
    await send(user, 'not-an-email')
    expect(await screen.findByText('Enter the email address you signed up with.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Email address/))
    expect(sent).not.toHaveBeenCalled()
  })

  it('counts down on a 429', async () => {
    server.use(http.post(`${BASE}/v1/auth/forgot-password`, () => apiErrorResponse(429, 'rate_limited', 'x', { 'Retry-After': '120' })))
    const user = await open()
    await send(user, 'asha@kala.example')
    expect(await screen.findByText(/Try again in (120|119) s\./)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send the link' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says plainly when the server cannot be reached', async () => {
    server.use(http.post(`${BASE}/v1/auth/forgot-password`, () => HttpResponse.error()))
    const user = await open()
    await send(user, 'asha@kala.example')
    expect(await screen.findByText(/Could not reach the server/)).toBeTruthy()
  })
})
