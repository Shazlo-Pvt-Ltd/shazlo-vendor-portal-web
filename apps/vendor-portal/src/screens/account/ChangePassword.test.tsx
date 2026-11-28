import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEMO_LOGIN } from '../../mocks/db'
import { clearSensitiveState } from '../../security/sensitiveState'
import { SESSION_CHANNEL } from '../../session/store'
import { renderApp, type Viewport } from '../../test/render'
import { setupMockApi } from '../../test/server'
import { typeFast } from '../../test/typeFast'

const { server, db } = setupMockApi()
const SLOW = { timeout: 8000 }
const NEW = 'a brand new passphrase'

beforeAll(async () => {
  await import('./ChangePassword')
})

async function open(viewport: Viewport = 'desktop') {
  const view = await renderApp({ route: '/account/password', viewport })
  expect(await screen.findByRole('heading', { level: 1, name: 'Change password' }, SLOW)).toBeInTheDocument()
  return view
}

const field = (label: string) => screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement

async function fill(user: Awaited<ReturnType<typeof renderApp>>['user'], current = DEMO_LOGIN.password, next = NEW, confirm = next) {
  for (const [label, value] of [['Current password', current], ['New password', next], ['New password again', confirm]] as const) {
    await user.clear(field(label))
    if (value) await typeFast(user, field(label), value)
  }
  await user.click(screen.getByRole('button', { name: 'Change password' }))
}

function count() {
  const bodies: unknown[] = []
  server.use(
    http.post('*/v1/auth/change-password', async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

describe('Change password', () => {
  it('has the fields a password manager needs, and one yellow button', async () => {
    await open()
    expect(field('Current password')).toHaveAttribute('autocomplete', 'current-password')
    expect(field('New password')).toHaveAttribute('autocomplete', 'new-password')
    expect(field('New password again')).toHaveAttribute('autocomplete', 'new-password')
    // The account the password belongs to, for the password manager.
    expect(document.querySelector('input[autocomplete="username"]')).toHaveValue(DEMO_LOGIN.email)
    expect(screen.getByRole('main').querySelectorAll('.MuiButton-contained')).toHaveLength(1)
  })

  it('changes it, takes the new session, clears the form and says so in the page', async () => {
    const bodies = count()
    const { user, router } = await open()
    const kiran = db().users.find((u) => u.email === DEMO_LOGIN.email)!
    await fill(user)
    expect(await screen.findByRole('status')).toHaveTextContent('Your password is changed. You are signed out on your other phones and computers.')
    expect(bodies).toEqual([{ current_password: DEMO_LOGIN.password, new_password: NEW }])
    expect(kiran.password).toBe(NEW)
    expect(field('Current password')).toHaveValue('')
    expect(field('New password')).toHaveValue('')
    // Still signed in with the new session: other pages load.
    await act(() => router.navigate('/account'))
    expect(await screen.findByRole('region', { name: 'Your details' }, SLOW)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/account')
  })

  it('still works when the access token ran out while the page was open (a laptop woke from sleep)', async () => {
    const { user } = await open()
    // Every access token expires; the refresh cookie still holds.
    db().sessions.access.clear()
    await fill(user)
    expect(await screen.findByRole('status')).toHaveTextContent('Your password is changed.')
    expect(db().users.find((u) => u.email === DEMO_LOGIN.email)?.password).toBe(NEW)
  })

  it('checks the passwords before sending, and focuses the first problem', async () => {
    const bodies = count()
    const { user } = await open()
    await fill(user, '', '', '')
    expect(field('Current password')).toHaveAccessibleDescription('Enter your current password.')
    expect(field('Current password')).toHaveFocus()
    await fill(user, DEMO_LOGIN.password, 'short', 'short')
    expect(field('New password')).toHaveAccessibleDescription('Use at least 12 characters.')
    expect(field('New password')).toHaveFocus()
    await fill(user, DEMO_LOGIN.password, DEMO_LOGIN.email, DEMO_LOGIN.email)
    expect(field('New password')).toHaveAccessibleDescription('Your password cannot be your email address.')
    await fill(user, DEMO_LOGIN.password, NEW, 'something else')
    expect(field('New password again')).toHaveAccessibleDescription('The new passwords do not match. Type the same password in both fields.')
    expect(field('New password again')).toHaveFocus()
    expect(bodies).toEqual([])
  })

  it('puts a wrong current password on that field, and keeps the new one', async () => {
    const { user } = await open()
    await fill(user, 'not-my-password')
    await waitFor(() => expect(field('Current password')).toHaveAccessibleDescription('This is not your current password.'))
    expect(field('Current password')).toHaveFocus()
    expect(field('Current password')).toHaveValue('')
    expect(field('New password')).toHaveValue(NEW)
  })

  it("puts the API's password refusal on the new password", async () => {
    db().faults.push({ path: '/v1/auth/change-password', status: 422, code: 'weak_password', message: 'This password is too common' })
    const { user } = await open()
    await fill(user)
    await waitFor(() => expect(field('New password')).toHaveAccessibleDescription('This password is too common'))
    expect(field('New password')).toHaveFocus()
  })

  it('counts down after too many attempts', async () => {
    server.use(http.post('*/v1/auth/change-password', () => HttpResponse.json({ error: { code: 'rate_limited', message: 'x' } }, { status: 429, headers: { 'Retry-After': '30' } }), { once: true }))
    const { user } = await open()
    await fill(user)
    expect(await screen.findByText(/Too many attempts. Try again in (30|29) s\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
  })

  it('keeps the form when the network fails, and changes it on the next try', async () => {
    db().faults.push({ path: '/v1/auth/change-password', network: true })
    const { user } = await open()
    await fill(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(field('New password')).toHaveValue(NEW)
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Your password is changed.')
  })

  it('sends once on a double click, and keeps no copy of the passwords in the query cache', async () => {
    const bodies = count()
    const { user, queryClient } = await open()
    await typeFast(user, field('Current password'), DEMO_LOGIN.password)
    await typeFast(user, field('New password'), NEW)
    await typeFast(user, field('New password again'), NEW)
    await user.dblClick(screen.getByRole('button', { name: 'Change password' }))
    await screen.findByRole('status')
    expect(bodies).toHaveLength(1)
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
  })

  it('forgets what was typed when the session ends', async () => {
    const { user } = await open()
    await typeFast(user, field('Current password'), DEMO_LOGIN.password)
    await typeFast(user, field('New password'), NEW)
    act(() => clearSensitiveState())
    await waitFor(() => expect(field('Current password')).toHaveValue(''))
    expect(field('New password')).toHaveValue('')
  })

  it('drops what was typed and goes to sign in when the seller signs out in another tab', async () => {
    const { user, router } = await open()
    await typeFast(user, field('Current password'), DEMO_LOGIN.password)
    await typeFast(user, field('New password'), NEW)
    const otherTab = new BroadcastChannel(SESSION_CHANNEL)
    otherTab.postMessage({ type: 'logout' })
    otherTab.close()
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(document.body.innerHTML).not.toContain(NEW)
    expect(document.body.innerHTML).not.toContain(DEMO_LOGIN.password)
  })

  it('fits a 390 px phone and leads back to Account', async () => {
    const { container } = await open('mobile')
    expect(await within(await screen.findByRole('banner')).findByRole('link', { name: 'Back to Account' })).toHaveAttribute('href', '/account')
    for (const el of container.querySelectorAll('*')) {
      const { width, minWidth } = getComputedStyle(el)
      for (const value of [width, minWidth]) if (value.endsWith('px')) expect(parseFloat(value), `${el.className} is ${value} wide`).toBeLessThanOrEqual(358)
    }
  })
})
