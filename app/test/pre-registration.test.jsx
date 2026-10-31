import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PreRegisterButton from '../src/components/PreRegisterButton'
import { preRegisterAPI } from '../src/services/api'

beforeEach(() => vi.spyOn(preRegisterAPI, 'register').mockResolvedValue({ success: true }))

function openForm() {
  render(<PreRegisterButton />)
  fireEvent.click(screen.getByRole('button', { name: 'Pre-Register Now' }))
}

function fillIdentity() {
  fireEvent.change(screen.getByLabelText(/Email Address/), { target: { value: 'asha@example.test' } })
  fireEvent.change(screen.getByLabelText(/Full Name/), { target: { value: 'Asha' } })
}

describe('pre-registration dialog (API boundary mocked; route is currently unmounted)', () => {
  it('rejects an empty form and clears field errors as the user corrects them', async () => {
    openForm()
    fireEvent.click(screen.getByRole('button', { name: /^pre-register$/i }))
    expect(screen.getByText('Email is required')).toBeTruthy()
    expect(screen.getByText('Name must be at least 2 characters long')).toBeTruthy()
    expect(preRegisterAPI.register).not.toHaveBeenCalled()
    fillIdentity()
    expect(screen.queryByText('Email is required')).toBeNull()
  })

  it.each([
    ['Email Address', 'not-an-email', 'Please enter a valid email address'],
    ['Full Name', ' ', 'Name must be at least 2 characters long'],
    ['Phone Number', 'letters', 'Please enter a valid phone number'],
  ])('rejects invalid %s without making a request', (field, value, message) => {
    openForm()
    fillIdentity()
    fireEvent.change(screen.getByLabelText(new RegExp(field)), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: /^pre-register$/i }))
    expect(screen.getByText(message)).toBeTruthy()
    expect(preRegisterAPI.register).not.toHaveBeenCalled()
  })

  it('submits selected interests and strips phone whitespace, then shows confirmation', async () => {
    openForm()
    fillIdentity()
    fireEvent.change(screen.getByLabelText(/Phone Number/), { target: { value: '+91 9876543210' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fashion', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: /^pre-register$/i }))
    await screen.findByText('Registration Successful!')
    expect(preRegisterAPI.register).toHaveBeenCalledExactlyOnceWith({
      email: 'asha@example.test', name: 'Asha', phone: '+919876543210', interests: ['fashion'],
      referralSource: 'other', notificationPreferences: { email: true, sms: false },
    })
  })

  it('prevents duplicate submissions while the request is pending', async () => {
    let resolve
    preRegisterAPI.register.mockReturnValue(new Promise((done) => { resolve = done }))
    openForm()
    fillIdentity()
    fireEvent.click(screen.getByRole('button', { name: /^pre-register$/i }))
    const pending = screen.getByRole('button', { name: /registering/i })
    expect(pending.disabled).toBe(true)
    fireEvent.click(pending)
    expect(preRegisterAPI.register).toHaveBeenCalledOnce()
    resolve({ success: true })
    await screen.findByText('Registration Successful!')
  })

  it('shows server errors, preserves input and supports a successful retry', async () => {
    preRegisterAPI.register.mockRejectedValueOnce({ response: { data: { message: 'Email already registered' } } })
    openForm()
    fillIdentity()
    fireEvent.click(screen.getByRole('button', { name: /^pre-register$/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('Email already registered')
    expect(screen.getByLabelText(/Email Address/).value).toBe('asha@example.test')
    await waitFor(() => expect(screen.getByRole('button', { name: /^pre-register$/i }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: /^pre-register$/i }))
    await screen.findByText('Registration Successful!')
  })
})
