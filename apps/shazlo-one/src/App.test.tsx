import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { Providers } from './app/Providers'
import { routes } from './app/routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('the empty shell', () => {
  it('says what is wrong when the API URL is missing, instead of a blank page', () => {
    vi.stubEnv('VITE_IDENTITY_API_URL', '')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'The shell is misconfigured' })).toBeTruthy()
    expect(screen.getByText('VITE_IDENTITY_API_URL is not set.')).toBeTruthy()
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
  })
})
