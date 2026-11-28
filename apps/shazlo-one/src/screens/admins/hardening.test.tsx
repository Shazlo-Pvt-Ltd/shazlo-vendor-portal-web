import { act, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMINS_PAGE_SIZE, TEMPORARY_PASSWORD_LENGTH, temporaryPassword } from '../../api/queries'
import { ADMIN_ID, type IdentityDb } from '../../mocks/identity'
import { renderShell } from '../../test/render'
import { server } from '../../test/server'

// Admin management's hardening, against the identity mock (which answers as identity-api does).

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const refusal = (code: string, status = 409) => HttpResponse.json({ error: { code, message: code, request_id: 'r' } }, { status })

async function openAdmins(route = '/admins') {
  const view = await renderShell({ route })
  await screen.findByRole('heading', { level: 1, name: 'Admins & roles' })
  await screen.findByRole('cell', { name: /Naman Sinha/ })
  return view
}

const rowOf = (name: string) => within(screen.getByRole('table', { name: 'Admins' })).getByText(name).closest('tr') as HTMLElement
async function menu(user: UserEvent, name: string, item: string) {
  await user.click(within(rowOf(name)).getByRole('button', { name: `Actions for ${name}` }))
  await user.click(await screen.findByRole('menuitem', { name: new RegExp(`^${item}`) }))
}
function counter(method: string, path: string) {
  const seen = { n: 0 }
  server.events.on('request:start', ({ request }) => {
    if (request.method === method && new URL(request.url).pathname === path) seen.n += 1
  })
  return seen
}

afterEach(() => server.events.removeAllListeners())

describe('temporary passwords', () => {
  // Each draw is one random byte. `byte % 31` over all 256 values gives the first 8 characters 9 bytes
  // each and the rest 8: a bias. The unbiased draw uses only bytes 0 to 247, 8 per character.
  const drawn = (byte: number) => temporaryPassword((bytes) => (bytes[0] === undefined ? bytes : bytes.fill(byte === -1 ? 0 : byte)))

  it('maps the bytes it uses to every character equally often', () => {
    const counts = new Map<string, number>()
    for (let byte = 0; byte < 248; byte++) {
      const char = drawn(byte)[0]!
      counts.set(char, (counts.get(char) ?? 0) + 1)
    }
    expect([...counts.keys()].sort().join('')).toBe([...ALPHABET].sort().join(''))
    expect(new Set(counts.values())).toEqual(new Set([8]))
  })

  it.each([248, 249, 250, 255])('never uses byte %i, which only `% 31` could map', (byte) => {
    let calls = 0
    const password = temporaryPassword((bytes) => bytes.fill((calls += 1) === 1 ? byte : 0))
    // The first batch is thrown away whole; the second (all zeros) fills the password with "a".
    expect(password).toBe('aaaa-aaaa-aaaa-aaaa')
  })

  it('throw away the bytes that would cause the bias, and still fill every character', () => {
    let calls = 0
    const source = (bytes: Uint8Array<ArrayBuffer>) => {
      calls += 1
      // The first batch is all 248 or above: none of it may be used.
      bytes.fill(calls === 1 ? 250 : 5)
      return bytes
    }
    expect(temporaryPassword(source)).toBe('ffff-ffff-ffff-ffff')
    expect(calls).toBe(2)
  })

  it('are 16 characters in groups of four, from the readable alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const password = temporaryPassword()
      expect(password).toMatch(/^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){3}$/)
      expect(password.replaceAll('-', '')).toHaveLength(TEMPORARY_PASSWORD_LENGTH)
    }
  })

  it('leave no trace in the query or mutation caches once an invite is sent', async () => {
    const { user, context } = await openAdmins()
    await user.click(screen.getByRole('button', { name: 'Invite admin' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Asha Rao')
    await user.type(within(dialog).getByLabelText('Work email'), 'asha@shazlo.store')
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Vendor reviewer' }))
    const password = (within(dialog).getByLabelText('Temporary password') as HTMLInputElement).value
    await user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    expect(await within(dialog).findByText(password)).toBeInTheDocument()
    expect(JSON.stringify(context.queryClient.getMutationCache().getAll().map((m) => m.state))).not.toContain(password)
    expect(JSON.stringify(context.queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(password)
  })

  it('leave no trace in the mutation cache once a password is reset', async () => {
    const { user, context, identityDb } = await openAdmins()
    await menu(user, 'Priya Mehta', 'Reset password')
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Reset password' }))
    await waitFor(() => expect(identityDb.admins.find((a) => a.id === ADMIN_ID.priya)!.must_change_password).toBe(true))
    const password = identityDb.admins.find((a) => a.id === ADMIN_ID.priya)!.password
    expect(await within(dialog).findByText(password)).toBeInTheDocument()
    expect(JSON.stringify(context.queryClient.getMutationCache().getAll().map((m) => m.state))).not.toContain(password)
  })
})

describe('refusals', () => {
  it('puts last_super_admin next to the roles when the change took the role away', async () => {
    server.use(http.patch('*/v1/admins/:id', () => refusal('last_super_admin')))
    const { user } = await openAdmins()
    await menu(user, 'Priya Mehta', 'Edit roles')
    const dialog = await screen.findByRole('dialog')
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Super admin' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save roles' }))
    expect(await within(dialog).findByText(/This is the only active super admin. Taking the role away/)).toBeInTheDocument()
  })

  it('says last_super_admin in the deactivate dialog when deactivating', async () => {
    server.use(http.patch('*/v1/admins/:id', () => refusal('last_super_admin')))
    const { user } = await openAdmins()
    await menu(user, 'Priya Mehta', 'Deactivate')
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Priya Mehta?' })
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/This is the only active super admin. Deactivating them/)
  })

  it('the mock refuses, as identity-api does, to strip the last active super admin or let you deactivate yourself', async () => {
    const { context, identityDb } = await openAdmins()
    const naman = ADMIN_ID.naman
    await expect(context.identity.call((c) => c.PATCH('/v1/admins/{admin_id}', { params: { path: { admin_id: naman } }, body: { roles: ['vendor_reviewer'] } }))).rejects.toMatchObject({ status: 409, code: 'last_super_admin' })
    await expect(context.identity.call((c) => c.PATCH('/v1/admins/{admin_id}', { params: { path: { admin_id: naman } }, body: { is_active: false } }))).rejects.toMatchObject({ status: 409, code: 'cannot_deactivate_self' })
    expect(identityDb.admins.find((a) => a.id === naman)!.roles).toEqual(['super_admin'])
  })

  it('reloads the list when the admin is gone', async () => {
    server.use(http.patch('*/v1/admins/:id', () => refusal('admin_not_found', 404)))
    const lists = counter('GET', '/v1/admins')
    const { user } = await openAdmins()
    const before = lists.n
    await menu(user, 'Priya Mehta', 'Deactivate')
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Priya Mehta?' })
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This admin no longer exists.')
    await waitFor(() => expect(lists.n).toBeGreaterThan(before))
  })
})

