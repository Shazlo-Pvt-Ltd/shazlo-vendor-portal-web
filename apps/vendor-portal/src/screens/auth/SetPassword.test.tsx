import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { StrictMode } from 'react'
import { createMemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'
import { App } from '../../App'
import { routes } from '../../app/routes'
import { DEMO_INVITED, DEMO_LOGIN } from '../../mocks/db'
import { clearSensitiveState } from '../../security/sensitiveState'
import { countdownClock } from '../../test/countdown'
import { renderApp } from '../../test/render'
import { setupMockApi } from '../../test/server'
import { typeFast } from '../../test/typeFast'

const { server, db } = setupMockApi()
const SLOW = { timeout: 8000 }
const GOOD = 'a long enough passphrase'
const TITLE = 'Set your password'
const EXPIRED = 'This link has expired or was already used'
// The demo's staff invite (src/mocks/db.ts).
const INVITE = 'invite-kalki-demo'

beforeAll(async () => {
  await Promise.all([import('./SetPassword'), import('./SignIn')])
})

/** Kiran asked for a reset link. */
function resetLink(token = 'reset-kiran') {
  const kiran = db().users.find((u) => u.email === DEMO_LOGIN.email)!
  db().tokens.set(token, { kind: 'reset', userId: kiran.id })
  return kiran
}

async function open(route: string, heading = TITLE) {
  const view = await renderApp({ route, signedIn: false })
  expect(await screen.findByRole('heading', { level: 1, name: heading }, SLOW)).toBeInTheDocument()
  return view
}

const field = (label: string) => screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement

async function fill(user: Awaited<ReturnType<typeof renderApp>>['user'], password = GOOD, confirm = password) {
  if (password) await typeFast(user, field('New password'), password)
  if (confirm) await typeFast(user, field('New password again'), confirm)
  await user.click(screen.getByRole('button', { name: 'Save password' }))
}

function count() {
  const bodies: unknown[] = []
  server.use(
    http.post('*/v1/auth/set-password', async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

describe('Set your password', () => {
  it('takes the token out of the address bar and the history straight away, and keeps the form', async () => {
    resetLink()
    const { router } = await open('/reset-password#token=reset-kiran')
    await waitFor(() => expect(router.state.location).toMatchObject({ pathname: '/reset-password', search: '', hash: '' }))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(field('New password')).toBeInTheDocument()
  })

  it('saves the password, then sends the seller to sign in with a one-line notice', async () => {
    const kiran = resetLink()
    const bodies = count()
    const { user, router } = await open('/reset-password#token=reset-kiran')
    expect(screen.getByText('Choose a password for your seller account.')).toBeInTheDocument()
    await fill(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to your seller account' }, SLOW)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.getByRole('status')).toHaveTextContent('Your password is set. Sign in with it.')
    expect(bodies).toEqual([{ token: 'reset-kiran', password: GOOD }])
    expect(kiran.password).toBe(GOOD)

    // The new password works.
    await user.type(screen.getByLabelText('Work email'), DEMO_LOGIN.email)
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), GOOD)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('also takes the token from a ?token= query', async () => {
    resetLink('from-query')
    const bodies = count()
    const { user, router } = await open('/set-password?token=from-query')
    await waitFor(() => expect(router.state.location.search).toBe(''))
    await fill(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(bodies).toEqual([{ token: 'from-query', password: GOOD }])
  })

  it("accepts a staff invite without a name to greet (no route says who it is for), and the person can sign in", async () => {
    const { user, router } = await open(`/accept-invite#token=${INVITE}`)
    expect(screen.getByText('Welcome to Shazlo Seller. Choose a password to finish setting up your account.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Welcome, |, \.| for {2}| to manage \./)
    await fill(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(db().users.find((u) => u.email === DEMO_INVITED)).toMatchObject({ status: 'active', password: GOOD })
  })

  it('asks a signed-in seller to sign out first, then works for the invited person', async () => {
    const { user, router } = await renderApp({ route: `/accept-invite#token=${INVITE}`, signedIn: true })
    expect(await screen.findByRole('heading', { name: 'You are signed in' }, SLOW)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out and continue' }))
    expect(await screen.findByRole('heading', { level: 1, name: TITLE }, SLOW)).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    await fill(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(db().users.find((u) => u.email === DEMO_INVITED)?.password).toBe(GOOD)
  })

  it('works in StrictMode, where effects run twice', async () => {
    resetLink()
    const router = createMemoryRouter(routes, { initialEntries: ['/reset-password#token=reset-kiran'] })
    render(
      <StrictMode>
        <App router={router} queryClient={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })} />
      </StrictMode>,
    )
    await screen.findByRole('heading', { level: 1, name: TITLE }, SLOW)
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    expect(field('New password')).toBeInTheDocument()
  })

  it('uses the password fields the browser can manage', async () => {
    await open(`/accept-invite#token=${INVITE}`)
    for (const label of ['New password', 'New password again']) {
      expect(field(label)).toHaveAttribute('type', 'password')
      expect(field(label)).toHaveAttribute('autocomplete', 'new-password')
    }
    expect(field('New password')).toHaveAccessibleDescription('At least 12 characters. A few words that do not belong together work well.')
  })

  it('checks the password and the second copy before sending, and focuses the first problem', async () => {
    const bodies = count()
    const { user } = await open(`/accept-invite#token=${INVITE}`)
    await fill(user, 'short', 'short')
    expect(field('New password')).toHaveAccessibleDescription('Use at least 12 characters.')
    expect(field('New password')).toHaveFocus()
    await user.clear(field('New password'))
    await user.clear(field('New password again'))
    await fill(user, GOOD, `${GOOD}!`)
    expect(field('New password again')).toHaveAccessibleDescription('The passwords do not match. Type the same password in both fields.')
    expect(field('New password again')).toHaveFocus()
    expect(bodies).toEqual([])
  })

  it.each([
    ['/reset-password', 'Links to choose a password work once', 'Send me a new link', '/forgot-password'],
    ['/accept-invite', 'Ask the owner of your store to send you a new invite', 'Go to sign in', '/login'],
  ])('says a used or old %s link is no good, with a way on', async (path, words, action, href) => {
    const { user } = await open(`${path}#token=old-token`)
    await fill(user)
    expect(await screen.findByRole('heading', { level: 1, name: EXPIRED })).toHaveFocus()
    expect(screen.getByText(new RegExp(words))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: action })).toHaveAttribute('href', href)
    expect(screen.queryByLabelText('New password', { selector: 'input' })).toBeNull()
  })

  it('cannot be used twice', async () => {
    resetLink()
    const first = await open('/reset-password#token=reset-kiran')
    await fill(first.user)
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/login'))
    cleanup()
    const again = await open('/reset-password#token=reset-kiran')
    await fill(again.user, 'another long passphrase')
    expect(await screen.findByRole('heading', { level: 1, name: EXPIRED })).toBeInTheDocument()
    expect(db().users.find((u) => u.email === DEMO_LOGIN.email)?.password).toBe(GOOD)
  })

  it.each([
    ['no token', '/set-password'],
    ['a token longer than any vendor-api makes', `/set-password#token=${'x'.repeat(201)}`],
  ])('shows the expired page without calling the API for %s', async (_name, route) => {
    const bodies = count()
    await open(route, EXPIRED)
    expect(bodies).toEqual([])
  })

  it("puts the server's password refusal on the password field", async () => {
    db().faults.push({ path: '/v1/auth/set-password', status: 422, code: 'weak_password', message: 'Password is too common' })
    const { user } = await open(`/accept-invite#token=${INVITE}`)
    await fill(user)
    await waitFor(() => expect(field('New password')).toHaveAccessibleDescription('Password is too common'))
    expect(field('New password')).toHaveFocus()
  })

  it('counts down after too many attempts', async () => {
    server.use(http.post('*/v1/auth/set-password', () => HttpResponse.json({ error: { code: 'rate_limited', message: 'x' } }, { status: 429, headers: { 'Retry-After': '30' } }), { once: true }))
    const { user } = await open(`/accept-invite#token=${INVITE}`)
    const countdown = countdownClock(30)
    await fill(user)
    countdown((await screen.findByText(/Too many attempts. Try again in \d+ s\./)).textContent, /Try again in (\d+) s\./)
    expect(screen.getByRole('button', { name: 'Save password' })).toBeDisabled()
  })

  it('keeps the token and the form through a network failure, and saves on the next try', async () => {
    db().faults.push({ path: '/v1/auth/set-password', network: true })
    const { user, router } = await open(`/accept-invite#token=${INVITE}`)
    await fill(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(field('New password')).toHaveValue(GOOD)
    await user.click(screen.getByRole('button', { name: 'Save password' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('sends once on a double click', async () => {
    const bodies = count()
    const { user, router } = await open(`/accept-invite#token=${INVITE}`)
    await typeFast(user, field('New password'), GOOD)
    await typeFast(user, field('New password again'), GOOD)
    await user.dblClick(screen.getByRole('button', { name: 'Save password' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(bodies).toHaveLength(1)
  })

  it('keeps no copy of the token and password in the query cache once the call has ended', async () => {
    db().faults.push({ path: '/v1/auth/set-password', status: 422, code: 'weak_password', message: 'Password is too common' })
    const { user, queryClient } = await open(`/accept-invite#token=${INVITE}`)
    await fill(user)
    await screen.findByText('Password is too common')
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
  })

  it('forgets what was typed when the session state is cleared', async () => {
    const { user } = await open(`/accept-invite#token=${INVITE}`)
    await typeFast(user, field('New password'), GOOD)
    act(() => clearSensitiveState())
    await waitFor(() => expect(field('New password')).toHaveValue(''))
  })
})
