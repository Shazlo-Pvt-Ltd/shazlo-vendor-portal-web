import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderShell } from '../test/render'
import { server } from '../test/server'

// Monday 9 Nov 2026, 14:00 IST. The identity seed is built relative to it.
const NOW = new Date('2026-11-09T14:00:00+05:30')
const TEMP = /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

async function openAdmins(as: 'naman' | 'priya' = 'naman') {
  const view = await renderShell({ route: '/admins', as })
  await screen.findByRole('heading', { level: 1, name: 'Admins & roles' })
  await screen.findByRole('cell', { name: /Naman Sinha/ })
  return view
}

const table = () => screen.getByRole('table', { name: 'Admins' })
const bodyRows = () => within(table()).getAllByRole('row').slice(1)
const rowOf = (name: string) => within(table()).getByText(name).closest('tr') as HTMLElement
const names = () => bodyRows().map((r) => within(r).getAllByRole('cell')[0]!.textContent)

async function choose(user: UserEvent, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

async function menu(user: UserEvent, name: string, item: string) {
  await user.click(within(rowOf(name)).getByRole('button', { name: `Actions for ${name}` }))
  await user.click(await screen.findByRole('menuitem', { name: new RegExp(`^${item}`) }))
}

describe('A-11 Admins: page and table', () => {
  it('lists every admin with roles, status and last sign-in', async () => {
    const { user } = await openAdmins()
    expect(screen.getByText('Everyone who can sign in to Shazlo One, and what each person can do.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite admin' })).toBeInTheDocument()
    // Active admins by default.
    expect(bodyRows()).toHaveLength(4)
    await choose(user, 'Status', 'All')
    await waitFor(() => expect(bodyRows()).toHaveLength(5))
    const expected = [
      ['Naman Sinha', 'naman@shazlo.store', ['Super admin'], 'live', 'Active', 'Just now'],
      ['Priya Mehta', 'priya@shazlo.store', ['Vendor reviewer'], 'live', 'Active', '1 h ago'],
      ['Rahul Desai', 'rahul@shazlo.store', ['Vendor reviewer'], 'live', 'Active', 'Yesterday'],
      ['Sneha Iyer', 'sneha@shazlo.store', ['Vendor reviewer'], 'pending', 'Invited · password not set', 'Never'],
      ['Kabir Shah', 'kabir@shazlo.store', ['Vendor reviewer'], 'archived', 'Deactivated', '2 Oct'],
    ] as const
    for (const [name, email, roles, status, label, last] of expected) {
      const row = rowOf(name)
      expect(row).toHaveTextContent(email)
      for (const role of roles) expect(within(row).getByText(role)).toBeInTheDocument()
      const pill = row.querySelector('[data-status]')
      expect(pill).toHaveAttribute('data-status', status)
      expect(pill).toHaveTextContent(label)
      expect(row).toHaveTextContent(last)
      expect(within(row).getByRole('button', { name: `Actions for ${name}` })).toBeInTheDocument()
    }
  })

  it('describes each role with how many active people hold it', async () => {
    await openAdmins()
    const roles = screen.getByRole('region', { name: 'Roles' })
    const items = await within(roles).findAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Super admin')
    expect(items[0]).toHaveTextContent('Manages admins and roles')
    await waitFor(() => expect(items[0]).toHaveTextContent('1 active person'))
    expect(items[1]).toHaveTextContent('Vendor reviewer')
    await waitFor(() => expect(items[1]).toHaveTextContent('3 active people'))
  })

  it('shows reviewers that only super admins manage admins', async () => {
    await renderShell({ route: '/admins', as: 'priya' })
    expect(await screen.findByRole('heading', { name: 'Only super admins can manage admins' })).toBeInTheDocument()
  })
})

