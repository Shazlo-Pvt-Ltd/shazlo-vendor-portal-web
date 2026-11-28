import { describe, expect, it } from 'vitest'
import { MODULES } from '../src/modules/registry'
import { SHELL_DEV_ORIGIN } from './config'
import { frameAncestors, moduleHeaders } from './headers'
import viteConfig from './vite.config'

const SHELL = 'https://one.shazlo.test'

describe('the framing headers', () => {
  it('let only the shell frame the module', () => {
    const headers = moduleHeaders({ shellOrigin: SHELL, development: false })
    expect(headers['Content-Security-Policy']).toBe(`frame-ancestors ${SHELL}`)
  })

  it('add the local shell in development, and list it once when it is the shell', () => {
    expect(frameAncestors(SHELL, true)).toEqual([SHELL, SHELL_DEV_ORIGIN])
    expect(frameAncestors(SHELL_DEV_ORIGIN, true)).toEqual([SHELL_DEV_ORIGIN])
    expect(moduleHeaders({ shellOrigin: SHELL_DEV_ORIGIN, development: true })['Content-Security-Policy']).toBe(
      `frame-ancestors ${SHELL_DEV_ORIGIN}`,
    )
  })

  it('never allow another origin: no wildcard, no self, no none, no scheme-only source', () => {
    for (const development of [true, false]) {
      const policy = moduleHeaders({ shellOrigin: SHELL, development })['Content-Security-Policy']!
      const sources = policy.replace('frame-ancestors ', '').split(' ')
      for (const source of sources) {
        expect(source).toMatch(/^https?:\/\/[a-z0-9.-]+(:\d+)?$/)
      }
      expect(policy).not.toMatch(/\*|'self'|'none'|https?:(\s|$)|data:|blob:/)
      expect(sources).not.toContain('https://evil.example')
    }
  })

  it('send no referrer, and not the older X-Frame-Options (frame-ancestors replaces it)', () => {
    const headers = moduleHeaders({ shellOrigin: SHELL, development: false })
    expect(headers['Referrer-Policy']).toBe('no-referrer')
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('x-frame-options')
  })

  it('are exactly the two headers ADR 0001 names', () => {
    expect(Object.keys(moduleHeaders({ shellOrigin: SHELL, development: false })).sort()).toEqual(['Content-Security-Policy', 'Referrer-Policy'])
  })
})

describe('the module’s dev server', () => {
  const resolve = (env: { command: 'serve' | 'build'; mode: string }) =>
    (viteConfig as unknown as (env: { command: string; mode: string }) => { server: { port: number; strictPort: boolean; headers: Record<string, string> } })(env)

  it('runs on its own port with those headers', () => {
    const { server } = resolve({ command: 'serve', mode: 'development' })
    expect(server.port).toBe(5175)
    expect(server.strictPort).toBe(true)
    expect(server.headers).toEqual(moduleHeaders({ shellOrigin: SHELL_DEV_ORIGIN, development: true }))
  })

  it('is never built, so it cannot be deployed by accident', () => {
    expect(() => resolve({ command: 'build', mode: 'production' })).toThrow(/never built or deployed/)
  })

  it('is on the origin the shell’s development registry frames, and only there', () => {
    const entry = MODULES.development.find((module) => module.id === 'reference')!
    expect(entry.origin).toBe('http://localhost:5175')
    expect(entry.url).toBe('http://localhost:5175/')
    expect([...entry.roles].sort()).toEqual(['super_admin', 'vendor_reviewer'])
    expect(entry.audience).toBe('vendor-api')
    expect(MODULES.preview.concat(MODULES.production).some((module) => module.id === 'reference')).toBe(false)
  })
})
