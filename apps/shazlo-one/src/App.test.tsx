import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('shows what is misconfigured instead of a blank page when the API URL is missing', () => {
    vi.stubEnv('VITE_IDENTITY_API_URL', '')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Shazlo One is misconfigured' })).toBeTruthy()
    expect(screen.getByText('VITE_IDENTITY_API_URL is not set.')).toBeTruthy()
    expect(document.title).toBe('Misconfigured · Shazlo One')
  })

  it('says why a bad API URL is refused, without repeating it', () => {
    vi.stubEnv('VITE_IDENTITY_API_URL', 'https://user:secret@identity.test/v1')
    render(<App />)
    expect(screen.getByText('VITE_IDENTITY_API_URL must not contain a user name or password.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('secret')
  })

  it('renders the empty shell with one h1 and a title when the environment is fine', async () => {
    vi.stubEnv('VITE_IDENTITY_API_URL', 'https://identity.test')
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Shazlo One' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toBe('Shazlo One · Shazlo One')
  })
})
