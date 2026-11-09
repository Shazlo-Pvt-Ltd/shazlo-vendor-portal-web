import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '../../test/render'

function fillValidForm(email = 'hello@indigoloom.in') {
  fireEvent.change(screen.getByLabelText('Brand name'), { target: { value: 'Indigo Loom' } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Ahmedabad' } })
  fireEvent.change(screen.getByLabelText('Instagram or website'), { target: { value: 'instagram.com/indigo.loom' } })
  fireEvent.click(screen.getByLabelText('What do you sell?'))
  const group = screen.getByRole('group', { name: 'Product types' })
  fireEvent.click(within(group).getByLabelText('Kurtas'))
  fireEvent.click(within(group).getByLabelText('Co-ords'))
  fireEvent.click(within(group).getByRole('button', { name: 'Done' }))
  fireEvent.change(screen.getByLabelText('Owner name'), { target: { value: 'Meera Patel' } })
  fireEvent.change(screen.getByLabelText('Phone (WhatsApp)'), { target: { value: '+91 98250 41376' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.click(screen.getByLabelText('I agree to the seller terms and a 15% commission per sale'))
}

describe('V-02 Apply to sell', () => {
  it('shows the form, steps and commercial terms', async () => {
    renderRoute('/apply', { signedIn: false })
    expect(await screen.findByRole('heading', { name: 'Apply to sell on Shazlo' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'How selling on Shazlo works' })).toBeTruthy()
    expect(screen.getByText('15% per delivered order')).toBeTruthy()
    expect(screen.getByText('₹1,200')).toBeTruthy()
    expect(screen.getByText('₹4,500')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in')
  })

  it('blocks an empty submit and focuses the first error', async () => {
    renderRoute('/apply', { signedIn: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Submit application' }))
    expect(await screen.findByText('Enter your brand name.')).toBeTruthy()
    expect(screen.getByText('Choose at least one thing you sell.')).toBeTruthy()
    expect(screen.getByText('Agree to the seller terms to send your application.')).toBeTruthy()
    const brand = screen.getByLabelText('Brand name')
    expect(brand.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(brand)
    expect(screen.queryByText('We’ll reply within 2 working days')).toBeNull()
  })

  it('shows the duplicate email inline on the email field', async () => {
    renderRoute('/apply', { signedIn: false })
    await screen.findByRole('heading', { name: 'Apply to sell on Shazlo' })
    fillValidForm('kiran@kalkistudio.in')
    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }))
    expect(await screen.findByText('There is already a seller account for this email. Sign in instead.')).toBeTruthy()
    const email = screen.getByLabelText('Email')
    expect(email.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(email)
  })

  it('confirms the application and says what happens next', async () => {
    renderRoute('/apply', { signedIn: false })
    await screen.findByRole('heading', { name: 'Apply to sell on Shazlo' })
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }))
    expect(await screen.findByRole('heading', { name: 'We’ll reply within 2 working days' })).toBeTruthy()
    expect(screen.getByText(/We’ve sent a receipt to hello@indigoloom.in/)).toBeTruthy()
    expect(screen.getByText(/APP-\d{5}/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'What happens next' })).toBeTruthy()
  })
})
