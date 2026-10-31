import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SceneWaitlistForm from '../src/components/SceneWaitlistForm'
import RegisterBrand from '../src/components/partner'

function fillWaitlist() {
  fireEvent.change(screen.getByPlaceholderText('your name'), { target: { value: 'Asha' } })
  fireEvent.change(screen.getByPlaceholderText('your email'), { target: { value: 'asha@example.test' } })
  fireEvent.change(screen.getByPlaceholderText('your city'), { target: { value: 'Delhi' } })
  fireEvent.mouseDown(screen.getByRole('combobox'))
  fireEvent.click(screen.getByRole('option', { name: 'Female' }))
}

describe('live waitlist form (transport mocked)', () => {
  it('does not send an incomplete registration', () => {
    render(<SceneWaitlistForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Join Waitlist' }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('submits the exact identity and shows welcome only after the server accepts it', async () => {
    let resolve
    fetch.mockReturnValue(new Promise((done) => { resolve = done }))
    render(<SceneWaitlistForm />)
    fillWaitlist()
    fireEvent.click(screen.getByRole('button', { name: 'Join Waitlist' }))
    expect(screen.getByRole('button', { name: 'Joining...' }).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Welcome' })).toBeNull()
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ name: 'Asha', email: 'asha@example.test', gender: 'Female', city: 'Delhi' })
    resolve({ ok: true })
    expect((await screen.findByRole('button', { name: 'Welcome' })).disabled).toBe(true)
  })

  it.each(['http', 'network'])('shows %s failure without claiming success, preserves fields and allows retry', async (failure) => {
    if (failure === 'http') fetch.mockResolvedValueOnce({ ok: false })
    else fetch.mockRejectedValueOnce(new Error('offline'))
    render(<SceneWaitlistForm />)
    fillWaitlist()
    fireEvent.click(screen.getByRole('button', { name: 'Join Waitlist' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/try again/i)
    expect(screen.queryByRole('button', { name: 'Welcome' })).toBeNull()
    expect(screen.getByPlaceholderText('your email').value).toBe('asha@example.test')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Join Waitlist' }).disabled).toBe(false))
    fetch.mockResolvedValueOnce({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Join Waitlist' }))
    await screen.findByRole('button', { name: 'Welcome' })
  })
})

function fillBrand() {
  for (const [label, value] of [
    ['Brand name', 'Kalki'], ["Founder's name or email ID", 'Kiran'],
    ['Website / Instagram link', 'https://example.test'], ['Contact phone', '+919876543210'], ['Contact email', 'kiran@example.test'],
  ]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('brand registration form (transport mocked)', () => {
  it('maps form fields and price bounds to the server contract and prevents a second submission', async () => {
    fetch.mockResolvedValue({ ok: true })
    render(<RegisterBrand />)
    fillBrand()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await screen.findByText('Your brand has been registered successfully.')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      brand_name: 'Kalki', founder_contact: 'Kiran', website_or_instagram: 'https://example.test',
      product_type: 'clothing', phone: '+919876543210', email: 'kiran@example.test', price_range: { min: 2500, max: 5000 },
    })
    expect(screen.getByRole('button', { name: 'Submit' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each(['http', 'network'])('shows %s failure without a false success message and permits retry', async (failure) => {
    if (failure === 'http') fetch.mockResolvedValueOnce({ ok: false })
    else fetch.mockRejectedValueOnce(new Error('offline'))
    render(<RegisterBrand />)
    fillBrand()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/try again/i)
    expect(screen.queryByText('Your brand has been registered successfully.')).toBeNull()
    expect(screen.getByLabelText('Brand name').value).toBe('Kalki')
    fetch.mockResolvedValueOnce({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await screen.findByText('Your brand has been registered successfully.')
  })
})
