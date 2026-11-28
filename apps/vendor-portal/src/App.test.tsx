import { useTheme } from '@mui/material'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { Providers } from './app/Providers'
import { routes } from './app/routes'
import { renderPortal, stubApi, TEST_API } from './session/renderPortal'
import { sessionBody } from './session/testing'

const MISCONFIGURED = 'Shazlo Seller is not set up correctly'

function renderWithEnv(env: Record<string, string>) {
  stubApi()
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  render(<App router={createMemoryRouter(routes, { initialEntries: ['/'] })} />)
}

describe('App', () => {
  it('shows what is wrong, not a blank page, when the API URL is missing', () => {
    renderWithEnv({ VITE_VENDOR_API_URL: '' })
    expect(screen.getByRole('heading', { level: 1, name: MISCONFIGURED })).toBeInTheDocument()
    expect(screen.getByText('VITE_VENDOR_API_URL is not set.')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('does not echo a bad value back, even one with a password in it', () => {
    renderWithEnv({ VITE_VENDOR_API_URL: 'https://user:topsecret@api.example.com/v1' })
    expect(screen.getByRole('heading', { level: 1, name: MISCONFIGURED })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('topsecret')
  })

  it('refuses a demo switch it does not understand', () => {
    renderWithEnv({ VITE_VENDOR_API_URL: 'https://api.example.com', VITE_MOCK_API: 'true' })
    expect(screen.getByText('VITE_MOCK_API must be on or off.')).toBeInTheDocument()
  })

  it('makes no call to any server when misconfigured', () => {
    const requests = stubApi()
    vi.stubEnv('VITE_VENDOR_API_URL', 'not a url')
    render(<App router={createMemoryRouter(routes, { initialEntries: ['/'] })} />)
    expect(screen.getByRole('heading', { level: 1, name: MISCONFIGURED })).toBeInTheDocument()
    expect(requests).toEqual([])
  })

  it('shows the app when the API URL is valid and the session is restored from the cookie', async () => {
    const { requests } = renderPortal({
      session: 'real',
      handlers: [http.post(`${TEST_API}/v1/auth/refresh`, () => HttpResponse.json(sessionBody()))],
    })
    expect(await screen.findByRole('navigation', { name: 'Seller sections' })).toBeInTheDocument()
    expect(screen.queryByText(MISCONFIGURED)).toBeNull()
    const refresh = requests.find((r) => r.url === `${TEST_API}/v1/auth/refresh`)
    expect(refresh?.credentials).toBe('include')
  })
})

describe('Providers', () => {
  it('applies the shared Shazlo theme', () => {
    stubApi()
    function Probe() {
      const theme = useTheme()
      return <p data-testid="primary">{theme.palette.primary.main}</p>
    }
    render(
      <Providers>
        <Probe />
      </Providers>,
    )
    expect(screen.getByTestId('primary').textContent).toBe('#FAB62A')
  })
})
