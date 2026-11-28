import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { entry } from '../modules/testing'
import { makeStore, sessionBody } from '../session/testing'
import { useApiServer } from '../test/msw'
import { renderRoute } from '../test/renderRoute'
import { setViewport } from '../test/viewport'
import { pageOf } from './ShellLayout'

useApiServer()

const MODULES = [
  entry({ id: 'vendor-admin', title: 'Vendor admin', description: 'Review vendor applications.', roles: ['vendor_reviewer'] }),
  entry({
    id: 'catalog',
    title: 'Catalog',
    description: 'Edit the catalog.',
    origin: 'https://catalog.shazlo.test',
    url: 'https://catalog.shazlo.test/',
    roles: ['catalog_editor'],
  }),
]

async function openAs(roles: string[], path = '/', width = 1280, modules = MODULES) {
  setViewport(width)
  const body = sessionBody({ roles })
  const store = makeStore({ refresh: async () => body, fetchMe: async () => body.admin }).store
  const router = renderRoute(path, { store, modules })
  await screen.findByRole('heading', { level: 1 })
  return { router, store, user: userEvent.setup() }
}

const navLinks = () => within(screen.getByRole('navigation', { name: 'Modules' })).getAllByRole('link').map((link) => link.textContent)
const cards = () => within(screen.getByRole('list', { name: 'Modules' })).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)

