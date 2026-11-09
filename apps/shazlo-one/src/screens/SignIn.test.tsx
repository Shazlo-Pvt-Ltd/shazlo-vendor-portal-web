import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '../test/render'

const fill = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('A-01 Sign in to Shazlo One', () => {
  it('asks for the email and password before calling identity-api', async () => {
    renderRoute('/sign-in')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your work email.')).toBeTruthy()
    expect(screen.getByText('Enter your password.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Work email'))
  })

  it('shows one message for a wrong password with the attempts left, then pauses after 5 tries', async () => {
    renderRoute('/sign-in')
    await screen.findByRole('heading', { name: 'Sign in to Shazlo One' })
    fill('priya@shazlo.store', 'wrong-password')
    expect((await screen.findByRole('alert')).textContent).toBe('That email and password don’t match. 4 attempts left before a 60-second wait.')
    // An unknown email gets the same wording.
    fill('nobody@shazlo.store', 'whatever')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('That email and password don’t match.'))
    for (let left = 3; left >= 1; left--) {
      fill('priya@shazlo.store', 'wrong-password')
      await screen.findByText(new RegExp(`${left} attempts? left before a 60-second wait`))
    }
    fill('priya@shazlo.store', 'wrong-password')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Sign-in is paused for 60 seconds'))
    const button = screen.getByRole('button', { name: /Try again in \d+ s/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('signs in and lands on Home', async () => {
    const { router } = renderRoute('/sign-in')
    await screen.findByRole('heading', { name: 'Sign in to Shazlo One' })
    fill('Priya@shazlo.store ', 'shazlo-one-2026')
    expect(await screen.findByRole('heading', { name: 'Home', level: 1 })).toBeTruthy()
    expect(screen.getByText('Priya Mehta · vendor_reviewer')).toBeTruthy()
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('sends signed-out visitors to sign-in and back to where they were going', async () => {
    const { router } = renderRoute('/admins')
    await screen.findByRole('heading', { name: 'Sign in to Shazlo One' })
    expect(router.state.location.search).toBe('?next=%2Fadmins')
    fill('naman@shazlo.store', 'shazlo-one-2026')
    expect(await screen.findByRole('heading', { name: 'Admins & roles', level: 1 })).toBeTruthy()
  })
})
