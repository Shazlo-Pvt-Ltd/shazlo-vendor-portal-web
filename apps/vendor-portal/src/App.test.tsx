import { render, screen } from '@testing-library/react'
import { useTheme } from '@mui/material'
import { describe, expect, it, vi } from 'vitest'
import { Providers } from './app/Providers'
import { App } from './App'

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

  it('shows the app when the API URL is valid', () => {
    vi.stubEnv('VITE_VENDOR_API_URL', 'http://localhost:8002')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy()
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
