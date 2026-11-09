import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/render'

describe('route guard', () => {
  it('sends a signed-out seller to sign in and remembers the page', async () => {
    const { router } = await renderApp({ route: '/products?status=rejected', signedIn: false })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/products?status=rejected')
  })
})

describe('desktop shell', () => {
  it('lists the sections with live counts and marks the current one', async () => {
    await renderApp({ route: '/' })
    const nav = await screen.findByRole('navigation', { name: 'Seller sections' })
    const overview = within(nav).getByRole('link', { name: /Overview/ })
    expect(overview).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(within(nav).getByRole('link', { name: /^Products\s*, 27$/ })).toBeInTheDocument())
    expect(within(nav).getByRole('link', { name: /^Review status\s*, 5 waiting$/ })).toBeInTheDocument()
    for (const name of ['Brand page', 'Bulk import', 'Store settings', 'Team', 'Help & support']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument()
    }
  })

  it('shows the store and the signed-in person, and signs out', async () => {
    const { user, router } = await renderApp({ route: '/' })
    expect(await screen.findByText('Kalki Studio')).toBeInTheDocument()
    expect(screen.getByText('Approved seller')).toBeInTheDocument()
    expect(screen.getByText('Kiran Shah')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
  })

  it('shows setup progress until the seller closes it', async () => {
    const { user } = await renderApp({ route: '/' })
    const banner = await screen.findByRole('status', { name: /4 of 5 set up/ })
    expect(within(banner).getByRole('link', { name: 'Set your return policy' })).toHaveAttribute('href', '/settings')
    await user.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status', { name: /4 of 5 set up/ })).toBeNull()
    expect(localStorage.getItem('shazlo.seller.setup-dismissed.v_kalki')).toBe('1')
  })

  it('lists new review decisions behind the bell', async () => {
    const { user } = await renderApp({ route: '/' })
    const bell = await screen.findByRole('button', { name: /Notifications, \d+ new/ })
    await user.click(bell)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText(/Ajrakh Block-Print Kurta was sent back/)).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'See all review decisions' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument())
  })
})

describe('mobile shell', () => {
  it('puts the five main destinations in a bottom tab bar', async () => {
    await renderApp({ route: '/products', viewport: 'mobile' })
    const tabs = await screen.findByRole('navigation', { name: 'Main' })
    const names = within(tabs).getAllByRole('link').map((l) => l.textContent)
    expect(names).toEqual(['Overview', 'Products', 'Add', 'Review'])
    expect(within(tabs).getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(within(tabs).getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('navigation', { name: 'Seller sections' })).toBeNull()
  })

  it('opens the remaining sections from More', async () => {
    const { user } = await renderApp({ route: '/', viewport: 'mobile' })
    await user.click(await screen.findByRole('button', { name: 'More' }))
    const sheet = await screen.findByRole('dialog', { name: 'More' })
    for (const name of ['Brand page', 'Bulk import', 'Store settings', 'Team', 'Help & support']) {
      expect(within(sheet).getByRole('link', { name })).toBeInTheDocument()
    }
    expect(within(sheet).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
