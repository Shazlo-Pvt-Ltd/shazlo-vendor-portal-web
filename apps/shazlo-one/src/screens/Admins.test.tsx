import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '../test/render'

const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

describe('A-11 Admins & roles', () => {
  it('lists admins with roles, last sign-in and status', async () => {
    renderRoute('/admins', { as: 'super' })
    expect(await screen.findByRole('heading', { name: 'Admins & roles', level: 1 })).toBeTruthy()
    await screen.findByText('Priya Mehta')
    expect(screen.getByText('5 people · roles decide which modules each person sees and what they can do')).toBeTruthy()
    expect(within(row('Sneha Iyer')).getByText('Invite sent')).toBeTruthy()
    expect(within(row('Sneha Iyer')).getByText('—')).toBeTruthy()
    expect(within(row('Kabir Shah')).getByText('Deactivated')).toBeTruthy()
    expect(within(row('Priya Mehta')).getByText('Today, 10:30')).toBeTruthy()
    expect(screen.getByText('Tokens for: vendor-api, identity-api')).toBeTruthy()
    expect(screen.getByText('Deactivating someone ends all their sessions at once')).toBeTruthy()
  })

  it('invites an admin after validating the form', async () => {
    renderRoute('/admins', { as: 'super' })
    await screen.findByText('Priya Mehta')
    fireEvent.click(screen.getByRole('button', { name: 'Invite admin' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }))
    expect(await within(dialog).findByText('Enter their full name.')).toBeTruthy()
    expect(within(dialog).getByText('Enter their work email.')).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText('Full name'), { target: { value: 'Meera Joshi' } })
    fireEvent.change(within(dialog).getByLabelText('Work email'), { target: { value: 'priya@shazlo.store' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }))
    expect(await within(dialog).findByText('An admin with this email already exists.')).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText('Work email'), { target: { value: 'meera@shazlo.store' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }))
    expect(await screen.findByText('Invite sent to meera@shazlo.store')).toBeTruthy()
    await screen.findByText('Meera Joshi')
    expect(within(row('Meera Joshi')).getByText('Invite sent')).toBeTruthy()
    expect(screen.getByText(/^6 people/)).toBeTruthy()
  })

  it('will not deactivate the last super_admin', async () => {
    renderRoute('/admins', { as: 'super' })
    await screen.findByText('Priya Mehta')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Naman Sinha' }))
    const menu = await screen.findByRole('menu')
    const deactivate = within(menu).getByRole('menuitem', { name: 'Deactivate' }) as HTMLButtonElement
    expect(deactivate.disabled).toBe(true)
    expect(within(menu).getByText('You can’t deactivate the last super_admin. Make someone else super_admin first.')).toBeTruthy()
  })

  it('deactivates someone after confirming, and can reactivate them', async () => {
    renderRoute('/admins', { as: 'super' })
    await screen.findByText('Priya Mehta')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Priya Mehta' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Priya Mehta?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(within(row('Priya Mehta')).getByText('Deactivated')).toBeTruthy())

    // The dialog's exit transition keeps the page aria-hidden for a moment.
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Priya Mehta' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Reactivate' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Reactivate Priya Mehta?' })).getByRole('button', { name: 'Reactivate' }))
    await waitFor(() => expect(within(row('Priya Mehta')).getByText('Active')).toBeTruthy())
  })

  it('keeps super_admin on the last super_admin when editing roles', async () => {
    renderRoute('/admins', { as: 'super' })
    await screen.findByText('Priya Mehta')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Naman Sinha' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Edit roles' }))
    const dialog = await screen.findByRole('dialog', { name: 'Roles for Naman Sinha' })
    expect((within(dialog).getByRole('checkbox', { name: 'super_admin' }) as HTMLInputElement).disabled).toBe(true)
  })
})
