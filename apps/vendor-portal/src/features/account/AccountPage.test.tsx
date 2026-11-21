import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { makeStore, sessionBody } from '../../session/testing'
import { BASE, apiErrorResponse, useApiServer } from '../../test/msw'
import { renderRoute } from '../../test/renderRoute'
import { typeFast } from '../../test/typeFast'
import { setViewport } from '../../test/viewport'
import { checkPasswords } from './rules'

const server = useApiServer()
const CHANGE = `${BASE}/v1/auth/change-password`
const OLD = 'old-password-123'
const NEW = 'a brand new passphrase'

function serve(answer?: () => Response) {
  const bodies: unknown[] = []
  server.use(
    http.post(CHANGE, async ({ request }) => {
      bodies.push(await request.json())
      return answer ? answer() : HttpResponse.json(sessionBody({ token: 'token-after-change' }))
    }),
  )
  return bodies
}

async function open(answer?: () => Response, role: 'owner' | 'staff' = 'owner') {
  setViewport(1280)
  const bodies = serve(answer)
  const { store } = makeStore({ refresh: async () => sessionBody({ role }) })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  renderRoute('/account', { store, queryClient })
  await screen.findByRole('heading', { level: 1, name: 'Account' }, { timeout: 15_000 })
  return { bodies, store, queryClient, user: userEvent.setup() }
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

async function fill(user: ReturnType<typeof userEvent.setup>, current = OLD, next = NEW, confirm = next) {
  if (current) await typeFast(user, field('Current password'), current)
  if (next) await typeFast(user, field('New password'), next)
  if (confirm) await typeFast(user, field('Repeat the new password'), confirm)
  await user.click(screen.getByRole('button', { name: 'Change password' }))
}

describe('the account page', () => {
  it("shows the signed-in user's profile from the session", async () => {
    await open()
    const profile = screen.getByRole('region', { name: 'Your profile' })
    expect(profile.textContent).toContain('owner@brand.test')
    expect(profile.textContent).toContain('Owner (manages the team)')
    expect(profile.textContent).toContain('Brand')
    expect(profile.textContent).toContain('Approved')
  })

  it('shows staff as staff', async () => {
    await open(undefined, 'staff')
    expect(screen.getByRole('region', { name: 'Your profile' }).textContent).toContain('Staff')
  })
})

describe('changing the password', () => {
  it('sends both passwords, takes the new session, clears the form and keeps no copy', async () => {
    const { bodies, store, queryClient, user } = await open()
    await fill(user)
    expect(await screen.findByText('Your password is changed. You have been signed out everywhere else.')).toBeTruthy()
    expect(bodies).toEqual([{ current_password: OLD, new_password: NEW }])
    expect(store.getAccessToken()).toBe('token-after-change')
    expect(field('Current password').value).toBe('')
    expect(field('New password').value).toBe('')
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
  })

  it('checks the new password before sending', async () => {
    const { bodies, user } = await open()
    await fill(user, OLD, 'short', 'short')
    expect(screen.getByText('Use at least 12 characters.')).toBeTruthy()
    expect(document.activeElement).toBe(field('New password'))
    await fill(user, '', '', 'something else')
    expect(screen.getByText('The two new passwords do not match.')).toBeTruthy()
    expect(bodies).toEqual([])
  })

  it('puts a wrong current password next to that field', async () => {
    const { user } = await open(() => apiErrorResponse(400, 'invalid_current_password', 'The current password is wrong'))
    await fill(user)
    expect(await screen.findByText('This is not your current password.')).toBeTruthy()
    expect(document.activeElement).toBe(field('Current password'))
    expect(field('Current password').value).toBe('')
    // The new password stays, so only the current one has to be typed again.
    expect(field('New password').value).toBe(NEW)
  })

  it("puts the API's weak-password reason next to the new password", async () => {
    const { user } = await open(() => apiErrorResponse(422, 'weak_password', 'This password is too common'))
    await fill(user)
    expect(await screen.findByText('This password is too common')).toBeTruthy()
    expect(document.activeElement).toBe(field('New password'))
  })

  it('counts down after too many attempts', async () => {
    const { user } = await open(() => apiErrorResponse(429, 'rate_limited', 'x', { 'Retry-After': '30' }))
    await fill(user)
    expect(await screen.findByText(/Too many attempts. Try again in about 30 seconds./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change password' }).matches(':disabled')).toBe(true)
  })
})

describe('checkPasswords', () => {
  it('needs all three, a long enough new one, different from the current, typed twice', () => {
    expect(checkPasswords({ current: '', next: '', confirm: '' })).toEqual({ current: 'Enter your current password.', next: 'Choose a new password.' })
    expect(checkPasswords({ current: OLD, next: OLD, confirm: OLD }).next).toMatch(/different/)
    expect(checkPasswords({ current: OLD, next: 'x'.repeat(129), confirm: 'x'.repeat(129) }).next).toMatch(/at most 128/)
    expect(checkPasswords({ current: OLD, next: NEW, confirm: NEW })).toEqual({})
  })
})
