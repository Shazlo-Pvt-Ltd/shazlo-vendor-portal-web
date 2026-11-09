import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { DEMO_LOGIN } from '../../mocks/db'
import { renderApp } from '../../test/render'
import { server } from '../../test/server'

describe('Forgot password', () => {
  it('asks for the work email', async () => {
    await renderApp({ route: '/forgot-password', signedIn: false })
    expect(await screen.findByRole('heading', { level: 1, name: 'Reset your password' })).toBeInTheDocument()
    expect(screen.getByLabelText('Work email')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/sign-in')
  })

  it('checks the email before sending and focuses it', async () => {
    const { user } = await renderApp({ route: '/forgot-password', signedIn: false })
    await user.click(await screen.findByRole('button', { name: 'Send reset link' }))
    const email = screen.getByLabelText('Work email')
    expect(email).toHaveAccessibleDescription('Enter your work email.')
    expect(email).toHaveFocus()
    await user.type(email, 'kiran@')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(email).toHaveAccessibleDescription('Enter an email like name@brand.in.')
    expect(screen.queryByRole('heading', { name: 'Check your email' })).toBeNull()
  })

  it.each([
    ['a seller with an account', DEMO_LOGIN.identifier],
    ['an email with no account', 'someone@elsewhere.in'],
  ])('gives %s the same answer, so it never reveals who has an account', async (_who, address) => {
    const { user } = await renderApp({ route: '/forgot-password', signedIn: false })
    await user.type(await screen.findByLabelText('Work email'), address)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    const title = await screen.findByRole('heading', { level: 1, name: 'Check your email' })
    expect(document.activeElement).toContainElement(title)
    expect(screen.getByText(`If an account exists for ${address}, we have sent a link to reset your password. It expires in 30 minutes.`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/sign-in')
    expect(screen.queryByLabelText('Work email')).toBeNull()
  })

  it('keeps the form when the request does not go through', async () => {
    server.use(http.post('*/api/v1/vendor/auth/password/forgot', () => HttpResponse.error(), { once: true }))
    const { user } = await renderApp({ route: '/forgot-password', signedIn: false })
    await user.type(await screen.findByLabelText('Work email'), DEMO_LOGIN.identifier)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You seem to be offline. Check your connection and try again.')
    expect(screen.getByLabelText('Work email')).toHaveValue(DEMO_LOGIN.identifier)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument()
  })
})
