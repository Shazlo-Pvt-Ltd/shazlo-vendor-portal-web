import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '../../test/render'
import { checkPassword } from './passwordRules'

const ruleState = () => screen.getAllByRole('listitem').map(li => `${li.textContent}:${li.getAttribute('data-met')}`)

describe('V-03 Set password (invite)', () => {
  it('shows the invite with the email read-only', async () => {
    renderRoute('/set-password?token=abc', { signedIn: false })
    expect(await screen.findByRole('heading', { name: 'Set a password to finish setting up' })).toBeTruthy()
    expect(screen.getByText('Kalki Studio is approved')).toBeTruthy()
    const email = screen.getByLabelText('Email') as HTMLInputElement
    expect(email.value).toBe('kiran@kalkistudio.in')
    expect(email.readOnly).toBe(true)
    expect(screen.getByText('Invited email · cannot be changed')).toBeTruthy()
  })

  it('ticks rules off as you type', async () => {
    renderRoute('/set-password?token=abc', { signedIn: false })
    const field = await screen.findByLabelText('New password')
    expect(ruleState().every(s => s.endsWith(':false'))).toBe(true)
    fireEvent.change(field, { target: { value: 'kiran-weaves-indigo' } })
    expect(ruleState()).toEqual([
      'At least 12 characters (done):true',
      'Not a commonly used password (done):true',
      'Does not contain your email (not yet):false',
    ])
  })

  it('rejects a short password and keeps the vendor on the page', async () => {
    const { router } = renderRoute('/set-password?token=abc', { signedIn: false })
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'short-pw' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short-pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password and continue' }))
    expect(await screen.findByText('Your password doesn’t meet all the rules below yet.')).toBeTruthy()
    expect(ruleState()[0]).toBe('At least 12 characters (not yet):false')
    expect(document.activeElement).toBe(screen.getByLabelText('New password'))
    expect(router.state.location.pathname).toBe('/set-password')
  })

  it('catches a confirmation that does not match', async () => {
    renderRoute('/set-password?token=abc', { signedIn: false })
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'block-print-ajrakh' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'block-print-ajrak' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password and continue' }))
    expect(await screen.findByText('The passwords don’t match. Type it again.')).toBeTruthy()
  })

  it('signs the vendor in and lands on the overview', async () => {
    const { router } = renderRoute('/set-password?token=abc', { signedIn: false })
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'block-print-ajrakh' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'block-print-ajrakh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password and continue' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('shows the expired state for an expired link', async () => {
    renderRoute('/set-password?token=expired', { signedIn: false })
    expect(await screen.findByRole('heading', { name: 'This invite link has expired' })).toBeTruthy()
    expect(screen.getByText('This invite link has expired. Ask partners@shazlo.store for a new one.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ask us for a new invite' }).getAttribute('href')).toMatch(/^mailto:partners@shazlo\.store/)
  })

  it('explains a link with no token', async () => {
    renderRoute('/set-password', { signedIn: false })
    expect(await screen.findByRole('heading', { name: 'This invite link is incomplete' })).toBeTruthy()
  })
})

describe('password rules', () => {
  it('flags common passwords with decorations', () => {
    expect(checkPassword('Password@2026', 'a@b.in')[1]?.met).toBe(false)
    expect(checkPassword('123456789012', 'a@b.in')[1]?.met).toBe(false)
    expect(checkPassword('kalki-studio-2026', 'kiran@kalkistudio.in').every(r => r.met)).toBe(true)
  })
})
