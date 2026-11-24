import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { clearSensitiveState } from '../security/sensitiveState'
import { makeStore, sessionBody } from '../session/testing'
import { ME, admin, fakeIdentity, type FakeAdmin } from '../test/fakeIdentity'
import { useApiServer } from '../test/msw'
import { renderRoute } from '../test/renderRoute'
import { typeFast } from '../test/typeFast'
import { setViewport } from '../test/viewport'
import { countdownClock } from '../test/countdown'

const server = useApiServer()

const me = admin({ id: ME, email: 'admin@shazlo.test', display_name: 'Asha Admin', roles: ['super_admin'] })
const people: FakeAdmin[] = [
  me,
  admin({ id: 'b1', display_name: 'Bela Reviewer', email: 'bela@shazlo.test', roles: ['vendor_reviewer'] }),
  admin({ id: 'c1', display_name: 'Chet Both', email: 'chet@shazlo.test', roles: ['super_admin', 'vendor_reviewer'] }),
  admin({ id: 'd1', display_name: 'Dev Gone', email: 'dev@shazlo.test', roles: ['vendor_reviewer'], is_active: false }),
]

const GOOD = 'a long enough temporary phrase'

/** The signed-in session's roles, which can be older than the backend's (a token is good for 15 minutes). */
function setup(options: { admins?: FakeAdmin[]; sessionRoles?: string[] } = {}) {
  setViewport(1280)
  const backend = fakeIdentity(server, options.admins ?? people)
  const rolesOfMe = () => options.sessionRoles ?? backend.find(ME)?.roles ?? []
  const refresh = vi.fn(async () => sessionBody({ roles: rolesOfMe() }))
  const store = makeStore({ refresh, fetchMe: async () => sessionBody({ roles: rolesOfMe() }).admin }).store
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = renderRoute('/admins', { store, queryClient })
  return { backend, router, store, refresh, queryClient, user: userEvent.setup() }
}
type Setup = ReturnType<typeof setup>

const table = () => screen.findByRole('table', { name: 'Admins' })
const rowOf = async (name: string) => within(await table()).getByRole('row', { name: new RegExp(name) })
const notice = () => screen.findByRole('status')

async function openCreate(t: Setup) {
  await table()
  await t.user.click(screen.getByRole('button', { name: 'Create an admin' }))
  return screen.findByRole('dialog', { name: 'Create an admin' })
}

async function fillCreate(
  t: Setup,
  dialog: HTMLElement,
  values: { email?: string; name?: string; password?: string; roles?: string[] } = {},
) {
  const { email = 'neo@shazlo.test', name = 'Neo New', password = GOOD, roles = ['vendor_reviewer'] } = values
  const d = within(dialog)
  await typeFast(t.user, d.getByLabelText(/^Email address/), email)
  await typeFast(t.user, d.getByLabelText(/^Name/), name)
  for (const role of roles) await t.user.click(d.getByRole('checkbox', { name: role.replace('_', ' ') }))
  if (password !== '') await typeFast(t.user, d.getByLabelText(/^Temporary password/), password)
}

async function openEdit(t: Setup, name: string) {
  await table()
  await t.user.click(screen.getByRole('button', { name: `Edit ${name}` }))
  return screen.findByRole('dialog', { name: new RegExp(`Edit ${name}`) })
}

/** No temporary password in the form, the mutation cache or the query cache. */
async function expectNoPasswordKept(t: Setup, password: string) {
  await waitFor(() => expect(t.queryClient.getMutationCache().getAll()).toEqual([]))
  for (const input of document.querySelectorAll<HTMLInputElement>('input')) expect(input.value).not.toContain(password)
  expect(JSON.stringify(t.queryClient.getQueryCache().getAll().map((query) => query.state.data))).not.toContain(password)
  expect(document.body.innerHTML).not.toContain(password)
}