describe('a 403 reads the session again', () => {
  it('shows the right page once a super admin loses the role mid-session', async () => {
    const refreshes = counter('POST', '/v1/auth/refresh')
    const { user, identityDb, context } = await openAdmins()
    // Another super admin takes the role away; identity-api now refuses every admin call.
    identityDb.admins.find((a) => a.id === ADMIN_ID.naman)!.roles = ['vendor_reviewer']
    await user.type(screen.getByRole('textbox', { name: 'Search name or email' }), 'p')
    expect(await screen.findByRole('heading', { name: 'Only super admins can manage admins' })).toBeInTheDocument()
    expect(refreshes.n).toBe(1)
    expect(context.session.get().admin?.roles).toEqual(['vendor_reviewer'])
  })

  it('does not loop when the session comes back unchanged', async () => {
    server.use(http.get('*/v1/admins', () => refusal('forbidden', 403)))
    const { context } = await renderShell({ route: '/admins' })
    const renew = vi.spyOn(context.session, 'renew')
    await screen.findByRole('heading', { level: 1, name: 'Admins & roles' })
    await act(async () => {
      for (let i = 0; i < 5; i++) await context.queryClient.refetchQueries({ queryKey: ['admins'] }).catch(() => undefined)
    })
    // Six refusals (the first load and five more), one renewal.
    await waitFor(() => expect(renew).toHaveBeenCalledOnce())
    expect(context.session.get().status).toBe('signed_in')
  })
})

describe('pages', () => {
  function seed(count: number, identityDb: IdentityDb) {
    const template = identityDb.admins.find((a) => a.id === ADMIN_ID.priya)!
    for (let i = 0; i < count; i++) identityDb.admins.push({ ...template, id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`, email: `extra${i}@shazlo.store`, display_name: `Extra ${String(i).padStart(2, '0')}` })
  }
  const rows = () => within(screen.getByRole('table', { name: 'Admins' })).getAllByRole('row').length - 1

  it('pages a long list, and moves an address past the end to the last page', async () => {
    const view = await renderShell({ route: '/' })
    seed(60, view.identityDb)
    await act(() => view.router.navigate('/admins?page=7'))
    await screen.findByRole('heading', { level: 1, name: 'Admins & roles' })
    // 4 active seeds + 60 = 64 active admins: two pages of 50.
    await waitFor(() => expect(new URLSearchParams(view.router.state.location.search).get('page')).toBe('2'))
    const pages = await screen.findByRole('navigation', { name: 'Pages of admins' })
    await waitFor(() => expect(within(pages).getByText('Page 2 of 2')).toBeInTheDocument())
    await waitFor(() => expect(rows()).toBe(64 - ADMINS_PAGE_SIZE))
    expect(screen.getByText('64 admins')).toBeInTheDocument()
    await view.user.click(within(pages).getByRole('button', { name: 'Previous page' }))
    await waitFor(() => expect(within(pages).getByText('Page 1 of 2')).toBeInTheDocument())
    await waitFor(() => expect(rows()).toBe(ADMINS_PAGE_SIZE))
  })

  it('starts again at page 1 when a filter changes', async () => {
    const view = await renderShell({ route: '/' })
    seed(60, view.identityDb)
    await act(() => view.router.navigate('/admins?page=2'))
    await screen.findByRole('navigation', { name: 'Pages of admins' })
    await view.user.type(screen.getByRole('textbox', { name: 'Search name or email' }), 'Extra')
    await waitFor(() => expect(new URLSearchParams(view.router.state.location.search).get('page')).toBeNull())
  })

  it.each(['0', '-1', 'abc', '1e3', '2.5'])('reads page=%s as page 1', async (page) => {
    const { router } = await openAdmins(`/admins?page=${page}`)
    expect(screen.queryByRole('navigation', { name: 'Pages of admins' })).toBeNull()
    expect(rows()).toBe(4)
    expect(router.state.location.pathname).toBe('/admins')
  })
})
