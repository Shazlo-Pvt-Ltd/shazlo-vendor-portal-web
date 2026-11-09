import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DEMO_PASSWORD } from '../../api/fixtures'
import { renderRoute } from '../../test/render'
import { MAX_TRIES } from './SignIn'

async function fillAndSubmit(email: string, password: string) {
  fireEvent.change(await screen.findByLabelText('Work email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('V-01 Sign in', () => {
  it('shows the wireframe copy', async () => {
    renderRoute('/sign-in', { signedIn: false })
    expect(await screen.findByRole('heading', { name: 'Sign in to your seller account' })).toBeTruthy()
    expect(screen.getByText('Manage your brand page, products and review status.')).toBeTruthy()
    expect(screen.getByLabelText('Keep me signed in on this device')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Apply to sell' }).getAttribute('href')).toBe('/apply')
    expect(screen.getByRole('link', { name: 'Seller terms (opens in a new tab)' })).toBeTruthy()
  })

  it('signs in and lands on the overview', async () => {
    const { router } = renderRoute('/sign-in', { signedIn: false })
    await fillAndSubmit('kiran@kalkistudio.in', DEMO_PASSWORD)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('returns to the page in ?next after signing in', async () => {
    const { router } = renderRoute('/sign-in?next=%2Fproducts', { signedIn: false })
    await fillAndSubmit('Kiran@KalkiStudio.in ', DEMO_PASSWORD)
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
  })

  it('ignores an off-site ?next', async () => {
    const { router } = renderRoute('/sign-in?next=%2F%2Fevil.example', { signedIn: false })
    await fillAndSubmit('kiran@kalkistudio.in', DEMO_PASSWORD)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('sends someone already signed in to the overview', async () => {
    const { router } = renderRoute('/sign-in', { signedIn: true })
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('shows the same error for a wrong password and an unknown email', async () => {
    renderRoute('/sign-in', { signedIn: false })
    await fillAndSubmit('kiran@kalkistudio.in', 'wrong-password')
    const wrongPassword = (await screen.findByRole('alert')).textContent
    expect(wrongPassword).toContain('That email and password don’t match.')
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')

    await fillAndSubmit('nobody@example.com', 'whatever-it-is')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' }).hasAttribute('disabled')).toBe(false))
    expect(screen.getByRole('alert').textContent).toBe(wrongPassword)
  })

  it('cools the button down for 60 s after 5 failed tries', async () => {
    renderRoute('/sign-in', { signedIn: false })
    for (let i = 0; i < MAX_TRIES; i++) {
      await fillAndSubmit('kiran@kalkistudio.in', `wrong-${i}`)
      if (i < MAX_TRIES - 1) await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' }).hasAttribute('disabled')).toBe(false))
    }
    const button = await screen.findByRole('button', { name: /Try again in 60 s/ })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('Too many tries')
  })

  it('asks for both fields before calling the API', async () => {
    renderRoute('/sign-in', { signedIn: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your work email.')).toBeTruthy()
    expect(screen.getByText('Enter your password.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Work email'))
  })

  it('confirms a reset link without saying whether the account exists', async () => {
    renderRoute('/sign-in', { signedIn: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }))
    fireEvent.change(await screen.findByLabelText('Work email'), { target: { value: 'someone@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy()
    expect(screen.getByText(/If there’s a seller account for/).textContent).toContain('someone@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(await screen.findByRole('heading', { name: 'Sign in to your seller account' })).toBeTruthy()
  })
})
