import { screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEMO_LOGIN } from '../../mocks/db'
import { renderApp } from '../../test/render'

async function fill(user: Awaited<ReturnType<typeof renderApp>>['user'], email: string, password: string) {
  await user.type(await screen.findByLabelText('Work email'), email)
  await user.type(screen.getByLabelText('Password'), password)
}

// The screen is lazy-loaded; transform it once before the first test, which a slow machine can time out.
beforeAll(async () => {
  await import('./SignIn')
}, 60_000)

describe('V-01 Sign in', () => {
  it('pairs the form with reasons to sell on desktop (options board pick C)', async () => {
    await renderApp({ route: '/sign-in', signedIn: false })
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to your seller account' }, { timeout: 8000 })).toBeInTheDocument()
    const why = screen.getByRole('complementary', { name: 'Why sell on Shazlo' })
    expect(within(why).getAllByRole('listitem')).toHaveLength(3)
    // Commission is agreed per brand (spec §6): no fixed rate anywhere.
    expect(within(why).getByRole('heading', { name: 'Commission agreed with each brand. No listing fees.' })).toBeInTheDocument()
    expect(why).not.toHaveTextContent('%')
    expect(screen.getByRole('link', { name: 'Apply to sell' })).toHaveAttribute('href', '/apply')
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
  })

  it('drops the reasons panel on phones', async () => {
    await renderApp({ route: '/sign-in', signedIn: false, viewport: 'mobile' })
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('complementary', { name: 'Why sell on Shazlo' })).toBeNull()
  })

  it('checks the fields before calling the API and focuses the first problem', async () => {
    const { user } = await renderApp({ route: '/sign-in', signedIn: false })
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))
    const email = screen.getByLabelText('Work email')
    expect(email).toHaveAccessibleDescription('Enter your work email.')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveFocus()
    await user.type(email, 'kiran@')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(email).toHaveAccessibleDescription('Enter an email like name@brand.in.')
  })

  it('explains a wrong password without saying which part was wrong', async () => {
    const { user, router } = await renderApp({ route: '/sign-in', signedIn: false })
    await fill(user, DEMO_LOGIN.identifier, 'not-the-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That email and password do not match.')
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('signs in and returns to the page the seller asked for', async () => {
    const { user, router, context, db } = await renderApp({ route: '/sign-in?next=%2Freview', signedIn: false })
    await fill(user, DEMO_LOGIN.identifier, DEMO_LOGIN.password)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/review'))
    // The access token stays in memory and the refresh token in the (modelled) HttpOnly cookie.
    expect(context.session.get()).not.toBeNull()
    expect(db.sessions.cookie).not.toBeNull()
    expect(localStorage.getItem('shazlo.seller.session')).toBeNull()
    expect(sessionStorage.getItem('shazlo.seller.session')).toBeNull()
  })

  it('has no "Keep me signed in" option: the refresh cookie keeps the session', async () => {
    await renderApp({ route: '/sign-in', signedIn: false })
    await screen.findByRole('button', { name: 'Sign in' })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText(/keep me signed in/i)).toBeNull()
  })

  it('never follows a next link to another site', async () => {
    const { user, router } = await renderApp({ route: '/sign-in?next=%2F%2Fevil.example', signedIn: false })
    await fill(user, DEMO_LOGIN.identifier, DEMO_LOGIN.password)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('sends a signed-in seller straight to the overview', async () => {
    const { router } = await renderApp({ route: '/sign-in' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})
