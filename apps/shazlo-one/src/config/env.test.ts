import { describe, expect, it } from 'vitest'
import { readEnv } from './env'

const prod = { dev: false }
const dev = { dev: true }

describe('the mock (fails closed)', () => {
  it('runs in development unless switched off', () => {
    expect(readEnv({}, dev)).toEqual({ ok: true, env: { identityOrigin: null, mock: true } })
    expect(readEnv({ VITE_MOCK_API: 'off' }, dev)).toEqual({ ok: true, env: { identityOrigin: null, mock: false } })
  })

  it('never runs in a production build unless asked for by name', () => {
    expect(readEnv({ VITE_IDENTITY_API_URL: 'https://identity.shazlo.store' }, prod)).toEqual({ ok: true, env: { identityOrigin: 'https://identity.shazlo.store', mock: false } })
    expect(readEnv({ VITE_MOCK_API: 'on' }, prod)).toEqual({ ok: true, env: { identityOrigin: null, mock: true } })
  })

  it.each(['yes', 'true', '1', 'ON', 'of'])('refuses VITE_MOCK_API=%s rather than guess', (value) => {
    expect(readEnv({ VITE_MOCK_API: value, VITE_IDENTITY_API_URL: 'https://identity.shazlo.store' }, prod)).toEqual({ ok: false, problems: ['VITE_MOCK_API must be "on", "off" or not set.'] })
  })
})

describe('VITE_IDENTITY_API_URL', () => {
  it('is required for a production build that is not a demo', () => {
    const result = readEnv({}, prod)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.problems[0]).toMatch(/VITE_IDENTITY_API_URL is not set/)
    expect(readEnv({ VITE_MOCK_API: 'off' }, prod).ok).toBe(false)
  })

  it('may be left out in development, where Vite forwards /v1 to identity-api', () => {
    expect(readEnv({ VITE_MOCK_API: 'off' }, dev)).toEqual({ ok: true, env: { identityOrigin: null, mock: false } })
  })

  it('keeps only the origin of a good value', () => {
    expect(readEnv({ VITE_IDENTITY_API_URL: 'https://identity.shazlo.store/' }, prod)).toMatchObject({ ok: true, env: { identityOrigin: 'https://identity.shazlo.store' } })
    expect(readEnv({ VITE_IDENTITY_API_URL: 'http://localhost:8001', VITE_MOCK_API: 'off' }, dev)).toMatchObject({ ok: true, env: { identityOrigin: 'http://localhost:8001' } })
  })

  it.each([
    ['plain http in production', 'http://identity.shazlo.store', /must use https/],
    ['plain http to another machine in development', 'http://identity.lan:8001', /must use https/],
    ['a path', 'https://identity.shazlo.store/v1', /without a path/],
    ['a query', 'https://identity.shazlo.store/?x=1', /query or a fragment/],
    ['credentials', 'https://user:secret@identity.shazlo.store', /user name or password/],
    ['another scheme', 'ftp://identity.shazlo.store', /must start with https/],
    ['not a URL', 'identity.shazlo.store', /not a valid URL/],
    // Each would end the CSP directive the origin is written into, or start a new one.
    ['a semicolon in the host', 'https://identity.shazlo.store;script-src', /letters, digits, dots and hyphens/],
    ['a comma in the host', 'https://a,b.shazlo.store', /letters, digits, dots and hyphens/],
    ['a quote in the host', "https://a'b.shazlo.store", /letters, digits, dots and hyphens/],
    ['an IPv6 host', 'https://[::1]', /letters, digits, dots and hyphens/],
  ])('refuses %s', (_name, value, problem) => {
    const result = readEnv({ VITE_IDENTITY_API_URL: value, VITE_MOCK_API: 'off' }, value.includes('lan') ? dev : prod)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.problems.join(' ')).toMatch(problem)
  })

  it('never repeats the value in a problem (it could hold a pasted password)', () => {
    const result = readEnv({ VITE_IDENTITY_API_URL: 'https://admin:hunter2-secret@identity.shazlo.store/x' }, prod)
    expect(JSON.stringify(result)).not.toContain('hunter2')
  })
})
