import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SceneWaitlistForm from '../src/components/SceneWaitlistForm'
import { apiBase, apiUrl } from '../src/config/apiBase'

function fillWaitlist() {
  fireEvent.change(screen.getByPlaceholderText('your name'), { target: { value: 'Asha' } })
  fireEvent.change(screen.getByPlaceholderText('your email'), { target: { value: 'asha@example.test' } })
  fireEvent.change(screen.getByPlaceholderText('your city'), { target: { value: 'Delhi' } })
  fireEvent.mouseDown(screen.getByRole('combobox'))
  fireEvent.click(screen.getByRole('option', { name: 'Female' }))
  fireEvent.click(screen.getByRole('button', { name: 'Join Waitlist' }))
}

afterEach(() => vi.unstubAllEnvs())

describe('API base URL', () => {
  it.each([
    ['http://localhost:5000', 'http://localhost:5000/api/waitlist/add'],
    ['http://localhost:5000/', 'http://localhost:5000/api/waitlist/add'],
    ['http://localhost:5000///', 'http://localhost:5000/api/waitlist/add'],
  ])('joins %s and a path with exactly one slash', (base, expected) => {
    vi.stubEnv('VITE_API_URL', base)
    expect(apiUrl('/api/waitlist/add')).toBe(expected)
    expect(apiUrl('api/waitlist/add')).toBe(expected)
  })

  it('falls back to a host without a trailing slash when VITE_API_URL is unset', () => {
    vi.stubEnv('VITE_API_URL', '')
    expect(apiBase()).toMatch(/^https:\/\/[^/]+$/)
  })

  it('has no "//api" anywhere in app/src', () => {
    const sources = import.meta.glob('../src/**/*.{js,jsx,css}', { query: '?raw', import: 'default', eager: true })
    const offenders = Object.keys(sources).filter((file) => /(?<!:)\/\/api(?![.\w-])/.test(sources[file]))
    expect(offenders).toEqual([])
  })
})

describe('waitlist form request URL', () => {
  it('posts to <base>/api/waitlist/add and shows the success state on a 2xx', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/')
    fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    render(<SceneWaitlistForm />)
    fillWaitlist()
    expect((await screen.findByRole('button', { name: 'Welcome' })).disabled).toBe(true)
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.test/api/waitlist/add')
  })

  it('shows the error and no success state on a 404', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test')
    fetch.mockResolvedValueOnce({ ok: false, status: 404 })
    render(<SceneWaitlistForm />)
    fillWaitlist()
    expect((await screen.findByRole('alert')).textContent).toMatch(/unable to join the waitlist/i)
    expect(screen.queryByRole('button', { name: 'Welcome' })).toBeNull()
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.test/api/waitlist/add')
  })
})
