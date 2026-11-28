import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderModule } from '../test/render'

describe('scroll on a new page', { timeout: 30_000 }, () => {
  afterEach(() => vi.restoreAllMocks())

  it('starts a page opened from the shell at the top, but keeps it for tabs and filters', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { router, shell } = renderModule({ route: '/dashboard' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Vendor dashboard' }, { timeout: 10_000 })).toBeInTheDocument()
    expect(scrollTo).not.toHaveBeenCalled()

    shell.navigate('/vendors')
    expect(await screen.findByRole('heading', { level: 1, name: 'Vendors' }, { timeout: 10_000 })).toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)

    // A filter is the same page with a new query: the list stays where the admin was.
    await act(() => router.navigate('/vendors?status=approved'))
    expect(scrollTo).toHaveBeenCalledTimes(1)

    shell.navigate('/publishing')
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(2))
  })

  it('does not scroll for the root redirect (a replace)', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderModule({ route: '/' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Vendor dashboard' }, { timeout: 10_000 })).toBeInTheDocument()
    expect(scrollTo).not.toHaveBeenCalled()
  })
})

describe('module routes', { timeout: 30_000 }, () => {
  it('lands on the vendor dashboard from the module’s root', async () => {
    const { router, shell } = renderModule({ route: '/' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Vendor dashboard' }, { timeout: 10_000 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/dashboard')
    // Replaced, so going back does not bounce through the root again.
    expect(router.state.historyAction).toBe('REPLACE')
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/dashboard', title: 'Dashboard' }))
  })

  it('points an unknown page at the dashboard', async () => {
    renderModule({ route: '/no-such-page' })
    expect(await screen.findByRole('heading', { name: 'We could not find that page' }, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the vendor dashboard' })).toHaveAttribute('href', '/dashboard')
  })
})
