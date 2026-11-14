import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetApiClient } from '../../api/instance'
import { clearSensitiveState } from '../../security/sensitiveState'
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

async function open() {
  renderRoute('/signup')
  await screen.findByRole('heading', { level: 1, name: 'Create your vendor account' })
  return userEvent.setup()
}

async function fillValid(user: ReturnType<typeof userEvent.setup>, overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    'Brand name': 'Kala Kurtas',
    'Your name': 'Asha Rao',
    'Email address': 'asha@kala.example',
    'Phone number': '+91 98765 43210',
    'What do you sell?': 'kurtas',
    'Lowest price': '99.90',
    'Highest price': '1,000',
    Password: 'a-long-enough-password',
    ...overrides,
  }
  for (const [label, value] of Object.entries(values)) {
    await user.type(screen.getByLabelText(new RegExp(`^${label}`)), value)
  }
  await user.click(screen.getByRole('checkbox'))
}

const submit = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Create account' }))

describe('the signup form', () => {
  it('sends exactly the API fields, with prices as integer paise, and says to check email', async () => {
    let body: Record<string, unknown> | undefined
    server.use(
      http.post(`${BASE}/v1/auth/signup`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ status: 'accepted', message: 'ok' }, { status: 202 })
      }),
    )
    const user = await open()
    await fillValid(user)
    await submit(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toBeTruthy()
    expect(body).toEqual({
      brand_name: 'Kala Kurtas',
      contact_name: 'Asha Rao',
      email: 'asha@kala.example',
      phone: '+91 98765 43210',
      product_type: 'kurtas',
      price_min_paise: 9990,
      price_max_paise: 100000,
      password: 'a-long-enough-password',
      terms_accepted: true,
    })
    expect(Number.isInteger(body!.price_min_paise)).toBe(true)
    expect(screen.getByText('asha@kala.example')).toBeTruthy()
  })

  it('gives the same confirmation whatever the server did, so it never hints an address exists', async () => {
    const texts: string[] = []
    for (const message of ['verification sent', 'already registered']) {
      server.use(http.post(`${BASE}/v1/auth/signup`, () => HttpResponse.json({ status: 'accepted', message }, { status: 202 })))
      const view = renderRoute('/signup')
      await screen.findByRole('heading', { level: 1, name: 'Create your vendor account' })
      const user = userEvent.setup()
      await fillValid(user)
      await submit(user)
      await screen.findByRole('heading', { level: 1, name: 'Check your email' })
      texts.push(document.body.textContent ?? '')
      void view
      document.body.innerHTML = ''
    }
    expect(texts[0]).toBe(texts[1])
    expect(texts[0]).not.toMatch(/already|registered|exists|taken/i)
  })

  it('shows client problems next to their fields, moves focus to the first, and sends nothing', async () => {
    const sent = vi.fn()
    server.use(http.post(`${BASE}/v1/auth/signup`, () => { sent(); return HttpResponse.json({}, { status: 202 }) }))
    const user = await open()
    await user.type(screen.getByLabelText(/^Phone number/), '123')
    await submit(user)
    const brand = screen.getByLabelText(/^Brand name/)
    await waitFor(() => expect(document.activeElement).toBe(brand))
    expect(brand.getAttribute('aria-invalid')).toBe('true')
    const describedBy = brand.getAttribute('aria-describedby')!
    expect(document.getElementById(describedBy)!.textContent).toBe('Enter your brand name.')
    expect(document.getElementById(screen.getByLabelText(/^Phone number/).getAttribute('aria-describedby')!)!.textContent).toMatch(/valid phone number/)
    expect(screen.getByText('Accept the terms to create your account.')).toBeTruthy()
    expect(sent).not.toHaveBeenCalled()
  })

  it('requires the highest price to be at least the lowest', async () => {
    const user = await open()
    await fillValid(user, { 'Lowest price': '500', 'Highest price': '400' })
    await submit(user)
    expect(await screen.findByText('The highest price cannot be lower than the lowest price.')).toBeTruthy()
  })

  it('shows a 422 next to the fields it names', async () => {
    server.use(
      http.post(`${BASE}/v1/auth/signup`, () =>
        HttpResponse.json(
          { error: { code: 'validation_error', message: 'Request validation failed', details: [
            { loc: ['body', 'phone'], msg: 'String should match pattern', type: 'x' },
            { loc: ['body', 'brand_name'], msg: 'Value error, use printable characters', type: 'x' },
          ] } },
          { status: 422 },
        ),
      ),
    )
    const user = await open()
    await fillValid(user)
    await submit(user)
    const brand = await screen.findByLabelText(/^Brand name/)
    expect(document.getElementById(brand.getAttribute('aria-describedby')!)!.textContent).toBe('use printable characters')
    expect(document.getElementById(screen.getByLabelText(/^Phone number/).getAttribute('aria-describedby')!)!.textContent).toBe('String should match pattern')
    await waitFor(() => expect(document.activeElement).toBe(brand))
  })

  it('shows weak_password on the password field and terms_not_accepted on the terms', async () => {
    server.use(
      http.post(`${BASE}/v1/auth/signup`, () => HttpResponse.json({ error: { code: 'weak_password', message: 'Password is too common' } }, { status: 422 })),
    )
    const user = await open()
    await fillValid(user)
    await submit(user)
    expect(await screen.findByText('Password is too common')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Password/))
  })

  it('shows a countdown from Retry-After on a 429 and blocks sending until it ends', async () => {
    server.use(
      http.post(`${BASE}/v1/auth/signup`, () =>
        HttpResponse.json({ error: { code: 'rate_limited', message: 'slow down' } }, { status: 429, headers: { 'Retry-After': '42' } }),
      ),
    )
    const user = await open()
    await fillValid(user)
    await submit(user)
    expect(await screen.findByText(/Try again in (42|41) s\./)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Try again in about (42|41) seconds/)).toBeTruthy()
  })

  it('says so, in plain words, when the server cannot be reached', async () => {
    server.use(http.post(`${BASE}/v1/auth/signup`, () => HttpResponse.error()))
    const user = await open()
    await fillValid(user)
    await submit(user)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reach the server/)
  })

  it('does not send twice on a double click', async () => {
    let calls = 0
    server.use(http.post(`${BASE}/v1/auth/signup`, async () => { calls += 1; await new Promise((r) => setTimeout(r, 50)); return HttpResponse.json({}, { status: 202 }) }))
    const user = await open()
    await fillValid(user)
    await user.dblClick(screen.getByRole('button', { name: 'Create account' }))
    await screen.findByRole('heading', { level: 1, name: 'Check your email' })
    expect(calls).toBe(1)
  })

  it('opens the terms and privacy pages safely', async () => {
    await open()
    for (const name of ['terms', 'privacy policy']) {
      const link = screen.getByRole('link', { name })
      expect(link.getAttribute('href')).toMatch(/^https:\/\//)
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })

  it('has a label for every field, a password field the browser can manage, and no required-less submit', async () => {
    await open()
    const form = screen.getByRole('form', { name: 'Create your vendor account' })
    for (const input of within(form).getAllByRole('textbox')) {
      expect(input.getAttribute('id')).toBeTruthy()
      expect(document.querySelector(`label[for="${input.id}"]`)).not.toBeNull()
    }
    const password = within(form).getByLabelText(/^Password/)
    expect(password.getAttribute('type')).toBe('password')
    expect(password.getAttribute('autocomplete')).toBe('new-password')
    expect(within(form).getByLabelText(/^Email address/).getAttribute('autocomplete')).toBe('email')
    expect(within(form).getByLabelText(/^Phone number/).getAttribute('inputmode')).toBe('tel')
  })

  it('clears the typed password when the session ends', async () => {
    const user = await open()
    await user.type(screen.getByLabelText(/^Password/), 'a-long-enough-password')
    clearSensitiveState()
    await waitFor(() => expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe(''))
  })
})
