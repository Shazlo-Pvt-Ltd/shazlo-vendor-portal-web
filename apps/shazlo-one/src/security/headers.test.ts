// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRegistry, registryCsp } from '@shazlo/shell-protocol'
import { contentSecurityPolicy, HSTS, PLACEHOLDER_IDENTITY_ORIGIN, securityHeaders, vercelHeaders, type HeaderOptions } from './headers'

const directives = (policy: string) => Object.fromEntries(policy.split('; ').map((d) => { const [name, ...values] = d.split(' '); return [name!, values] }))

const modules = registryCsp(
  parseRegistry(
    [
      { id: 'catalogue', fallbackTitle: 'Catalogue', basePath: '/catalogue', url: 'https://catalogue.shazlo.store/', roles: ['catalogue_editor'], audience: 'catalogue-api', summaryUrl: 'https://catalogue-api.shazlo.store/v1/summary' },
      { id: 'marketing', fallbackTitle: 'Marketing', basePath: '/marketing', url: 'https://marketing.shazlo.store/', roles: ['marketing_editor'], audience: 'marketing-api' },
    ],
    'production',
  ),
)
const production: HeaderOptions = { mode: 'production', identityOrigin: 'https://identity.shazlo.store', frameOrigins: modules.frameSrc, moduleConnectOrigins: modules.connectSrc }

describe('the Content-Security-Policy', () => {
  it.each(['production', 'preview', 'development'] as const)('lets nothing frame the shell (%s)', (mode) => {
    expect(directives(contentSecurityPolicy({ ...production, mode }))['frame-ancestors']).toEqual(["'none'"])
    expect(securityHeaders({ ...production, mode })['X-Frame-Options']).toBe('DENY')
  })

  it('frames only the registered modules, and nothing when there are none', () => {
    expect(directives(contentSecurityPolicy(production))['frame-src']).toEqual(['https://catalogue.shazlo.store', 'https://marketing.shazlo.store'])
    expect(directives(contentSecurityPolicy({ ...production, frameOrigins: [], moduleConnectOrigins: [] }))['frame-src']).toEqual(["'none'"])
  })

  it('lets the shell call only identity-api and the modules’ manifests and summaries', () => {
    expect(directives(contentSecurityPolicy(production))['connect-src']).toEqual([
      'https://identity.shazlo.store',
      'https://catalogue.shazlo.store',
      'https://marketing.shazlo.store',
      'https://catalogue-api.shazlo.store',
    ])
  })

  it('allows its own origin only when identity-api is reached through it (the dev proxy, the mock)', () => {
    expect(directives(contentSecurityPolicy(production))['connect-src']).not.toContain("'self'")
    expect(directives(contentSecurityPolicy({ ...production, identityOrigin: null }))['connect-src']?.[0]).toBe("'self'")
  })

  it('runs no inline script and no eval outside development, and loads nothing from elsewhere', () => {
    for (const mode of ['production', 'preview'] as const) {
      const policy = directives(contentSecurityPolicy({ ...production, mode }))
      expect(policy['script-src']).toEqual(["'self'"])
      expect(policy['default-src']).toEqual(["'self'"])
      expect(policy['img-src']).toEqual(["'self'"])
      expect(policy['font-src']).toEqual(["'self'"])
      expect(policy['object-src']).toEqual(["'none'"])
      expect(policy['base-uri']).toEqual(["'self'"])
      expect(policy['form-action']).toEqual(["'self'"])
      expect(policy['worker-src']).toEqual(["'none'"])
    }
    const dev = directives(contentSecurityPolicy({ ...production, mode: 'development', devOrigin: 'http://localhost:5192' }))
    expect(dev['script-src']).toEqual(["'self'", "'unsafe-inline'"])
    expect(dev['connect-src']).toContain('ws://localhost:5192')
  })

  it('allows a service worker only for the browser mock', () => {
    expect(directives(contentSecurityPolicy({ ...production, mockWorker: true }))['worker-src']).toEqual(["'self'"])
  })

  it('upgrades requests and sends HSTS in production only', () => {
    expect(contentSecurityPolicy(production)).toMatch(/upgrade-insecure-requests$/)
    expect(contentSecurityPolicy({ ...production, mode: 'preview' })).not.toMatch(/upgrade-insecure-requests/)
    expect(securityHeaders(production)['Strict-Transport-Security']).toBe(HSTS)
    expect(securityHeaders({ ...production, mode: 'preview' })['Strict-Transport-Security']).toBeUndefined()
  })
})

describe('vercel.json', () => {
  const committed = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as { headers: unknown; rewrites: unknown }

  it('holds the headers written from the one policy, for the placeholder origin and no modules', () => {
    // `npm run headers:placeholder` rewrites it; the Vercel build writes the real origin and registry.
    expect(committed.headers).toEqual(vercelHeaders({ identityOrigin: PLACEHOLDER_IDENTITY_ORIGIN, frameOrigins: [], moduleConnectOrigins: [] }))
  })

  it('sends every page to the app, so a deep link loads it', () => {
    expect(committed.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }])
  })
})

describe('the dev and preview servers', () => {
  it('send the same headers as production, from the same policy', async () => {
    const { default: config } = await import('../../vite.config')
    const resolved = await (config as (env: { mode: string; command: 'serve'; isPreview: boolean }) => Promise<{ server: { headers: Record<string, string> }; preview: { headers: Record<string, string> } }> | { server: { headers: Record<string, string> }; preview: { headers: Record<string, string> } })({ mode: 'development', command: 'serve', isPreview: false })
    const policy = directives(resolved.server.headers['Content-Security-Policy']!)
    expect(policy['frame-ancestors']).toEqual(["'none'"])
    // The mock registry: the module on 5193, its summaries from the mock backend on 5194.
    expect(policy['frame-src']).toEqual(['http://localhost:5193'])
    expect(policy['connect-src']).toEqual(expect.arrayContaining(["'self'", 'http://localhost:5193', 'http://localhost:5194']))
    expect(Object.keys(resolved.preview.headers).sort()).toEqual(Object.keys(securityHeaders({ ...production, mode: 'preview' })).sort())
    expect(resolved.preview.headers['Content-Security-Policy']).not.toContain("'unsafe-inline' ws:")
  })
})
