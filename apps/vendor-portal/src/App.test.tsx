import { render, screen } from '@testing-library/react'
import { useTheme } from '@mui/material'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Providers } from './app/Providers'
import { resetApiClient } from './api/instance'
import { sessionBody } from './session/testing'
import { App } from './App'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetApiClient()
})
afterAll(() => server.close())

describe('App', () => {
  it('shows what is wrong, not a blank page, when the API URL is missing', () => {
    vi.stubEnv('VITE_VENDOR_API_URL', '')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'The portal is misconfigured' })).toBeTruthy()
    expect(screen.getByText('VITE_VENDOR_API_URL is not set.')).toBeTruthy()
  })

  it('does not echo a bad value back, even one with a password in it', () => {
    vi.stubEnv('VITE_VENDOR_API_URL', 'https://user:topsecret@api.example.com/v1')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'The portal is misconfigured' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('topsecret')
  })

  it('shows the app when the API URL is valid and the session is restored', async () => {
    vi.stubEnv('VITE_VENDOR_API_URL', 'http://localhost:8002')
    server.use(http.post('http://localhost:8002/v1/auth/refresh', () => HttpResponse.json(sessionBody())))
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy()
    expect(screen.queryByText('The portal is misconfigured')).toBeNull()
  })
})

describe('Providers', () => {
  it('applies the shared Shazlo theme', () => {
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
