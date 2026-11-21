import { createMessage } from '@shazlo/shell-protocol'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderShell } from '../test/render'

// A phone-sized viewport: matchMedia answers min/max-width queries for a 390 px screen, so
// useMediaQuery(theme.breakpoints.down(...)) sees a phone.
const WIDTH = 390
const original = window.matchMedia
function px(query: string, key: 'min' | 'max') {
  const m = new RegExp(`${key}-width:\\s*([\\d.]+)px`).exec(query)
  return m ? Number(m[1]) : null
}
beforeEach(() => {
  window.matchMedia = (query: string) => {
    const min = px(query, 'min')
    const max = px(query, 'max')
    return {
      matches: (min === null || WIDTH >= min) && (max === null || WIDTH <= max),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }
  }
})
afterEach(() => {
  window.matchMedia = original
})

// While the drawer is open the page behind it (menu button included) is aria-hidden.
const menuButton = () => screen.getByRole('button', { name: 'Menu', hidden: true })
const sections = () => screen.queryByRole('navigation', { name: 'Shazlo One sections' })

describe('phone shell: top bar and menu drawer', () => {
  it('hides the sidebar behind a menu button', async () => {
    await renderShell({ route: '/' })
    await screen.findByRole('heading', { level: 1 })
    const button = menuButton()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls')
    expect(sections()).toBeNull()
    expect(screen.getByRole('banner')).toContainElement(screen.getByRole('img', { name: 'Shazlo' }))
  })

  it('opens the same navigation in a drawer, and a link navigates and closes it', async () => {
    const { user, router } = await renderShell({ route: '/' })
    await screen.findByRole('heading', { level: 1 })
    await user.click(menuButton())
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true')
    const nav = await screen.findByRole('navigation', { name: 'Shazlo One sections' })
    expect(document.getElementById(menuButton().getAttribute('aria-controls')!)).toContainElement(nav)
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(within(nav).getByRole('link', { name: /^Vendors\s*, 14 waiting$/ })).toBeInTheDocument())
    expect(screen.getByText('Naman Sinha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()

    await user.click(within(nav).getByRole('link', { name: 'Admins & roles' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admins'))
    await waitFor(() => expect(sections()).toBeNull())
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape and with the close button', async () => {
    const { user } = await renderShell({ route: '/' })
    await screen.findByRole('heading', { level: 1 })
    await user.click(menuButton())
    await screen.findByRole('navigation', { name: 'Shazlo One sections' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(sections()).toBeNull())
    await user.click(menuButton())
    await screen.findByRole('navigation', { name: 'Shazlo One sections' })
    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    await waitFor(() => expect(sections()).toBeNull())
  })

  it('signs out from the drawer', async () => {
    const { user, router } = await renderShell({ route: '/' })
    await screen.findByRole('heading', { level: 1 })
    await user.click(menuButton())
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
  })

  it('shows only the last breadcrumb', async () => {
    await renderShell({ route: '/vendors/queue' })
    const iframe = (await screen.findByTitle('Vendors')) as HTMLIFrameElement
    const send = (data: unknown) => act(() => void window.dispatchEvent(new MessageEvent('message', { data, origin: 'http://localhost:5193', source: iframe.contentWindow })))
    send(createMessage('ready', { module: 'vendor-admin', supportedVersions: [1], moduleVersion: '0.1.0' }))
    send(createMessage('title', { path: '/review/product/p_ajrakh', title: 'Ajrakh Block-Print Kurta' }))
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    await waitFor(() => expect(crumbs).toHaveTextContent('Ajrakh Block-Print Kurta'))
    expect(within(crumbs).queryByRole('link', { name: 'Vendors' })).toBeNull()
  })
})

describe('phone Admins & roles', () => {
  it('lists people as cards with roles, status and actions', async () => {
    const { user } = await renderShell({ route: '/admins' })
    await screen.findByRole('heading', { level: 1, name: 'Admins & roles' })
    const list = await screen.findByRole('list', { name: 'Admins' })
    expect(screen.queryByRole('table')).toBeNull()
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4))
    const naman = within(list).getAllByRole('listitem').find((li) => li.textContent?.includes('Naman Sinha'))!
    expect(naman).toHaveTextContent('naman@shazlo.store')
    expect(naman).toHaveTextContent('Super admin')
    expect(naman.querySelector('[data-status]')).toHaveAttribute('data-status', 'live')
    await user.click(within(naman).getByRole('button', { name: 'Actions for Naman Sinha' }))
    await user.click(await screen.findByRole('menuitem', { name: /^Edit roles/ }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.closest('.MuiDialog-paperFullScreen')).not.toBeNull()
  })

  it('opens Invite admin full screen', async () => {
    const { user } = await renderShell({ route: '/admins' })
    await user.click(await screen.findByRole('button', { name: 'Invite admin' }))
    const dialog = await screen.findByRole('dialog', { name: 'Invite an admin' })
    expect(dialog.closest('.MuiDialog-paperFullScreen')).not.toBeNull()
  })
})
