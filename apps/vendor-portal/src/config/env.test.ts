import { describe, expect, it } from 'vitest'
import { readEnv } from './env'

const dev = { dev: true }
const prod = { dev: false }

function problems(value: string | undefined, options = dev): string[] {
  const result = readEnv({ VITE_VENDOR_API_URL: value }, options)
  return result.ok ? [] : result.problems
}

describe('readEnv', () => {
  it('accepts an https origin and strips a trailing slash', () => {
    expect(readEnv({ VITE_VENDOR_API_URL: 'https://api.shazlo.store/' }, prod)).toEqual({
      ok: true,
      env: { apiUrl: 'https://api.shazlo.store', mockApi: false },
    })
  })

  it('accepts http only in development', () => {
    expect(readEnv({ VITE_VENDOR_API_URL: 'http://localhost:8002' }, dev)).toEqual({
      ok: true,
      env: { apiUrl: 'http://localhost:8002', mockApi: false },
    })
    expect(problems('http://localhost:8002', prod)).toEqual([
      'VITE_VENDOR_API_URL must use https outside development.',
    ])
  })

  it('refuses a missing or empty value', () => {
    expect(problems(undefined)).toEqual(['VITE_VENDOR_API_URL is not set.'])
    expect(problems('')).toEqual(['VITE_VENDOR_API_URL is not set.'])
    expect(problems('   ')).toEqual(['VITE_VENDOR_API_URL is not set.'])
  })

  it('refuses what is not a URL', () => {
    expect(problems('not a url')).toEqual(['VITE_VENDOR_API_URL is not a valid URL.'])
    // "localhost:8002" parses as the scheme "localhost:", so it is refused as a scheme.
    expect(problems('localhost:8002')).toContain('VITE_VENDOR_API_URL must start with http:// or https://.')
  })

  it('refuses other schemes', () => {
    expect(problems('ftp://api.example.com')).toEqual(['VITE_VENDOR_API_URL must start with http:// or https://.'])
    expect(problems('javascript:alert(1)')).toContain('VITE_VENDOR_API_URL must start with http:// or https://.')
  })

  it('refuses credentials, a path, a query or a fragment', () => {
    expect(problems('https://user:secret@api.example.com')).toEqual([
      'VITE_VENDOR_API_URL must not contain a user name or password.',
    ])
    expect(problems('https://api.example.com/v1')).toHaveLength(1)
    expect(problems('https://api.example.com/?a=1')).toHaveLength(1)
    expect(problems('https://api.example.com/#x')).toHaveLength(1)
  })

  it('runs against the real API unless the demo mock API is switched on', () => {
    expect(readEnv({ VITE_VENDOR_API_URL: 'https://api.shazlo.store' }, prod)).toEqual({
      ok: true,
      env: { apiUrl: 'https://api.shazlo.store', mockApi: false },
    })
    expect(readEnv({ VITE_VENDOR_API_URL: 'https://api.shazlo.store', VITE_MOCK_API: 'off' }, prod)).toMatchObject({
      ok: true,
      env: { mockApi: false },
    })
    expect(readEnv({ VITE_VENDOR_API_URL: 'https://demo-api.shazlo.invalid', VITE_MOCK_API: 'on' }, prod)).toEqual({
      ok: true,
      env: { apiUrl: 'https://demo-api.shazlo.invalid', mockApi: true },
    })
  })

  it('still checks the API URL in demo mode', () => {
    const result = readEnv({ VITE_MOCK_API: 'on' }, prod)
    expect(result.ok ? [] : result.problems).toEqual(['VITE_VENDOR_API_URL is not set.'])
    const insecure = readEnv({ VITE_MOCK_API: 'on', VITE_VENDOR_API_URL: 'http://demo.example' }, prod)
    expect(insecure.ok).toBe(false)
  })

  it.each(['true', 'ON', '1', 'yes', ' on'])('refuses VITE_MOCK_API=%j instead of guessing', (value) => {
    const result = readEnv({ VITE_VENDOR_API_URL: 'https://api.shazlo.store', VITE_MOCK_API: value }, prod)
    expect(result.ok ? [] : result.problems).toEqual(['VITE_MOCK_API must be on or off.'])
  })

  it('never repeats the value in a problem', () => {
    const all = [
      ...problems('https://user:topsecret@api.example.com/v1?key=abc#frag'),
      ...problems('http://hidden.example.com', prod),
    ].join(' ')
    expect(all).not.toMatch(/topsecret|hidden\.example|key=abc/)
  })
})
