import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderShell } from '../test/render'
import { server } from '../test/server'

const NOW = new Date('2026-11-09T14:00:00+05:30')
const TEMP = 'welcome-sneha-01'
const NEW = 'indigo-loom-2026'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

async function open() {
  const view = await renderShell({ route: '/', as: 'sneha' })
  await screen.findByRole('heading', { level: 1, name: 'Choose your own password' })
  return view
}

const field = (label: string) => screen.getByLabelText(label, { selector: 'input' })
const rule = (text: string) => within(screen.getByRole('list', { name: 'Password rules' })).getByText(text).closest('li')!

describe('Change password', () => {
  it('opens after signing in with a temporary password, on its own page', async () => {
    const { router } = await open()
    expect(router.state.location.pathname).toBe('/change-password')
    expect(screen.getByText(/Welcome, Sneha\. You signed in with a temporary password/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Shazlo One sections' })).toBeNull()
    expect(screen.getByRole('img', { name: /Shazlo/ })).toBeInTheDocument()
  })

  it('ticks the rules off as the new password is typed', async () => {
    const { user } = await open()
    expect(rule('At least 12 characters')).toHaveTextContent('not yet')
    expect(rule('Different from the temporary password')).toHaveTextContent('not yet')
    await user.type(field('Temporary password'), TEMP)
    await user.type(field('New password'), 'short')
    expect(rule('At least 12 characters')).toHaveTextContent('not yet')
    expect(rule('Different from the temporary password')).toHaveTextContent('done')
    await user.clear(field('New password'))
    await user.type(field('New password'), TEMP)
    expect(rule('At least 12 characters')).toHaveTextContent('done')
    expect(rule('Different from the temporary password')).toHaveTextContent('not yet')
    await user.clear(field('New password'))
    await user.type(field('New password'), NEW)
    expect(rule('At least 12 characters')).toHaveTextContent('done')
    expect(rule('Different from the temporary password')).toHaveTextContent('done')
    expect(screen.getByText('2 of 2 password rules met')).toBeInTheDocument()
  })

  it('saves the new password and lands on Home', async () => {
    const { user, router, identityDb } = await open()
    await user.type(field('Temporary password'), TEMP)
    await user.type(field('New password'), NEW)
    await user.type(field('Confirm new password'), NEW)
    await user.click(screen.getByRole('button', { name: 'Save password and continue' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Good afternoon, Sneha' })).toBeInTheDocument()
    expect(await screen.findByText('Password saved')).toBeInTheDocument()
    const sneha = identityDb.admins.find((a) => a.id === 'a_sneha')!
    expect(sneha).toMatchObject({ must_change_password: false, password: NEW })
  })

  it('checks the fields before sending', async () => {
    const { user, identityDb } = await open()
    await user.click(screen.getByRole('button', { name: 'Save password and continue' }))
    expect(await screen.findByText('Enter the temporary password you signed in with.')).toBeInTheDocument()
    expect(field('Temporary password')).toHaveFocus()
    await user.type(field('Temporary password'), TEMP)
    await user.type(field('New password'), 'short-pw')
    await user.type(field('Confirm new password'), 'short-pw')
    await user.click(screen.getByRole('button', { name: 'Save password and continue' }))
    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument()
    expect(field('New password')).toHaveAttribute('aria-invalid', 'true')
    expect(field('New password')).toHaveFocus()
    await user.clear(field('New password'))
    await user.type(field('New password'), NEW)
    await user.click(screen.getByRole('button', { name: 'Save password and continue' }))
    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument()
    expect(identityDb.admins.find((a) => a.id === 'a_sneha')!.password).toBe(TEMP)
  })

  it('puts a wrong temporary password on its field', async () => {
    const { user, router } = await open()
    await user.type(field('Temporary password'), 'welcome-sneha-99')
    await user.type(field('New password'), NEW)
    await user.type(field('Confirm new password'), NEW)
    await user.click(screen.getByRole('button', { name: 'Save password and continue' }))
    await waitFor(() => expect(field('Temporary password')).toHaveAccessibleDescription('This is not your current password.'))
    expect(field('Temporary password')).toHaveFocus()
    expect(router.state.location.pathname).toBe('/change-password')
  })

  it('puts the API answer about the new password on its field', async () => {
    server.use(http.post('*/v1/auth/change-password', () => HttpResponse.json({ message: 'Choose a longer password.', extra: { code: 'validation_error', fields: { new_password: 'This password is on a list of common passwords.' } } }, { status: 422 })))
    const { user } = await open()
    await user.type(field('Temporary password'), TEMP)
    await user.type(field('New password'), NEW)
    await user.type(field('Confirm new password'), NEW)
    await user.click(screen.getByRole('button', { name: 'Save password and continue' }))
    await waitFor(() => expect(field('New password')).toHaveAccessibleDescription(expect.stringContaining('This password is on a list of common passwords.')))
    expect(field('New password')).toHaveFocus()
  })
})
