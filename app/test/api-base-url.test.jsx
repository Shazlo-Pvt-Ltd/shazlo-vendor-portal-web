import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SceneWaitlistForm from '../src/components/SceneWaitlistForm'
import RegisterBrand from '../src/components/partner'
import { apiBase, apiUrl } from '../src/config/apiBase'

const LIVE_HOST = 'https://shazlo-waitlist-gtge.onrender.com'

function fillWaitlist() {
  fireEvent.change(screen.getByPlaceholderText('your name'), { target: { value: 'Asha' } })
  fireEvent.change(screen.getByPlaceholderText('your email'), { target: { value: 'asha@example.test' } })
  fireEvent.change(screen.getByPlaceholderText('your city'), { target: { value: 'Delhi' } })
  fireEvent.mouseDown(screen.getByRole('combobox'))
  fireEvent.click(screen.getByRole('option', { name: 'Female' }))
  fireEvent.click(screen.getByRole('button', { name: 'Join Waitlist' }))
}

function fillBrand() {
  for (const [label, value] of [
    ['Brand name', 'Kalki'], ["Founder's name or email ID", 'Kiran'],
    ['Website / Instagram link', 'https://example.test'], ['Contact phone', '+919876543210'], ['Contact email', 'kiran@example.test'],
  ]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
}

afterEach(() => vi.unstubAllEnvs())

describe('API base URL', () => {
  it.each([
    ['http://localhost:5000', 'http://localhost:5000/api/waitlist/add'],
    ['http://localhost:5000/', 'http://localhost:5000/api/waitlist/add'],
    ['http://localhost:5000///', 'http://localhost:5000/api/waitlist/add'],
    ['  http://localhost:5000  ', 'http://localhost:5000/api/waitlist/add'],
    ['https://x.test:8443', 'https://x.test:8443/api/waitlist/add'],
    ['https://x.test/prefix/', 'https://x.test/prefix/api/waitlist/add'],
    // A value that still ends in /api (the shape the old fallback and the old .env had) must not become /api/api.
    ['https://x.test/api', 'https://x.test/api/waitlist/add'],
    ['https://x.test/api/', 'https://x.test/api/waitlist/add'],
    ['https://x.test//api', 'https://x.test/api/waitlist/add'],
    ['https://x.test//api/', 'https://x.test/api/waitlist/add'],
    ['https://x.test/API', 'https://x.test/api/waitlist/add'],
    ['https://x.test/prefix/api', 'https://x.test/prefix/api/waitlist/add'],
    // A host or path that merely contains "api" is left alone.
    ['https://api.x.test', 'https://api.x.test/api/waitlist/add'],
    ['https://api', 'https://api/api/waitlist/add'],
    ['https://x.test/capi', 'https://x.test/capi/api/waitlist/add'],
  ])('joins %j and a path with exactly one slash', (base, expected) => {
    vi.stubEnv('VITE_API_URL', base)
    expect(apiUrl('/api/waitlist/add')).toBe(expected)
    expect(apiUrl('api/waitlist/add')).toBe(expected)
    expect(apiUrl('//api/waitlist/add')).toBe(expected)
  })

  it.each(['', '   ', '/', ' / '])(
    'falls back to the hosted waitlist service when VITE_API_URL is %j',
    (value) => {
      vi.stubEnv('VITE_API_URL', value)
      expect(apiBase()).toBe(LIVE_HOST)
      expect(apiUrl('/api/waitlist/add')).toBe(`${LIVE_HOST}/api/waitlist/add`)
      expect(apiUrl('/api/register-brand')).toBe(`${LIVE_HOST}/api/register-brand`)
    },
  )

  it('has no "//api" anywhere in app/src', () => {
    const sources = import.meta.glob('../src/**/*.{js,jsx,ts,tsx,mjs,cjs,json,css,html}', { query: '?raw', import: 'default', eager: true })
    const files = Object.keys(sources)
    // The scan must really be looking at the files that build URLs; an empty glob would pass for the wrong reason.
    expect(files).toEqual(expect.arrayContaining([
      '../src/config/apiBase.js',
      '../src/services/api.js',
      '../src/components/SceneWaitlistForm.jsx',
      '../src/components/partner.jsx',
    ]))
    const offenders = files.filter((file) => /(?<!:)\/\/api(?![.\w-])/.test(sources[file]))
    expect(offenders).toEqual([])
  })

  it('has no doubled slash after a ${template} in app/src', () => {
    // `${base}//api/...` builds the URL at run time, so the "//api" text scan above cannot see it.
    const sources = import.meta.glob('../src/**/*.{js,jsx,ts,tsx,mjs,cjs}', { query: '?raw', import: 'default', eager: true })
    const offenders = Object.keys(sources).filter((file) => /\$\{[^}]*\}\/\/(?!\/)/.test(sources[file]))
    expect(offenders).toEqual([])
  })

  it('names the backend host in config/apiBase.js only', () => {
    const sources = import.meta.glob('../src/**/*.{js,jsx,ts,tsx,mjs,cjs,json,html}', { query: '?raw', import: 'default', eager: true })
    const offenders = Object.keys(sources).filter(
      (file) => file !== '../src/config/apiBase.js' && /shazlo-waitlist|onrender\.com/.test(sources[file]),
    )
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

  it('posts to the hosted service, with one slash, when VITE_API_URL is not set', async () => {
    vi.stubEnv('VITE_API_URL', '')
    fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    render(<SceneWaitlistForm />)
    fillWaitlist()
    await screen.findByRole('button', { name: 'Welcome' })
    expect(fetch.mock.calls[0][0]).toBe(`${LIVE_HOST}/api/waitlist/add`)
  })

  it('does not double the /api of a VITE_API_URL that already ends in /api', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/api')
    fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    render(<SceneWaitlistForm />)
    fillWaitlist()
    await screen.findByRole('button', { name: 'Welcome' })
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.test/api/waitlist/add')
  })
})

describe('brand registration request URL', () => {
  it('posts to <base>/api/register-brand', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/')
    fetch.mockResolvedValueOnce({ ok: true, status: 201 })
    render(<RegisterBrand />)
    fillBrand()
    await screen.findByText('Your brand has been registered successfully.')
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.test/api/register-brand')
  })

  it('posts to the hosted service when VITE_API_URL is not set', async () => {
    vi.stubEnv('VITE_API_URL', '')
    fetch.mockResolvedValueOnce({ ok: true, status: 201 })
    render(<RegisterBrand />)
    fillBrand()
    await screen.findByText('Your brand has been registered successfully.')
    expect(fetch.mock.calls[0][0]).toBe(`${LIVE_HOST}/api/register-brand`)
  })
})

describe('Axios client base URL', () => {
  // services/api.js reads the variable once, when it is first imported, so each case imports a fresh copy.
  beforeEach(() => vi.resetModules())

  it.each([
    ['https://api.example.test', 'https://api.example.test/api'],
    ['https://api.example.test/', 'https://api.example.test/api'],
    ['https://api.example.test/api', 'https://api.example.test/api'],
    ['', `${LIVE_HOST}/api`],
  ])('with VITE_API_URL %j it calls %s', async (value, baseURL) => {
    vi.stubEnv('VITE_API_URL', value)
    const { default: api } = await import('../src/services/api')
    expect(api.defaults.baseURL).toBe(baseURL)
    expect(api.getUri({ url: '/health' })).toBe(`${baseURL}/health`)
    expect(api.getUri({ url: '/preregister/register' })).toBe(`${baseURL}/preregister/register`)
  })
})
