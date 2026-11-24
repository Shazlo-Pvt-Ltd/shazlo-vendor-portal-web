import { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeStore, sessionBody } from '../session/testing'
import { ME, admin, fakeIdentity, type FakeAdmin } from '../test/fakeIdentity'
import { useApiServer } from '../test/msw'
import { renderRoute } from '../test/renderRoute'
import { typeFast } from '../test/typeFast'
import { setViewport } from '../test/viewport'

const server = useApiServer()

const me = admin({ id: ME, email: 'admin@shazlo.test', display_name: 'Asha Admin', roles: ['super_admin'], last_login_at: '2026-11-20T09:30:00Z' })
const people: FakeAdmin[] = [
  me,
  admin({ id: 'b1', display_name: 'Bela Reviewer', email: 'bela@shazlo.test', roles: ['vendor_reviewer'] }),
  admin({ id: 'c1', display_name: 'Chet Both', email: 'chet@shazlo.test', roles: ['super_admin', 'vendor_reviewer'], must_change_password: true }),
  admin({ id: 'd1', display_name: 'Dev Gone', email: 'dev@shazlo.test', roles: ['vendor_reviewer'], is_active: false }),
]

function setup(admins: FakeAdmin[] = people, path = '/admins') {
  setViewport(1280)
  const backend = fakeIdentity(server, admins)
  const roleOfMe = () => backend.find(ME)?.roles ?? []
  const refresh = vi.fn(async () => sessionBody({ roles: roleOfMe() }))
  const store = makeStore({ refresh, fetchMe: async () => sessionBody({ roles: roleOfMe() }).admin }).store
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = renderRoute(path, { store, queryClient })
  return { backend, router, store, refresh, queryClient, user: userEvent.setup() }
}

const table = () => screen.findByRole('table', { name: 'Admins' })
const rows = async () => within(await table()).getAllByRole('row').slice(1)
const names = async () => (await rows()).map((row) => within(row).getAllByRole('cell')[0]!.textContent)

describe('the Admins section: who can reach it', () => {
  it('lists the admins for a super admin, and shows Admins in the navigation', async () => {
    setup()
    expect(await screen.findByRole('heading', { level: 1, name: 'Admins' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Modules' })).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Modules' })).getByRole('link', { name: 'Admins' })).toBeTruthy()
    expect(await names()).toEqual(['Asha Admin (you)', 'Bela Reviewer', 'Chet Both', 'Dev Gone'])
  })

  it.each([
    ['a vendor reviewer', ['vendor_reviewer']],
    ['an admin with no module role', ['catalog_editor']],
  ])('gives %s the 403 page by its URL, without asking identity-api for the admins', async (_name, roles) => {
    const t = setup([admin({ id: ME, email: 'admin@shazlo.test', display_name: 'Asha Admin', roles }), ...people.slice(1)])
    expect(await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Admins' })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(t.backend.calls).toEqual([])
    expect(within(screen.getByRole('navigation', { name: 'Modules' })).queryByRole('link', { name: 'Admins' })).toBeNull()
  })

  it('has one h1 and one main, and a page title', async () => {
    setup()
    await table()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(document.title).toBe('Admins · Shazlo-One')
  })
})