describe('creating an admin', () => {
  it('lists the roles that exist with their descriptions, and says the password is for first sign-in only and is never emailed', async () => {
    const t = setup()
    const dialog = await openCreate(t)
    const d = within(dialog)
    expect(d.getByRole('checkbox', { name: 'super admin' })).toBeTruthy()
    expect(d.getByRole('checkbox', { name: 'vendor reviewer' })).toBeTruthy()
    expect(d.getByText('Sees every module and manages admins.')).toBeTruthy()
    expect(d.getByText('Reviews vendor applications, products and brand pages.')).toBeTruthy()
    expect(dialog.textContent).toMatch(/They must change it at their first sign-in/)
    expect(dialog.textContent).toMatch(/never emailed/)
    expect(t.backend.callsTo('GET', '/v1/roles')).toHaveLength(1)
  })

  it('creates the admin with what was typed, closes, and says what to do next', async () => {
    const t = setup()
    const dialog = await openCreate(t)
    await fillCreate(t, dialog, { email: 'Neo@Shazlo.test ', name: ' Neo New ', roles: ['vendor_reviewer', 'super_admin'] })
    await t.user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(t.backend.callsTo('POST', '/v1/admins')[0]!.body).toEqual({
      email: 'Neo@Shazlo.test',
      display_name: 'Neo New',
      password: GOOD,
      roles: ['vendor_reviewer', 'super_admin'],
    })
    const message = (await notice()).textContent
    expect(message).toMatch(/Created Neo New/)
    expect(message).toMatch(/must change the temporary password at their first sign-in/)
    expect(message).toMatch(/never emailed/)
    // The list shows them, flagged as having to change their password.
    const row = await rowOf('Neo New')
    expect(within(row).getByText('Must change')).toBeTruthy()
    expect(within(row).getByText('Active')).toBeTruthy()
  })

  it('generates a temporary password, shows it so it can be read once, and sends it', async () => {
    const t = setup()
    const dialog = await openCreate(t)
    await t.user.click(within(dialog).getByRole('button', { name: 'Generate a password' }))
    const field = within(dialog).getByLabelText(/^Temporary password/) as HTMLInputElement
    expect(field.type).toBe('text')
    expect(field.value).toHaveLength(20)
    const generated = field.value
    await typeFast(t.user, within(dialog).getByLabelText(/^Email address/), 'neo@shazlo.test')
    await typeFast(t.user, within(dialog).getByLabelText(/^Name/), 'Neo New')
    await t.user.click(within(dialog).getByRole('checkbox', { name: 'vendor reviewer' }))
    await t.user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((t.backend.callsTo('POST', '/v1/admins')[0]!.body as { password: string }).password).toBe(generated)
    await expectNoPasswordKept(t, generated)
  })

  it('asks for what is missing, focuses the first problem, and sends nothing', async () => {
    const t = setup()
    const dialog = await openCreate(t)
    await t.user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    expect(await within(dialog).findByText('Enter an email address.')).toBeTruthy()
    expect(within(dialog).getByText('Enter a name.')).toBeTruthy()
    expect(within(dialog).getByText('Enter a temporary password.')).toBeTruthy()
    expect(within(dialog).getByText('Choose at least one role.')).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/^Email address/))
    expect(t.backend.callsTo('POST', '/v1/admins')).toEqual([])
  })

  it('checks the password before sending: at least 12 characters, and not the email address', async () => {
    const t = setup()
    const dialog = await openCreate(t)
    await fillCreate(t, dialog, { password: 'short' })
    await t.user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    expect(await within(dialog).findByText('Use at least 12 characters.')).toBeTruthy()
    expect(t.backend.callsTo('POST', '/v1/admins')).toEqual([])
    await t.user.clear(within(dialog).getByLabelText(/^Temporary password/))
    await typeFast(t.user, within(dialog).getByLabelText(/^Temporary password/), 'neo@shazlo.test')
    await t.user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    expect(await within(dialog).findByText('The password must not be the email address.')).toBeTruthy()
  })

  it('email_taken is shown next to the email, in any letter case, and the dialog stays', async () => {
    const t = setup()
    const dialog = await openCreate(t)
    await fillCreate(t, dialog, { email: 'BELA@SHAZLO.TEST' })
    await t.user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    const message = await within(dialog).findByText(/already exists/)
    const email = within(dialog).getByLabelText(/^Email address/)
    expect(email.getAttribute('aria-invalid')).toBe('true')
    expect(email.getAttribute('aria-describedby')).toBe(message.id)
    expect(screen.getByRole('dialog', { name: 'Create an admin' })).toBeTruthy()
    expect(document.activeElement).toBe(email)
  })

  it('weak_password is shown next to the password', async () => {
    const t = setup()
    const dialog = await openCreate(t)
    await fillCreate(t, dialog, { password: 'my-password-is-long' })
    await t.user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    const message = await within(dialog).findByText(/does not meet the rules: Password is too common/)
    const password = within(dialog).getByLabelText(/^Temporary password/)
    expect(password.getAttribute('aria-invalid')).toBe('true')
    expect(password.getAttribute('aria-describedby')).toBe(message.id)
  })

  it('unknown_role is shown next to the roles', async () => {
    const t = setup()
    const dialog = await openCreate(t)
    await fillCreate(t, dialog)
    // Someone removed the role while the dialog was open.
    t.backend.roles = t.backend.roles.filter((role) => role.name !== 'vendor_reviewer')
    await t.user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    const message = await within(dialog).findByText(/does not exist any more/)
    expect(message.closest('fieldset')?.textContent).toMatch(/Roles/)
  })

  it('a rate limit shows a countdown and holds the button', async () => {
    const t = setup()
    t.backend.nextCreateFails = { status: 429, code: 'rate_limited', retryAfter: 30 }
    const dialog = await openCreate(t)
    await fillCreate(t, dialog)
    const countdown = countdownClock(30)
    await t.user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    countdown((await within(dialog).findByText(/Try again in \d+ s\./)).textContent, /Try again in (\d+) s\./)
    expect((within(dialog).getByRole('button', { name: 'Create admin' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([
    ['accepted', GOOD, {}],
    ['refused as email_taken', GOOD, { email: 'bela@shazlo.test' }],
    ['refused as weak', 'password-password-1', {}],
  ])('keeps no copy of the temporary password in the form or the caches once the call has ended (%s)', async (_name, password, values) => {
    const t = setup()
    const dialog = await openCreate(t)
    await fillCreate(t, dialog, { password, ...values })
    await t.user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    await waitFor(() => expect(t.backend.callsTo('POST', '/v1/admins')).toHaveLength(1))
    await expectNoPasswordKept(t, password)
    const field = screen.queryByLabelText(/^Temporary password/) as HTMLInputElement | null
    if (field) expect(field.value).toBe('')
  })

  it('keeps it out of web storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const t = setup()
    const dialog = await openCreate(t)
    await fillCreate(t, dialog)
    await t.user.click(within(dialog).getByRole('button', { name: 'Create admin' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(setItem).not.toHaveBeenCalled()
  })

  it('empties a half-typed password when the session ends', async () => {
    const t = setup()
    const dialog = await openCreate(t)
    await typeFast(t.user, within(dialog).getByLabelText(/^Temporary password/), 'half typed')
    clearSensitiveState()
    await waitFor(() => expect((within(dialog).getByLabelText(/^Temporary password/) as HTMLInputElement).value).toBe(''))
  })

  it('cancels without sending anything', async () => {
    const t = setup()
    const dialog = await openCreate(t)
    await fillCreate(t, dialog)
    await t.user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(t.backend.callsTo('POST', '/v1/admins')).toEqual([])
  })
})

describe('editing an admin', () => {
  it('opens with what they have now, and keeps Save off until something changes', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Chet Both')
    const d = within(dialog)
    expect((d.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Chet Both')
    expect((d.getByRole('checkbox', { name: 'super admin' }) as HTMLInputElement).checked).toBe(true)
    expect((d.getByRole('checkbox', { name: 'vendor reviewer' }) as HTMLInputElement).checked).toBe(true)
    expect((d.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('changes the name and the roles, sending only what changed, and says when the roles take effect', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Bela Reviewer')
    const d = within(dialog)
    expect(dialog.textContent).toMatch(/A role change reaches Bela Reviewer's tokens at their next token, within 15 minutes/)
    await t.user.clear(d.getByLabelText(/^Name/))
    await typeFast(t.user, d.getByLabelText(/^Name/), 'Bela R. Reviewer')
    await t.user.click(d.getByRole('checkbox', { name: 'super admin' }))
    await t.user.click(d.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(t.backend.callsTo('PATCH', '/v1/admins/{id}')[0]!.body).toEqual({
      id: 'b1',
      display_name: 'Bela R. Reviewer',
      roles: ['vendor_reviewer', 'super_admin'],
    })
    expect((await notice()).textContent).toMatch(/Saved Bela R\. Reviewer\. The new roles reach their tokens at their next token, within 15 minutes\./)
    await rowOf('Bela R\\. Reviewer')
    expect(t.refresh).toHaveBeenCalledTimes(1) // only the sign-in restore: someone else's roles do not refresh my session
  })

  it('sends only the name when only the name changed, and then says nothing about roles', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Bela Reviewer')
    await t.user.clear(within(dialog).getByLabelText(/^Name/))
    await typeFast(t.user, within(dialog).getByLabelText(/^Name/), 'Bela Renamed')
    await t.user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(t.backend.callsTo('PATCH', '/v1/admins/{id}')[0]!.body).toEqual({ id: 'b1', display_name: 'Bela Renamed' })
    expect((await notice()).textContent).toBe('Saved Bela Renamed.')
  })

  it('checks a name and at least one role before sending', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Bela Reviewer')
    await t.user.click(within(dialog).getByRole('checkbox', { name: 'vendor reviewer' }))
    await t.user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('Choose at least one role.')).toBeTruthy()
    expect(t.backend.callsTo('PATCH', '/v1/admins/{id}')).toEqual([])
  })

  it('keeps a role the admin holds that no longer exists, so saving does not silently drop it', async () => {
    const t = setup({ admins: [me, admin({ id: 'o1', display_name: 'Old Hand', roles: ['vendor_reviewer', 'retired_role'] })] })
    const dialog = await openEdit(t, 'Old Hand')
    expect((within(dialog).getByRole('checkbox', { name: 'retired role' }) as HTMLInputElement).checked).toBe(true)
    expect(within(dialog).getByText('This role is no longer defined.')).toBeTruthy()
  })

  it('unknown_role is shown next to the roles', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Bela Reviewer')
    await t.user.click(within(dialog).getByRole('checkbox', { name: 'super admin' }))
    t.backend.roles = t.backend.roles.filter((role) => role.name !== 'super_admin')
    await t.user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText(/does not exist any more/)).toBeTruthy()
  })

  it('admin_not_found is shown above the form with the dialog still open, and the list reloads behind it', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Bela Reviewer')
    t.backend.admins = t.backend.admins.filter((entry) => entry.id !== 'b1')
    const before = t.backend.callsTo('GET', '/v1/admins').length
    await typeFast(t.user, within(dialog).getByLabelText(/^Name/), ' changed')
    await t.user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/no longer exists/)
    expect(screen.getByRole('dialog', { name: /Edit Bela Reviewer/ })).toBeTruthy()
    await waitFor(() => expect(t.backend.callsTo('GET', '/v1/admins').length).toBeGreaterThan(before))
    await t.user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Admins' })).queryByText('Bela Reviewer')).toBeNull())
  })
})

describe('deactivating and reactivating', () => {
  it('asks first, says their sessions end at once, and does nothing if cancelled', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Bela Reviewer')
    await t.user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate Bela Reviewer?' })
    expect(confirm.textContent).toMatch(/Their sessions end at once/)
    await t.user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Deactivate Bela Reviewer?' })).toBeNull())
    expect(t.backend.callsTo('PATCH', '/v1/admins/{id}')).toEqual([])
    expect(t.backend.find('b1')!.is_active).toBe(true)
  })

  it('deactivates when confirmed, and the list shows it', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Bela Reviewer')
    await t.user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate Bela Reviewer?' })
    await t.user.click(within(confirm).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(t.backend.callsTo('PATCH', '/v1/admins/{id}')[0]!.body).toEqual({ id: 'b1', is_active: false })
    expect((await notice()).textContent).toMatch(/Bela Reviewer was deactivated\. Their sessions ended at once\./)
    expect(within(await rowOf('Bela Reviewer')).getByText('Deactivated')).toBeTruthy()
  })

  it('reactivates when confirmed', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Dev Gone')
    expect(within(dialog).getByText(/Access: deactivated/)).toBeTruthy()
    await t.user.click(within(dialog).getByRole('button', { name: 'Reactivate' }))
    const confirm = await screen.findByRole('dialog', { name: 'Reactivate Dev Gone?' })
    expect(confirm.textContent).toMatch(/sign in again/)
    await t.user.click(within(confirm).getByRole('button', { name: 'Reactivate' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(t.backend.callsTo('PATCH', '/v1/admins/{id}')[0]!.body).toEqual({ id: 'd1', is_active: true })
    expect((await notice()).textContent).toMatch(/Dev Gone was reactivated and can sign in again\./)
    expect(within(await rowOf('Dev Gone')).getByText('Active')).toBeTruthy()
  })

  it('does not offer a super admin the chance to deactivate themselves, and says why', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Asha Admin')
    expect((within(dialog).getByRole('button', { name: 'Deactivate' }) as HTMLButtonElement).disabled).toBe(true)
    expect(dialog.textContent).toMatch(/You cannot deactivate your own account/)
    expect(dialog.textContent).toMatch(/\(you\)/)
  })

  it('last_super_admin: the only active super admin cannot be deactivated, and the screen says why next to the control', async () => {
    // My own roles changed meanwhile (my token still says super_admin), so Chet is the only active one.
    const t = setup({ admins: [admin({ ...me, roles: ['vendor_reviewer'] }), people[2]!, people[1]!], sessionRoles: ['super_admin'] })
    const dialog = await openEdit(t, 'Chet Both')
    await t.user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate Chet Both?' })
    await t.user.click(within(confirm).getByRole('button', { name: 'Deactivate' }))
    const alert = await within(dialog).findByText(/This is the only active super admin\. Deactivating them would lock everyone out/)
    // Next to the Deactivate control: inside the Access section, not above the form.
    expect(alert.closest('section')?.textContent).toMatch(/Access: active/)
    expect(t.backend.find('c1')!.is_active).toBe(true)
    // The edit dialog stays open (the confirmation is still closing, so wait for it to be reachable again).
    expect(await screen.findByRole('dialog', { name: /Edit Chet Both/ })).toBeTruthy()
  })
})

describe('editing yourself', () => {
  it('refreshes your own session at once, so you see your own new roles', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Asha Admin')
    expect(dialog.textContent).toMatch(/your own session is refreshed at once/)
    await t.user.click(within(dialog).getByRole('checkbox', { name: 'vendor reviewer' }))
    await t.user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(t.refresh).toHaveBeenCalledTimes(2)
    expect((await notice()).textContent).toMatch(/Saved Asha Admin\. Your own roles were refreshed\./)
    expect(t.store.getSnapshot().roles).toEqual(['super_admin', 'vendor_reviewer'])
  })

  it('does not refresh your session for a change that is not to your roles', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Asha Admin')
    await typeFast(t.user, within(dialog).getByLabelText(/^Name/), ' Jr')
    await t.user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(t.refresh).toHaveBeenCalledTimes(1)
  })

  it('shows the 403 page and takes Admins out of the navigation once you remove your own super admin role', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Asha Admin')
    await t.user.click(within(dialog).getByRole('checkbox', { name: 'super admin' }))
    await t.user.click(within(dialog).getByRole('checkbox', { name: 'vendor reviewer' }))
    await t.user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" })).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Modules' })).queryByRole('link', { name: 'Admins' })).toBeNull()
    expect(t.store.getSnapshot().roles).toEqual(['vendor_reviewer'])
  })

  it('last_super_admin: the only active super admin cannot give the role up, and the screen says why next to the roles', async () => {
    const t = setup({ admins: [me, admin({ ...people[2]!, is_active: false })] })
    const dialog = await openEdit(t, 'Asha Admin')
    await t.user.click(within(dialog).getByRole('checkbox', { name: 'super admin' }))
    await t.user.click(within(dialog).getByRole('checkbox', { name: 'vendor reviewer' }))
    await t.user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    const message = await within(dialog).findByText(/Taking the super admin role away would lock everyone out/)
    expect(message.closest('fieldset')).not.toBeNull()
    expect(t.backend.find(ME)!.roles).toEqual(['super_admin'])
    // Still a super admin: nothing refreshed, the page still works.
    expect(t.refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: /Edit Asha Admin/ })).toBeTruthy()
  })

  it('a 403 means you lost the role: your session is read again and the page becomes the 403 page', async () => {
    const t = setup()
    const dialog = await openEdit(t, 'Bela Reviewer')
    await typeFast(t.user, within(dialog).getByLabelText(/^Name/), ' x')
    t.backend.find(ME)!.roles = ['vendor_reviewer']
    t.backend.nextPatchFails = { status: 403, code: 'forbidden' }
    await t.user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" })).toBeTruthy()
    expect(t.refresh).toHaveBeenCalledTimes(2)
  })
})

