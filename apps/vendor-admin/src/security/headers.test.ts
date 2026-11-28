// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { readEnv } from '../config/env'
import { CLOUDINARY_CDN_ORIGIN, contentSecurityPolicy, PLACEHOLDER_API_ORIGIN, PLACEHOLDER_SHELL_ORIGIN, securityHeaders, vercelHeaders, type HeaderOptions } from './headers'

const directives = (policy: string) => Object.fromEntries(policy.split('; ').map((d) => { const [name, ...values] = d.split(' '); return [name!, values] }))
const production: HeaderOptions = { mode: 'production', shellOrigin: 'https://one.shazlo.store', apiOrigin: 'https://vendor-admin-api.shazlo.store' }

describe('the Content-Security-Policy', () => {
  it.each(['production', 'preview', 'development'] as const)('lets only Shazlo One frame the module (%s)', (mode) => {
    expect(directives(contentSecurityPolicy({ ...production, mode }))['frame-ancestors']).toEqual(['https://one.shazlo.store'])
    // X-Frame-Options cannot name one origin, so it is left to frame-ancestors.
    expect(securityHeaders({ ...production, mode })['X-Frame-Options']).toBeUndefined()
  })

  it('calls only vendor-api’s admin app, frames nothing and runs no inline script', () => {
    const policy = directives(contentSecurityPolicy(production))
    expect(policy['connect-src']).toEqual(['https://vendor-admin-api.shazlo.store'])
    expect(policy['script-src']).toEqual(["'self'"])
    expect(policy['frame-src']).toEqual(["'none'"])
    expect(policy['object-src']).toEqual(["'none'"])
    expect(policy['form-action']).toEqual(["'self'"])
    expect(policy['img-src']).toEqual(["'self'", CLOUDINARY_CDN_ORIGIN])
    expect(contentSecurityPolicy(production)).toMatch(/upgrade-insecure-requests$/)
  })

  it('allows the mock’s data: swatches outside production only', () => {
    expect(directives(contentSecurityPolicy({ ...production, mode: 'preview' }))['img-src']).toContain('data:')
    expect(directives(contentSecurityPolicy(production))['img-src']).not.toContain('data:')
  })

  it('never sends a referrer', () => {
    expect(securityHeaders(production)['Referrer-Policy']).toBe('no-referrer')
  })
})

describe('vercel.json', () => {
  const committed = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as { headers: unknown }

  it('holds the headers written from the one policy, for the placeholder origins', () => {
    expect(committed.headers).toEqual(vercelHeaders({ shellOrigin: PLACEHOLDER_SHELL_ORIGIN, apiOrigin: PLACEHOLDER_API_ORIGIN }))
  })

  it('lets the shell, and only the shell, read the manifest', () => {
    const manifest = vercelHeaders(production).find((rule) => rule.source === '/shazlo-module.json')!
    expect(manifest.headers).toContainEqual({ key: 'Access-Control-Allow-Origin', value: 'https://one.shazlo.store' })
  })
})

describe('the settings', () => {
  it('fall back to the shell’s dev server and the mock vendor-api in development', () => {
    expect(readEnv({}, { dev: true })).toEqual({ ok: true, env: { shellOrigin: 'http://localhost:5192', apiOrigin: 'http://localhost:5194' } })
  })

  it('are both required, as exact https origins, for a production build', () => {
    const result = readEnv({}, { dev: false })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.problems).toEqual([
      'VITE_SHELL_ORIGIN is not set. A production build needs it as an exact https origin.',
      'VITE_VENDOR_API_URL is not set. A production build needs it as an exact https origin.',
    ])
    expect(readEnv({ VITE_SHELL_ORIGIN: 'https://one.shazlo.store/', VITE_VENDOR_API_URL: 'https://vendor-admin-api.shazlo.store' }, { dev: false })).toEqual({ ok: true, env: { shellOrigin: 'https://one.shazlo.store', apiOrigin: 'https://vendor-admin-api.shazlo.store' } })
  })

  it.each([
    ['a wildcard', '*', /not a wildcard/],
    ['a wildcard host', 'https://*.shazlo.store', /not a wildcard/],
    ['plain http', 'http://one.shazlo.store', /must use https/],
    ['a path', 'https://one.shazlo.store/app', /without a path/],
    ['credentials', 'https://u:p@one.shazlo.store', /user name or password/],
    // Each would end frame-ancestors and start another directive.
    ['a semicolon in the host', 'https://one.shazlo.store;script-src', /letters, digits, dots and hyphens/],
    ['a space in the host', 'https://one.shazlo.store https://evil.example', /not a valid URL|letters, digits/],
  ])('refuse a shell origin with %s', (_name, value, problem) => {
    const result = readEnv({ VITE_SHELL_ORIGIN: value, VITE_VENDOR_API_URL: 'https://vendor-admin-api.shazlo.store' }, { dev: false })
    expect(!result.ok && result.problems.join(' ')).toMatch(problem)
  })
})

describe('the Vite config', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })
  type Config = { server: { headers: Record<string, string> }; preview: { headers: Record<string, string> } }
  const load = async (env: { mode: string; command: 'serve' | 'build'; isPreview: boolean }) => {
    const { default: config } = await import('../../vite.config')
    return (config as (e: typeof env) => Config)(env)
  }

  it('serves dev and preview with the same policy, framed only by the shell', async () => {
    const config = await load({ mode: 'development', command: 'serve', isPreview: false })
    expect(directives(config.server.headers['Content-Security-Policy']!)['frame-ancestors']).toEqual(['http://localhost:5192'])
    expect(directives(config.server.headers['Content-Security-Policy']!)['connect-src']).toContain('http://localhost:5194')
  })

  it('refuses to build for production without the shell origin and vendor-api', async () => {
    delete process.env.VITE_SHELL_ORIGIN
    delete process.env.VITE_VENDOR_API_URL
    await expect(load({ mode: 'production', command: 'build', isPreview: false })).rejects.toThrow(/VITE_SHELL_ORIGIN is not set/)
    process.env.VITE_SHELL_ORIGIN = 'https://one.shazlo.store;frame-ancestors *'
    process.env.VITE_VENDOR_API_URL = 'https://vendor-admin-api.shazlo.store'
    await expect(load({ mode: 'production', command: 'build', isPreview: false })).rejects.toThrow(/letters, digits, dots and hyphens|wildcard/)
  })
})
