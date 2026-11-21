import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { StrictMode } from 'react'
import { createMemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'
import { App } from '../../App'
import { routes } from '../../app/routes'
import { DEMO_STAFF } from '../../mocks/db'
import { renderApp } from '../../test/render'
import { setupMockApi } from '../../test/server'
import { typeFast } from '../../test/typeFast'

const { server, db } = setupMockApi()
const SLOW = { timeout: 8000 }
const CONFIRMED = 'Your email is confirmed'
const EXPIRED = 'This link has expired or was already used'

beforeAll(async () => {
  await import('./VerifyEmail')
})

/** Meera has just signed up: her email waits to be confirmed, with this link. */
function unconfirmed(token = 'verify-meera') {
  const meera = db().users.find((u) => u.email === DEMO_STAFF.email)!
  meera.verified = false
  db().tokens.set(token, { kind: 'verify', userId: meera.id })
  return meera
}

/** Counts the calls to an endpoint without answering them (the mock API still does). */
function count(path: string) {
  const calls: unknown[] = []
  server.use(
    http.post(`*${path}`, async ({ request }) => {
      calls.push(await request.clone().json())
    }),
  )
  return calls
}

async function open(route: string, heading: string) {
  const view = await renderApp({ route, signedIn: false })
  expect(await screen.findByRole('heading', { level: 1, name: heading }, SLOW)).toBeInTheDocument()
  return view
}

describe('Verify your email', () => {
  it('confirms the email from the link, then offers to sign in', async () => {
    const meera = unconfirmed()
    const calls = count('/v1/auth/verify-email')
    await open('/verify-email#token=verify-meera', CONFIRMED)
    expect(calls).toEqual([{ token: 'verify-meera' }])
    expect(meera.verified).toBe(true)
    expect(screen.getByRole('heading', { level: 1, name: CONFIRMED })).toHaveFocus()
    const signIn = screen.getByRole('link', { name: 'Sign in' })
    expect(signIn).toHaveAttribute('href', '/login')
    expect(signIn).toHaveClass('MuiButton-contained')
  })

  it('takes the token out of the address bar and the history at once', async () => {
    unconfirmed()
    const { router } = await open('/verify-email#token=verify-meera', CONFIRMED)
    await waitFor(() => expect(router.state.location).toMatchObject({ pathname: '/verify-email', search: '', hash: '' }))
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('also takes the token from a ?token= query, and removes that too', async () => {
    unconfirmed('from-query')
    const { router } = await open('/verify-email?token=from-query', CONFIRMED)
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('spends the token exactly once, even when effects run twice (StrictMode)', async () => {
    unconfirmed()
    const calls = count('/v1/auth/verify-email')
    const router = createMemoryRouter(routes, { initialEntries: ['/verify-email#token=verify-meera'] })
    render(
      <StrictMode>
        <App router={router} queryClient={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })} />
      </StrictMode>,
    )
    await screen.findByRole('heading', { level: 1, name: CONFIRMED }, SLOW)
    expect(calls).toHaveLength(1)
  })

  it('says a used link is used, and offers a new one and sign in', async () => {
    unconfirmed()
    await open('/verify-email#token=verify-meera', CONFIRMED)
    cleanup()
    // The same link again.
    await open('/verify-email#token=verify-meera', EXPIRED)
    expect(screen.getByRole('link', { name: 'sign in' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('form', { name: 'Get a new link' })).toBeInTheDocument()
  })

  it.each([
    ['no token at all', '/verify-email'],
    ['an empty token', '/verify-email#token='],
    ['a token longer than any vendor-api makes', `/verify-email#token=${'a'.repeat(5000)}`],
  ])('shows the expired page without calling the API for %s', async (_name, route) => {
    const calls = count('/v1/auth/verify-email')
    await open(route, EXPIRED)
    expect(calls).toEqual([])
  })

  it('offers to try again, not "expired", when the server cannot be reached', async () => {
    unconfirmed()
    db().faults.push({ path: '/v1/auth/verify-email', network: true })
    const { user } = await open('/verify-email#token=verify-meera', 'We could not check your link')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: CONFIRMED })).toBeInTheDocument()
  })

  it('counts down after too many attempts', async () => {
    unconfirmed()
    server.use(http.post('*/v1/auth/verify-email', () => HttpResponse.json({ error: { code: 'rate_limited', message: 'x' } }, { status: 429, headers: { 'Retry-After': '30' } }), { once: true }))
    await open('/verify-email#token=verify-meera', 'We could not check your link')
    expect(await screen.findByText(/Too many attempts. Try again in (30|29) s\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
  })

  it('asks a signed-in seller first, and spends nothing until they choose', async () => {
    unconfirmed()
    const calls = count('/v1/auth/verify-email')
    await renderApp({ route: '/verify-email#token=verify-meera', signedIn: true })
    expect(await screen.findByRole('heading', { name: 'You are signed in' }, SLOW)).toBeInTheDocument()
    expect(calls).toEqual([])
  })
})

describe('asking for a new link', () => {
  async function openExpired() {
    const view = await open('/verify-email', EXPIRED)
    return { ...view, form: screen.getByRole('form', { name: 'Get a new link' }) }
  }

  it('sends one, says the same whatever the address, and waits before the next', async () => {
    const meera = unconfirmed()
    const { user, form } = await openExpired()
    expect(within(form).getByRole('textbox', { name: 'Your email' })).toHaveAttribute('autocomplete', 'email')
    await typeFast(user, within(form).getByRole('textbox', { name: 'Your email' }), ` ${meera.email} `)
    await user.dblClick(within(form).getByRole('button', { name: 'Send the email again' }))
    const sent = await screen.findByText('If that email needs a new link, it is on its way. Check your inbox and spam folder.')
    expect(sent.textContent).not.toMatch(/already|registered|no account|not found|exists/i)
    expect(within(form).getByRole('button', { name: /^Send again in \d+ s$/ })).toBeDisabled()
    expect(db().emails).toEqual([expect.objectContaining({ to: meera.email, kind: 'verify' })])
  })

  it('checks the address before sending anything', async () => {
    const calls = count('/v1/auth/resend-verification')
    const { user, form } = await openExpired()
    await typeFast(user, within(form).getByRole('textbox', { name: 'Your email' }), 'nope')
    await user.click(within(form).getByRole('button', { name: 'Send the email again' }))
    expect(within(form).getByRole('textbox', { name: 'Your email' })).toHaveAccessibleDescription('Enter an email like name@brand.in.')
    expect(within(form).getByRole('textbox', { name: 'Your email' })).toHaveFocus()
    expect(calls).toEqual([])
  })

  it('shows the wait from Retry-After', async () => {
    server.use(http.post('*/v1/auth/resend-verification', () => HttpResponse.json({ error: { code: 'rate_limited', message: 'x' } }, { status: 429, headers: { 'Retry-After': '90' } }), { once: true }))
    const { user, form } = await openExpired()
    await typeFast(user, within(form).getByRole('textbox', { name: 'Your email' }), 'meera@kalkistudio.in')
    await user.click(within(form).getByRole('button', { name: 'Send the email again' }))
    expect(await screen.findByText('Too many attempts.')).toBeInTheDocument()
    await waitFor(() => expect(within(form).getByRole('button', { name: /^Send again in (90|89) s$/ })).toBeDisabled())
  })
})
