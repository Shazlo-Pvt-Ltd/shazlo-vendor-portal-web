import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { Providers } from './app/Providers'
import { RouteError } from './components/RouteError'
import { routes } from './app/routes'
import { AuthProvider } from './session/AuthProvider'
import { makeStore, sessionBody } from './session/testing'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const { store } = makeStore({ fetchMe: async () => sessionBody().admin })
  return render(
    <Providers>
      <AuthProvider store={store}>
        <RouterProvider router={router} />
      </AuthProvider>
    </Providers>,
  )
}

describe('the empty shell', () => {
  it('says what is wrong when the API URL is missing, instead of a blank page', () => {
    vi.stubEnv('VITE_IDENTITY_API_URL', '')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'The shell is misconfigured' })).toBeTruthy()
    expect(screen.getByText('VITE_IDENTITY_API_URL is not set.')).toBeTruthy()
    expect(document.title).toBe('Misconfigured · Shazlo-One')
  })

  it('names a URL that is not allowed without repeating it', () => {
    vi.stubEnv('VITE_IDENTITY_API_URL', 'https://user:secret@identity.test')
    render(<App />)
    expect(screen.getByText(/must not contain a user name or password/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('secret')
  })

  it('shows the home page with one h1 and a page title', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toBe('Home · Shazlo-One')
  })

  it('shows a not-found page, still with one h1, for an unknown address', async () => {
    renderAt('/nowhere')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toBe('Page not found · Shazlo-One')
  })

  it('puts the route error element on every route, so a throwing page never shows a stack trace', () => {
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      expect((route.errorElement as { type?: unknown } | undefined)?.type).toBe(RouteError)
    }
  })
})
