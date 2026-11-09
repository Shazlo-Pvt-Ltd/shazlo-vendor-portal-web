import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '../test/render'

describe('A-02 Home', () => {
  it('shows the module cards a vendor_reviewer can use and hides Admins & roles', async () => {
    renderRoute('/', { as: 'reviewer' })
    expect(await screen.findByRole('heading', { name: 'Home', level: 1 })).toBeTruthy()
    expect(screen.getByText('Priya Mehta · vendor_reviewer')).toBeTruthy()

    const card = screen.getByRole('article', { name: 'Vendors' })
    expect(await within(card).findByText('14')).toBeTruthy()
    expect(within(card).getByText('Waiting')).toBeTruthy()
    expect(within(card).getByText('1 d')).toBeTruthy()
    expect(within(card).getByText('11')).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Open review queue' }).getAttribute('href')).toBe('/vendors/queue')
    expect(screen.getByText('Other services add their admin UI here')).toBeTruthy()

    expect(screen.getByText('1 failed')).toBeTruthy()
    expect(screen.getByText(/One product\.published event is out of retries and needs a look\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open publishing status' }).getAttribute('href')).toBe('/vendors/publishing')
    expect(screen.getByText('Ajrakh Block-Print Kurta · Kalki Studio')).toBeTruthy()
    expect(screen.getByText('More info requested')).toBeTruthy()

    const nav = screen.getByRole('navigation', { name: 'Shazlo One' })
    expect(within(nav).getByRole('link', { name: /Vendors/ })).toBeTruthy()
    expect(within(nav).queryByRole('link', { name: 'Admins & roles' })).toBeNull()
    expect(within(nav).queryByText('Administration')).toBeNull()
  })

  it('shows Administration to a super_admin', async () => {
    renderRoute('/', { as: 'super' })
    const nav = await screen.findByRole('navigation', { name: 'Shazlo One' })
    expect(within(nav).getByRole('link', { name: 'Admins & roles' })).toBeTruthy()
  })

  it('signs out from the account footer', async () => {
    renderRoute('/', { as: 'reviewer' })
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Sign in to Shazlo One' })).toBeTruthy()
  })

  it('sends a vendor_reviewer away from /admins', async () => {
    const { router } = renderRoute('/admins', { as: 'reviewer' })
    expect(await screen.findByRole('heading', { name: 'Home', level: 1 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/')
  })
})