describe('what the list shows', () => {
  it('has each admin’s name, email, roles, whether they are active, and whether they must change their password', async () => {
    setup()
    const [asha, bela, chet, dev] = await rows()
    const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells(asha!).slice(0, 5)).toEqual(['Asha Admin (you)', 'admin@shazlo.test', 'super admin', 'Active', 'Chosen by them'])
    expect(cells(bela!).slice(0, 5)).toEqual(['Bela Reviewer', 'bela@shazlo.test', 'vendor reviewer', 'Active', 'Chosen by them'])
    expect(cells(chet!).slice(0, 5)).toEqual(['Chet Both', 'chet@shazlo.test', 'super adminvendor reviewer', 'Active', 'Must change'])
    expect(cells(dev!).slice(0, 5)).toEqual(['Dev Gone', 'dev@shazlo.test', 'vendor reviewer', 'Deactivated', 'Chosen by them'])
    expect(cells(asha!)[5]).not.toBe('Never')
    expect(cells(bela!)[5]).toBe('Never')
  })

  it('says how many there are, and has an Edit button for each, named for the admin', async () => {
    setup()
    await table()
    expect(screen.getByText('4 admins')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Bela Reviewer' })).toBeTruthy()
  })

  it('says "Loading" first, and shows an error with Retry when the list cannot be loaded', async () => {
    const t = setup()
    t.backend.listFails = true
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/The admins could not be loaded/)
    expect(alert.textContent).toMatch(/Something went wrong on our side/)
    expect(alert.textContent).not.toMatch(/database/)
    t.backend.listFails = false
    await t.user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await table()).toBeTruthy()
  })

  it('says "Loading admins" while the list is on its way', async () => {
    const t = setup()
    t.backend.listDelayMs = 300
    expect(await screen.findByText('Loading admins…')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(await table()).toBeTruthy()
    expect(screen.queryByText('Loading admins…')).toBeNull()
  })

  it('says so when there are no admins at all', async () => {
    const t = setup()
    t.backend.listEmpty = true
    expect(await screen.findByText('There are no admins yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })
})

describe('filters live in the address', () => {
  it('search by name or email: typed text goes in the address after a pause, replacing the entry, and filters the list', async () => {
    const t = setup()
    await table()
    await typeFast(t.user, screen.getByRole('searchbox', { name: 'Search by name or email' }), 'chet@')
    await waitFor(() => expect(t.router.state.location.search).toBe('?q=chet%40'))
    expect(t.router.state.historyAction).toBe('REPLACE')
    await waitFor(async () => expect(await names()).toEqual(['Chet Both']))
    expect(t.backend.callsTo('GET', '/v1/admins').at(-1)?.query.q).toBe('chet@')
  })

  it('filter by role', async () => {
    const t = setup()
    await table()
    await t.user.click(screen.getByRole('combobox', { name: 'Role' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Any role', 'super admin', 'vendor reviewer'])
    await t.user.click(screen.getByRole('option', { name: 'super admin' }))
    await waitFor(() => expect(t.router.state.location.search).toBe('?role=super_admin'))
    await waitFor(async () => expect(await names()).toEqual(['Asha Admin (you)', 'Chet Both']))
  })

  it('filter by status', async () => {
    const t = setup()
    await table()
    await t.user.click(screen.getByRole('combobox', { name: 'Status' }))
    await t.user.click(screen.getByRole('option', { name: 'Deactivated' }))
    await waitFor(() => expect(t.router.state.location.search).toBe('?status=inactive'))
    await waitFor(async () => expect(await names()).toEqual(['Dev Gone']))
    expect(t.backend.callsTo('GET', '/v1/admins').at(-1)?.query.is_active).toBe('false')
    await t.user.click(screen.getByRole('combobox', { name: 'Status' }))
    await t.user.click(screen.getByRole('option', { name: 'Active' }))
    await waitFor(async () => expect((await names()).length).toBe(3))
    expect(t.backend.callsTo('GET', '/v1/admins').at(-1)?.query.is_active).toBe('true')
  })

  it('restore from a copied address after a reload', async () => {
    const t = setup(people, '/admins?q=reviewer&role=vendor_reviewer&status=active')
    await table()
    expect((screen.getByRole('searchbox', { name: 'Search by name or email' }) as HTMLInputElement).value).toBe('reviewer')
    expect(screen.getByRole('combobox', { name: 'Role' }).textContent).toBe('vendor reviewer')
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toBe('Active')
    expect(t.backend.callsTo('GET', '/v1/admins')[0]!.query).toMatchObject({ q: 'reviewer', role: 'vendor_reviewer', is_active: 'true', limit: '25', offset: '0' })
    expect(await names()).toEqual(['Bela Reviewer'])
  })

  it('ignore a hand-edited address that makes no sense', async () => {
    const t = setup(people, '/admins?status=deleted&role=%3Cscript%3E&page=-3')
    expect((await names()).length).toBe(4)
    expect(t.backend.callsTo('GET', '/v1/admins')[0]!.query).toEqual({ limit: '25', offset: '0' })
  })

  it('go back with the browser: choosing a filter adds an entry', async () => {
    const t = setup()
    await table()
    await t.user.click(screen.getByRole('combobox', { name: 'Status' }))
    await t.user.click(screen.getByRole('option', { name: 'Deactivated' }))
    await waitFor(async () => expect(await names()).toEqual(['Dev Gone']))
    await act(async () => {
      await t.router.navigate(-1)
    })
    await waitFor(async () => expect((await names()).length).toBe(4))
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toBe('All')
  })

  it('"Clear filters" shows everything again and empties the address', async () => {
    const t = setup(people, '/admins?q=zzz&status=inactive')
    expect(await screen.findByText('No admin matches these filters')).toBeTruthy()
    await t.user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!)
    await waitFor(() => expect(t.router.state.location.search).toBe(''))
    expect((await names()).length).toBe(4)
    expect((screen.getByRole('searchbox', { name: 'Search by name or email' }) as HTMLInputElement).value).toBe('')
  })

  it('say "no admin matches" rather than show an empty table', async () => {
    setup(people, '/admins?q=nobody-by-that-name')
    expect(await screen.findByText('No admin matches these filters')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('paging', () => {
  const many = [me, ...Array.from({ length: 60 }, (_, n) => admin({ id: `x${n}`, display_name: `Person ${String(n + 1).padStart(2, '0')}` }))]

  it('shows 25 at a time, with the page in the address', async () => {
    const t = setup(many)
    expect((await names()).length).toBe(25)
    expect(screen.getByText('61 admins, page 1 of 3')).toBeTruthy()
    await t.user.click(screen.getByRole('button', { name: 'Go to page 2' }))
    await waitFor(() => expect(t.router.state.location.search).toBe('?page=2'))
    await waitFor(() => expect(t.backend.callsTo('GET', '/v1/admins').at(-1)?.query).toMatchObject({ offset: '25', limit: '25' }))
    expect(await screen.findByText('61 admins, page 2 of 3')).toBeTruthy()
  })

  it('opens on the page in the address, and goes back to page 1 when a filter changes', async () => {
    const t = setup(many, '/admins?page=3')
    await table()
    expect(t.backend.callsTo('GET', '/v1/admins')[0]!.query.offset).toBe('50')
    await t.user.click(screen.getByRole('combobox', { name: 'Status' }))
    await t.user.click(screen.getByRole('option', { name: 'Active' }))
    await waitFor(() => expect(t.router.state.location.search).toBe('?status=active'))
  })

  it('shows no pager when everything fits', async () => {
    setup()
    await table()
    expect(screen.queryByRole('navigation', { name: 'Pages of admins' })).toBeNull()
  })
})
