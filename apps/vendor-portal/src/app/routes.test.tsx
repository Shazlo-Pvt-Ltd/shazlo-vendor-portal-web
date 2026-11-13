import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { portalRoutes, routes } from './routes'

function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
}

describe('routes', () => {
  it.each(portalRoutes)('$path shows "$title" and sets the page title', ({ path, title }) => {
    open(path.replace(':productId', '123'))
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy()
    expect(document.title).toBe(`${title} · Shazlo Vendor Portal`)
  })

  it('shows the not-found page for an unknown address', () => {
    open('/no/such/page')
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to the dashboard' }).getAttribute('href')).toBe('/')
  })

  it('knows who may open each route', () => {
    const access = Object.fromEntries(portalRoutes.map((route) => [route.path, route.access]))
    expect(access['/login']).toBe('public')
    expect(access['/signup']).toBe('public')
    expect(access['/']).toBe('authenticated')
    expect(access['/team']).toBe('authenticated')
    expect(portalRoutes.every((route) => route.access === 'public' || route.access === 'authenticated')).toBe(true)
  })

  it('has no duplicate paths', () => {
    const paths = portalRoutes.map((route) => route.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