describe('a super admin', () => {
  it('sees every module and Admins in the navigation, and a card for every module', async () => {
    await openAs(['super_admin'])
    expect(navLinks()).toEqual(['Home', 'Vendor admin', 'Catalog', 'Admins'])
    expect(cards()).toEqual(['Vendor admin', 'Catalog'])
  })

  it('opens any module, and the Admins screens', async () => {
    const { router } = await openAs(['super_admin'], '/m/catalog')
    expect(screen.getByRole('heading', { level: 1, name: 'Catalog' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/m/catalog')
    await act(async () => {
      await router.navigate('/admins')
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Admins' })).toBeTruthy()
  })
})

describe('a vendor reviewer', () => {
  it('sees only the module their role opens, and no Admins', async () => {
    await openAs(['vendor_reviewer'])
    expect(navLinks()).toEqual(['Home', 'Vendor admin'])
    expect(cards()).toEqual(['Vendor admin'])
    expect(screen.queryByText('Catalog')).toBeNull()
  })

  it('opens their module', async () => {
    await openAs(['vendor_reviewer'], '/m/vendor-admin')
    expect(screen.getByRole('heading', { level: 1, name: 'Vendor admin' })).toBeTruthy()
  })

  it('gets the 403 page, not the module, for a module their role does not open', async () => {
    const { router } = await openAs(['vendor_reviewer'], '/m/catalog')
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access to this module" })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/m/catalog')
    expect(screen.queryByRole('heading', { name: 'Catalog' })).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('also gets the 403 page for a deep path inside a module they may not open', async () => {
    await openAs(['vendor_reviewer'], '/m/catalog/products/42?tab=2')
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access to this module" })).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('gets the 403 page for /admins', async () => {
    await openAs(['vendor_reviewer'], '/admins')
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access to this page" })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Admins' })).toBeNull()
  })
})

describe('an admin whose roles open no module', () => {
  it('sees an explanation instead of an empty page, and no module links', async () => {
    await openAs(['unrelated_role'])
    expect(screen.getByRole('heading', { level: 2, name: 'There is nothing for you to open yet' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/Your roles do not open any module/)
    expect(navLinks()).toEqual(['Home'])
    expect(screen.queryByRole('list', { name: 'Modules' })).toBeNull()
  })

  it('is told when no modules exist at all, even for a super admin', async () => {
    await openAs(['super_admin'], '/', 1280, [])
    expect(screen.getByRole('status').textContent).toMatch(/No modules are set up yet/)
  })

  it('gets the 403 page, not the module, when typing a module address', async () => {
    await openAs(['unrelated_role'], '/m/vendor-admin')
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access to this module" })).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
  })
})

describe('an unknown module', () => {
  it.each([['super_admin'], ['vendor_reviewer']])('is "not found" for %s, inside the shell, with no frame', async (role) => {
    await openAs([role], '/m/nope')
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(navLinks()[0]).toBe('Home')
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('does not reveal whether a module exists the admin may not open: only the 403 differs, never the module', async () => {
    await openAs(['unrelated_role'], '/m/nope')
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
  })
})

describe('roles are read again when the session renews', () => {
  it('shows a module as soon as the admin gains its role, with no new sign-in', async () => {
    let roles = ['unrelated_role']
    setViewport(1280)
    const store = makeStore({
      refresh: async () => sessionBody({ roles }),
      fetchMe: async () => sessionBody({ roles }).admin,
    }).store
    renderRoute('/', { store, modules: MODULES })
    await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })
    expect(navLinks()).toEqual(['Home'])
    roles = ['vendor_reviewer']
    await act(async () => {
      await store.renew()
    })
    await waitFor(() => expect(navLinks()).toEqual(['Home', 'Vendor admin']))
    roles = ['unrelated_role']
    await act(async () => {
      await store.renew()
    })
    await waitFor(() => expect(navLinks()).toEqual(['Home']))
  })
})

describe('navigation on a desktop', () => {
  it('is always visible, has no menu button, and marks the current page', async () => {
    await openAs(['super_admin'], '/m/vendor-admin')
    expect(screen.queryByRole('button', { name: 'Open the menu' })).toBeNull()
    const current = within(screen.getByRole('navigation', { name: 'Modules' }))
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual(['Vendor admin'])
  })

  it('goes to a module when its link is used', async () => {
    const { router, user } = await openAs(['super_admin'])
    await user.click(within(screen.getByRole('navigation', { name: 'Modules' })).getByRole('link', { name: 'Catalog' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Catalog' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/m/catalog')
  })

  it('goes to a module from its card on the home page', async () => {
    const { router, user } = await openAs(['vendor_reviewer'])
    await user.click(within(screen.getByRole('list', { name: 'Modules' })).getByRole('link', { name: /Vendor admin/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Vendor admin' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/m/vendor-admin')
  })
})

describe.each([
  ['a phone (320 px)', 320],
  ['a tablet (768 px, below the desktop breakpoint)', 768],
])('navigation on %s', (_name, width) => {
  it('is hidden behind a menu button, which opens it', async () => {
    const { user } = await openAs(['super_admin'], '/', width)
    expect(screen.queryByRole('navigation', { name: 'Modules' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open the menu' }))
    expect(await screen.findByRole('navigation', { name: 'Modules' })).toBeTruthy()
    expect(navLinks()).toEqual(['Home', 'Vendor admin', 'Catalog', 'Admins'])
  })

  it('closes when a module is chosen, and shows it', async () => {
    const { router, user } = await openAs(['super_admin'], '/', width)
    await user.click(screen.getByRole('button', { name: 'Open the menu' }))
    await user.click(await screen.findByRole('link', { name: 'Catalog' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Catalog' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/m/catalog')
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Modules' })).toBeNull())
  })

  it('closes with Escape', async () => {
    const { user } = await openAs(['super_admin'], '/', width)
    await user.click(screen.getByRole('button', { name: 'Open the menu' }))
    await screen.findByRole('navigation', { name: 'Modules' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Modules' })).toBeNull())
  })

  it('lists only what the role allows', async () => {
    const { user } = await openAs(['vendor_reviewer'], '/', width)
    await user.click(screen.getByRole('button', { name: 'Open the menu' }))
    await screen.findByRole('navigation', { name: 'Modules' })
    expect(navLinks()).toEqual(['Home', 'Vendor admin'])
  })
})

describe('accessibility', () => {
  it('starts with a skip link to the one main region, which can take focus', async () => {
    const { user } = await openAs(['super_admin'])
    await user.tab()
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(document.activeElement).toBe(skip)
    const main = screen.getByRole('main')
    expect(main.id).toBe('main-content')
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(main)
  })

  it('has a banner with the app name and the account menu', async () => {
    await openAs(['super_admin'])
    const banner = screen.getByRole('banner')
    expect(within(banner).getByText('Shazlo-One')).toBeTruthy()
    expect(within(banner).getByRole('button', { name: 'Asha Admin' })).toBeTruthy()
  })

  it('does not steal focus on the first page', async () => {
    await openAs(['super_admin'])
    expect(document.activeElement).toBe(document.body)
  })

  it('moves focus to the new page heading after navigating', async () => {
    const { user } = await openAs(['super_admin'])
    await user.click(within(screen.getByRole('navigation', { name: 'Modules' })).getByRole('link', { name: 'Catalog' }))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Catalog' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('moves focus to the heading when the admin goes from one module to another', async () => {
    const { router } = await openAs(['super_admin'], '/m/vendor-admin')
    await act(() => router.navigate('/m/catalog'))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Catalog' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('leaves focus alone when the path changes inside one module (focus may be in its frame)', async () => {
    const { router } = await openAs(['super_admin'], '/m/vendor-admin')
    // Stands in for the module's frame, which has focus while the admin works in the module.
    const inModule = document.createElement('button')
    screen.getByRole('main').append(inModule)
    inModule.focus()
    await act(() => router.navigate('/m/vendor-admin/vendors/42'))
    await act(() => router.navigate('/m/vendor-admin/vendors'))
    expect(screen.getByRole('heading', { level: 1, name: 'Vendor admin' })).toBeTruthy()
    expect(document.activeElement).toBe(inModule)
  })

  it.each([
    ['/m/vendor-admin', '/m/vendor-admin'],
    ['/m/vendor-admin/', '/m/vendor-admin'],
    ['/m/vendor-admin/vendors/42', '/m/vendor-admin'],
    ['/m/catalog', '/m/catalog'],
    ['/admins', '/admins'],
    ['/mod/x', '/mod/x'],
    ['/', '/'],
  ])('treats %j as the page %j when deciding whether to move focus', (path, page) => {
    expect(pageOf(path)).toBe(page)
  })

  it.each([
    ['/', 'Shazlo-One', 'Home · Shazlo-One'],
    ['/m/vendor-admin', 'Vendor admin', 'Vendor admin · Shazlo-One'],
    ['/m/vendor-admin/deep/path', 'Vendor admin', 'Vendor admin · Shazlo-One'],
    ['/admins', 'Admins', 'Admins · Shazlo-One'],
    ['/change-password', 'Change your password', 'Change password · Shazlo-One'],
    ['/m/nope', 'Page not found', 'Page not found · Shazlo-One'],
  ])('%s has exactly one h1 and sets the page title', async (path, heading, title) => {
    await openAs(['super_admin'], path)
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(document.title).toBe(title)
  })
})

describe('return-to for module addresses', () => {
  it('brings a signed-out admin back to the module path they typed', async () => {
    setViewport(1280)
    const store = makeStore({ refresh: async () => { throw new Error('signed out') } }).store
    const router = renderRoute('/m/vendor-admin/orders/9?tab=2', { store, modules: MODULES })
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(new URLSearchParams(router.state.location.search).get('return-to')).toBe('/m/vendor-admin/orders/9?tab=2')
  })
})