describe('resetting a password', () => {
  async function openReset(t: Setup, name = 'Bela Reviewer') {
    const edit = await openEdit(t, name)
    await t.user.click(within(edit).getByRole('button', { name: 'Reset password…' }))
    return screen.findByRole('dialog', { name: new RegExp(`Reset the password of ${name}`) })
  }

  it('explains what it does, asks for a temporary password, and confirms before sending', async () => {
    const t = setup()
    const dialog = await openReset(t)
    expect(dialog.textContent).toMatch(/ends all their sessions at once/)
    expect(dialog.textContent).toMatch(/never emailed/)
    await typeFast(t.user, within(dialog).getByLabelText(/^New temporary password/), GOOD)
    await t.user.click(within(dialog).getByRole('button', { name: 'Reset password…' }))
    const confirm = await screen.findByRole('dialog', { name: "Reset Bela Reviewer's password?" })
    expect(confirm.textContent).toMatch(/Their current sessions end at once, and they must choose a new password at their next sign-in/)
    expect(t.backend.callsTo('POST', '/v1/admins/{id}/reset-password')).toEqual([])
  })

  it('sends nothing when the confirmation is cancelled, and keeps nothing', async () => {
    const t = setup()
    const dialog = await openReset(t)
    await typeFast(t.user, within(dialog).getByLabelText(/^New temporary password/), GOOD)
    await t.user.click(within(dialog).getByRole('button', { name: 'Reset password…' }))
    const confirm = await screen.findByRole('dialog', { name: "Reset Bela Reviewer's password?" })
    await t.user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: "Reset Bela Reviewer's password?" })).toBeNull())
    expect(t.backend.callsTo('POST', '/v1/admins/{id}/reset-password')).toEqual([])
  })

  it('resets when confirmed: the password is sent, the admin must change it, and nothing is kept', async () => {
    const t = setup()
    const dialog = await openReset(t)
    await typeFast(t.user, within(dialog).getByLabelText(/^New temporary password/), GOOD)
    await t.user.click(within(dialog).getByRole('button', { name: 'Reset password…' }))
    const confirm = await screen.findByRole('dialog', { name: "Reset Bela Reviewer's password?" })
    await t.user.click(within(confirm).getByRole('button', { name: 'Reset password' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(t.backend.callsTo('POST', '/v1/admins/{id}/reset-password')[0]!.body).toEqual({ id: 'b1', new_password: GOOD })
    const message = (await notice()).textContent
    expect(message).toMatch(/password of Bela Reviewer was reset/)
    expect(message).toMatch(/Their sessions ended and they must choose a new password/)
    expect(message).toMatch(/never emailed/)
    await expectNoPasswordKept(t, GOOD)
    expect(within(await rowOf('Bela Reviewer')).getByText('Must change')).toBeTruthy()
  })

  it('checks the password first, without asking for a confirmation', async () => {
    const t = setup()
    const dialog = await openReset(t)
    await typeFast(t.user, within(dialog).getByLabelText(/^New temporary password/), 'short')
    await t.user.click(within(dialog).getByRole('button', { name: 'Reset password…' }))
    expect(await within(dialog).findByText('Use at least 12 characters.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: /password\?/ })).toBeNull()
    expect(t.backend.callsTo('POST', '/v1/admins/{id}/reset-password')).toEqual([])
  })

  it('weak_password is shown next to the password, and the password is gone from the field', async () => {
    const t = setup()
    const dialog = await openReset(t)
    await typeFast(t.user, within(dialog).getByLabelText(/^New temporary password/), 'my-password-is-long')
    await t.user.click(within(dialog).getByRole('button', { name: 'Reset password…' }))
    const confirm = await screen.findByRole('dialog', { name: "Reset Bela Reviewer's password?" })
    await t.user.click(within(confirm).getByRole('button', { name: 'Reset password' }))
    expect(await within(dialog).findByText(/does not meet the rules: Password is too common/)).toBeTruthy()
    expect((within(dialog).getByLabelText(/^New temporary password/) as HTMLInputElement).value).toBe('')
    await expectNoPasswordKept(t, 'my-password-is-long')
  })

  it('admin_not_found is shown above the form', async () => {
    const t = setup()
    const dialog = await openReset(t)
    t.backend.admins = t.backend.admins.filter((entry) => entry.id !== 'b1')
    await typeFast(t.user, within(dialog).getByLabelText(/^New temporary password/), GOOD)
    await t.user.click(within(dialog).getByRole('button', { name: 'Reset password…' }))
    const confirm = await screen.findByRole('dialog', { name: "Reset Bela Reviewer's password?" })
    await t.user.click(within(confirm).getByRole('button', { name: 'Reset password' }))
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/no longer exists/)
  })

  it('generates a temporary password here too', async () => {
    const t = setup()
    const dialog = await openReset(t)
    await t.user.click(within(dialog).getByRole('button', { name: 'Generate a password' }))
    expect((within(dialog).getByLabelText(/^New temporary password/) as HTMLInputElement).value).toHaveLength(20)
  })
})
