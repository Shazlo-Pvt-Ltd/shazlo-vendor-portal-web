import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { DEMO_INVITE } from '../../mocks/db'
import { renderApp } from '../../test/render'
import { server } from '../../test/server'

const ROUTE = `/set-password?token=${DEMO_INVITE}`
const GOOD = 'indigo-ajrakh-26'

// The screen waits for the invite before showing the form; the first render in a file also loads the chunk.
const passwordField = () => screen.findByLabelText('New password', undefined, { timeout: 3000 })
const rules = () => within(screen.getByRole('list', { name: 'Password rules' })).getAllByRole('listitem')

describe('V-03 Set password', () => {
  it('greets the invited seller by name, email and brand', async () => {
    await renderApp({ route: ROUTE, signedIn: false })
    await passwordField()
    expect(screen.getByRole('heading', { level: 1, name: 'Set your password' })).toBeInTheDocument()
    expect(screen.getByText('Welcome, Kiran. Choose a password for kiran@kalkistudio.in to manage Kalki Studio.')).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password')
  })

  it('ticks off each rule as the seller types, with a polite count (options board pick)', async () => {
    const { user } = await renderApp({ route: ROUTE, signedIn: false })
    const password = await passwordField()
    expect(rules().map((li) => li.textContent)).toEqual(['At least 10 characters, not met', 'Not your email or brand name, not met', 'Includes a number or a symbol, not met'])
    const summary = screen.getByText('0 of 3 rules met')
    expect(summary).toHaveAttribute('role', 'status')

    await user.type(password, 'kalkistudio')
    expect(rules()[0]).toHaveTextContent('At least 10 characters, met')
    expect(rules()[0]!.querySelector('svg')).toHaveClass('lucide-circle-check')
    expect(rules()[1]).toHaveTextContent('Not your email or brand name, not met')
    expect(rules()[1]!.querySelector('svg')).toHaveClass('lucide-circle')
    expect(summary).toHaveTextContent('1 of 3 rules met')

    await user.type(password, '-2026')
    expect(rules()[2]).toHaveTextContent('Includes a number or a symbol, met')
    expect(summary).toHaveTextContent('2 of 3 rules met')

    await user.clear(password)
    await user.type(password, GOOD)
    expect(rules().map((li) => li.textContent)).toEqual(['At least 10 characters, met', 'Not your email or brand name, met', 'Includes a number or a symbol, met'])
    expect(summary).toHaveTextContent('3 of 3 rules met')
    // The rules describe the field, so they are read out with it.
    expect(password).toHaveAccessibleDescription(/At least 10 characters ?, met/)
  })

  it('counts the email as personal too', async () => {
    const { user } = await renderApp({ route: ROUTE, signedIn: false })
    await user.type(await passwordField(), 'kiran@kalkistudio.in')
    expect(rules()[1]).toHaveTextContent('Not your email or brand name, not met')
  })

  it('shows and hides the new password', async () => {
    const { user } = await renderApp({ route: ROUTE, signedIn: false })
    const password = await passwordField()
    expect(password).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password).toHaveAttribute('type', 'password')
  })

  it('asks for a password that meets every rule and focuses it', async () => {
    const { user } = await renderApp({ route: ROUTE, signedIn: false })
    await user.click(await screen.findByRole('button', { name: 'Set password and sign in' }))
    const password = screen.getByLabelText('New password')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription(/^Choose a new password\./)
    expect(password).toHaveFocus()
    expect(screen.getByLabelText('Confirm password')).toHaveAccessibleDescription('Type the same password again.')

    await user.type(password, 'short-1')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))
    expect(password).toHaveAccessibleDescription(/^Choose a password that meets all three rules\./)
  })

  it('says when the two passwords do not match', async () => {
    const { user, router } = await renderApp({ route: ROUTE, signedIn: false })
    await user.type(await passwordField(), GOOD)
    await user.type(screen.getByLabelText('Confirm password'), 'indigo-ajrakh-25')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))
    const confirm = screen.getByLabelText('Confirm password')
    expect(confirm).toHaveAccessibleDescription('The passwords do not match. Type the same password in both fields.')
    expect(confirm).toHaveFocus()
    expect(screen.getByLabelText('New password')).not.toHaveAttribute('aria-invalid', 'true')
    expect(router.state.location.pathname).toBe('/set-password')
  })

  it('sets the password, signs the seller in and lands on the overview', async () => {
    const { user, router, context, db } = await renderApp({ route: ROUTE, signedIn: false })
    await user.type(await passwordField(), GOOD)
    await user.type(screen.getByLabelText('Confirm password'), GOOD)
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(context.session.get()).not.toBeNull()
    expect(db.user.password).toBe(GOOD)
    expect(db.invites.has(DEMO_INVITE)).toBe(false)
  })

  it('explains an expired or unknown invite link and points to sign in', async () => {
    await renderApp({ route: '/set-password?token=invite-from-last-year', signedIn: false })
    expect(await screen.findByRole('heading', { level: 1, name: 'This invite link has expired' })).toBeInTheDocument()
    expect(screen.getByText(/Invite links work once and expire after 7 days\./)).toHaveTextContent(
      'Invite links work once and expire after 7 days. Email partners@shazlo.store and we will send a new one.',
    )
    expect(screen.getByRole('link', { name: 'partners@shazlo.store' })).toHaveAttribute('href', 'mailto:partners@shazlo.store')
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/sign-in')
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('treats a link without a token as expired', async () => {
    await renderApp({ route: '/set-password', signedIn: false })
    expect(await screen.findByRole('heading', { level: 1, name: 'This invite link has expired' })).toBeInTheDocument()
  })

  it('shows the expired message when the invite was used in another tab', async () => {
    const { user, db } = await renderApp({ route: ROUTE, signedIn: false })
    await user.type(await passwordField(), GOOD)
    await user.type(screen.getByLabelText('Confirm password'), GOOD)
    db.invites.delete(DEMO_INVITE)
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'This invite link has expired' })).toBeInTheDocument()
  })

  it('offers a retry when the invite cannot be checked', async () => {
    server.use(http.get('*/api/v1/vendor/auth/invites/:token', () => HttpResponse.json({ message: 'Something went wrong on our side. Try again in a moment.' }, { status: 503 }), { once: true }))
    const { user } = await renderApp({ route: ROUTE, signedIn: false })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We could not check your invite link.')
    expect(alert).toHaveTextContent('Something went wrong on our side. Try again in a moment.')
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Set your password' })).toBeInTheDocument()
  })

  it('works from the invite email while another session is signed in', async () => {
    const { router } = await renderApp({ route: ROUTE, signedIn: true })
    expect(await screen.findByRole('heading', { level: 1, name: 'Set your password' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/set-password')
  })
})