describe('A-11 Admins: hierarchy and icons', () => {
  const font = (el: HTMLElement) => {
    const style = getComputedStyle(el)
    return { family: style.fontFamily.includes('Bodoni Moda') ? 'Bodoni Moda' : style.fontFamily.includes('Ovo') ? 'Ovo' : style.fontFamily, weight: style.fontWeight }
  }
  const semibold = { family: 'Bodoni Moda', weight: '600' }
  const regular = { family: 'Ovo', weight: '400' }
  // MUI 9 may set colours through CSS variables, which jsdom leaves unresolved.
  const colour = (el: HTMLElement) => {
    const value = getComputedStyle(el).color
    const v = /^var\((--[\w-]+)\)$/.exec(value)
    return v?.[1] ? getComputedStyle(el).getPropertyValue(v[1]).trim() : value
  }
  const SECONDARY = ['rgb(122, 69, 30)', '#7A451E', '#7a451e']

  it('sets column headings, names and role names in semibold, and emails and dates in regular secondary text', async () => {
    await openAdmins()
    for (const name of ['Person', 'Roles', 'Status', 'Last sign-in']) expect(font(within(table()).getByRole('columnheader', { name })), name).toEqual(semibold)
    const row = rowOf('Naman Sinha')
    expect(font(within(row).getByText('Naman Sinha'))).toEqual(semibold)
    expect(font(within(row).getByText('Super admin'))).toEqual(semibold)
    for (const text of ['naman@shazlo.store', 'Just now']) {
      const el = within(row).getByText(text)
      const styled = el.tagName === 'TIME' ? el.parentElement! : el
      expect(font(styled), text).toEqual(regular)
      expect(SECONDARY, text).toContain(colour(styled))
    }
  })

  it('gives each role card its own icon beside a semibold role name', async () => {
    await openAdmins()
    const roles = screen.getByRole('region', { name: 'Roles' })
    expect(font(within(roles).getByRole('heading', { level: 2, name: 'Roles' }))).toEqual(semibold)
    const items = await within(roles).findAllByRole('listitem')
    const icons = ['Super admin', 'Vendor reviewer'].map((name, i) => {
      expect(font(within(items[i]!).getByRole('heading', { level: 3, name }))).toEqual(semibold)
      const icon = items[i]!.querySelector('svg')!
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('stroke-width', '1.75')
      return icon.getAttribute('class')
    })
    expect(icons[0]).not.toBe(icons[1])
  })

  it('marks search, the invite button and each status with an icon', async () => {
    await openAdmins()
    const invite = screen.getByRole('button', { name: 'Invite admin' }).querySelector('svg')
    expect(invite).toHaveAttribute('aria-hidden', 'true')
    expect(invite).toHaveAttribute('stroke-width', '1.75')
    const search = screen.getByRole('textbox', { name: 'Search name or email' }).closest('.MuiInputBase-root')!.querySelector('svg')
    expect(search).toHaveAttribute('aria-hidden', 'true')
    expect(search).toHaveAttribute('stroke-width', '1.75')
    for (const row of bodyRows()) expect(row.querySelector('[data-status] svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('A-11 Admins: filters', () => {
  it('searches by name or email after typing stops', async () => {
    const { user } = await openAdmins()
    await user.type(screen.getByRole('textbox', { name: 'Search name or email' }), 'rahul@')
    await waitFor(() => expect(names()).toEqual([expect.stringContaining('Rahul Desai')]))
    await user.clear(screen.getByRole('textbox', { name: 'Search name or email' }))
    await user.type(screen.getByRole('textbox', { name: 'Search name or email' }), 'zzz')
    expect(await screen.findByRole('heading', { name: 'No admins match these filters' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(bodyRows()).toHaveLength(4))
  })

  it('filters by role and by status', async () => {
    const { user } = await openAdmins()
    await choose(user, 'Role', 'Super admin')
    await waitFor(() => expect(names()).toEqual([expect.stringContaining('Naman Sinha')]))
    await choose(user, 'Role', 'All roles')
    await choose(user, 'Status', 'Deactivated')
    await waitFor(() => expect(names()).toEqual([expect.stringContaining('Kabir Shah')]))
  })
})

describe('A-11 Admins: invite', () => {
  it('creates an admin with a temporary password and shows the details to send', async () => {
    const { user, identityDb } = await openAdmins()
    await user.click(screen.getByRole('button', { name: 'Invite admin' }))
    const dialog = await screen.findByRole('dialog', { name: 'Invite an admin' })
    const password = within(dialog).getByLabelText('Temporary password') as HTMLInputElement
    expect(password.value).toMatch(TEMP)
    expect(password).toHaveAttribute('readonly')
    const first = password.value
    await user.click(within(dialog).getByRole('button', { name: 'Generate another' }))
    expect(password.value).toMatch(TEMP)
    expect(password.value).not.toBe(first)
    await user.click(within(dialog).getByRole('button', { name: 'Copy temporary password' }))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
    await expect(navigator.clipboard.readText()).resolves.toBe(password.value)

    expect(await within(dialog).findByText('Reviews vendor applications, brand pages and products in the Vendors module.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Name'), 'Ananya Rao')
    await user.type(within(dialog).getByLabelText('Work email'), 'ananya@shazlo.store')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Vendor reviewer' }))
    const temp = password.value
    await user.click(within(dialog).getByRole('button', { name: 'Create admin' }))

    expect(await within(dialog).findByRole('heading', { name: 'Send Ananya these details' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('ananya@shazlo.store')
    expect(dialog).toHaveTextContent(temp)
    expect(dialog).toHaveTextContent('They choose their own password the first time they sign in.')
    expect(within(dialog).getByRole('button', { name: 'Copy email' })).toBeInTheDocument()
    const created = identityDb.admins.find((a) => a.email === 'ananya@shazlo.store')!
    expect(created).toMatchObject({ display_name: 'Ananya Rao', roles: ['vendor_reviewer'], must_change_password: true, password: temp })

    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const row = await within(table()).findByText('Ananya Rao')
    expect(row.closest('tr')!.querySelector('[data-status]')).toHaveTextContent('Invited · password not set')
  })

  it('checks the fields before sending', async () => {
    const { user } = await openAdmins()
    await user.click(screen.getByRole('button', { name: 'Invite admin' }))
    const dialog = await screen.findByRole('dialog', { name: 'Invite an admin' })
    await user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    expect(await within(dialog).findByText('Add their name.')).toBeInTheDocument()
    expect(within(dialog).getByText('Enter their work email.')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose at least one role.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Name')).toHaveFocus()
  })

  it('puts the duplicate-email answer on the email field', async () => {
    const { user, identityDb } = await openAdmins()
    await user.click(screen.getByRole('button', { name: 'Invite admin' }))
    const dialog = await screen.findByRole('dialog', { name: 'Invite an admin' })
    await user.type(within(dialog).getByLabelText('Name'), 'Naman Again')
    await user.type(within(dialog).getByLabelText('Work email'), 'naman@shazlo.store')
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Super admin' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    const email = within(dialog).getByLabelText('Work email')
    await waitFor(() => expect(email).toHaveAccessibleDescription('This email already has an admin account.'))
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveFocus()
    expect(identityDb.admins).toHaveLength(5)
  })
})

describe('A-11 Admins: edit roles', () => {
  it('changes roles and keeps at least one', async () => {
    const { user, identityDb } = await openAdmins()
    await menu(user, 'Priya Mehta', 'Edit roles')
    const dialog = await screen.findByRole('dialog', { name: 'Edit roles for Priya Mehta' })
    const reviewer = within(dialog).getByRole('checkbox', { name: 'Vendor reviewer' })
    expect(reviewer).toBeChecked()
    await user.click(reviewer)
    await user.click(within(dialog).getByRole('button', { name: 'Save roles' }))
    expect(await within(dialog).findByText('Choose at least one role.')).toBeInTheDocument()
    await user.click(reviewer)
    await user.click(within(dialog).getByRole('checkbox', { name: 'Super admin' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save roles' }))
    expect(await screen.findByText('Roles updated')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(identityDb.admins.find((a) => a.id === 'a_priya')!.roles).toEqual(['super_admin', 'vendor_reviewer'])
    await waitFor(() => expect(within(rowOf('Priya Mehta')).getByText('Super admin')).toBeInTheDocument())
  })

  it('does not let you remove your own super admin role', async () => {
    const { user } = await openAdmins()
    await menu(user, 'Naman Sinha', 'Edit roles')
    const dialog = await screen.findByRole('dialog', { name: 'Edit roles for Naman Sinha' })
    const own = within(dialog).getByRole('checkbox', { name: 'Super admin' })
    expect(own).toBeChecked()
    expect(own).toBeDisabled()
    expect(dialog).toHaveTextContent('You cannot remove your own super admin role.')
  })
})

describe('A-11 Admins: reset password', () => {
  it('makes a new temporary password and signs them out', async () => {
    const { user, identityDb } = await openAdmins()
    identityDb.refresh.set('refresh.a_rahul.1', 'a_rahul')
    await menu(user, 'Rahul Desai', 'Reset password')
    const dialog = await screen.findByRole('dialog', { name: "Reset Rahul's password?" })
    expect(dialog).toHaveTextContent('They are signed out of every session')
    await user.click(within(dialog).getByRole('button', { name: 'Reset password' }))
    expect(await within(dialog).findByRole('heading', { name: 'Send Rahul the new temporary password' })).toBeInTheDocument()
    const rahul = identityDb.admins.find((a) => a.id === 'a_rahul')!
    expect(rahul.must_change_password).toBe(true)
    expect(rahul.password).toMatch(TEMP)
    expect(dialog).toHaveTextContent(rahul.password)
    expect(identityDb.refresh.has('refresh.a_rahul.1')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Copy temporary password' }))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(rowOf('Rahul Desai').querySelector('[data-status]')).toHaveTextContent('Invited · password not set'))
  })
})

describe('A-11 Admins: deactivate and reactivate', () => {
  it('deactivates Priya after saying when she loses access', async () => {
    const { user, identityDb } = await openAdmins()
    await menu(user, 'Priya Mehta', 'Deactivate')
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Priya Mehta?' })
    expect(dialog).toHaveTextContent('They lose access within 15 minutes, when their current session token expires.')
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    expect(await screen.findByText('Priya Mehta is deactivated')).toBeInTheDocument()
    expect(identityDb.admins.find((a) => a.id === 'a_priya')!.is_active).toBe(false)
    await waitFor(() => expect(within(table()).queryByText('Priya Mehta')).toBeNull())
  })

  it('reactivates Kabir without a dialog', async () => {
    const { user, identityDb } = await openAdmins()
    await choose(user, 'Status', 'Deactivated')
    await waitFor(() => expect(names()).toEqual([expect.stringContaining('Kabir Shah')]))
    await menu(user, 'Kabir Shah', 'Reactivate')
    expect(await screen.findByText('Kabir Shah can sign in again')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(identityDb.admins.find((a) => a.id === 'a_kabir')!.is_active).toBe(true)
  })

  it('does not let you deactivate yourself', async () => {
    const { user } = await openAdmins()
    await user.click(within(rowOf('Naman Sinha')).getByRole('button', { name: 'Actions for Naman Sinha' }))
    const item = await screen.findByRole('menuitem', { name: /^Deactivate/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('You cannot deactivate yourself.')
  })

  it('shows the API answer when a change is refused', async () => {
    server.use(http.patch('*/v1/admins/:id', () => HttpResponse.json({ message: 'You cannot remove your own super admin access or deactivate yourself.', extra: { code: 'conflict' } }, { status: 409 })))
    const { user, identityDb } = await openAdmins()
    await menu(user, 'Priya Mehta', 'Deactivate')
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Priya Mehta?' })
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You cannot remove your own super admin access or deactivate yourself.')
    expect(identityDb.admins.find((a) => a.id === 'a_priya')!.is_active).toBe(true)
  })
})
