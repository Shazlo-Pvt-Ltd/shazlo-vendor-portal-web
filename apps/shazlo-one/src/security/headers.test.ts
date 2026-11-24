// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  HSTS,
  PLACEHOLDER_API_ORIGIN,
  contentSecurityPolicy,
  securityHeaders,
  vercelHeaders,
} from './headers'
import { MODULE_ORIGINS } from './moduleOrigins'

const shell = fileURLToPath(new URL('../../', import.meta.url))
const API = 'https://api.shazlo.test'

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name!, values] as [string, string[]]
    }),
  )
}

describe('the production Content-Security-Policy', () => {
  const policy = directives(contentSecurityPolicy({ apiOrigin: API, mode: 'production' }))

  it('allows scripts only from the app itself: no inline script, no eval', () => {
    expect(policy.get('default-src')).toEqual(["'self'"])
    expect(policy.get('script-src')).toEqual(["'self'"])
    expect(JSON.stringify([...policy])).not.toMatch(/unsafe-eval|wasm-unsafe-eval/)
    expect(policy.get('script-src')).not.toContain("'unsafe-inline'")
  })

  it('lets the page talk only to the identity API', () => {
    expect(policy.get('connect-src')).toEqual([API])
  })

  it('loads images, fonts and styles only from the shell itself', () => {
    expect(policy.get('img-src')).toEqual(["'self'"])
    expect(policy.get('font-src')).toEqual(["'self'"])
  })

  it('forbids framing, plugins, a new <base> and form posts elsewhere', () => {
    expect(policy.get('frame-ancestors')).toEqual(["'none'"])
    expect(policy.get('frame-src')).toEqual(["'none'"])
    expect(policy.get('object-src')).toEqual(["'none'"])
    expect(policy.get('base-uri')).toEqual(["'self'"])
    expect(policy.get('form-action')).toEqual(["'self'"])
  })

  it('upgrades insecure requests and allows no wildcard or data: source', () => {
    expect(policy.has('upgrade-insecure-requests')).toBe(true)
    const text = contentSecurityPolicy({ apiOrigin: API, mode: 'production' })
    expect(text).not.toMatch(/\*|data:|blob:|http:/)
  })
})

describe('frame-src', () => {
  const frameSrc = (moduleOrigins?: string[]) =>
    directives(contentSecurityPolicy({ apiOrigin: API, mode: 'production', moduleOrigins })).get('frame-src')

  it('is none while no module is registered', () => {
    expect(frameSrc()).toEqual(["'none'"])
    expect(frameSrc([])).toEqual(["'none'"])
  })

  it('is exactly the registered module origins, and nothing else', () => {
    expect(frameSrc(['https://vendor-admin.shazlo.test', 'https://other.shazlo.test'])).toEqual([
      'https://vendor-admin.shazlo.test',
      'https://other.shazlo.test',
    ])
  })

  it('never frames the shell itself, in any mode', () => {
    for (const mode of ['production', 'preview', 'development'] as const) {
      const policy = directives(contentSecurityPolicy({ apiOrigin: API, mode, moduleOrigins: ['https://m.test'] }))
      expect(policy.get('frame-ancestors')).toEqual(["'none'"])
    }
  })

  it('has registered origins that are plain origins: https, or http on localhost, no path or wildcard', () => {
    for (const origin of MODULE_ORIGINS) {
      const url = new URL(origin)
      expect(url.origin).toBe(origin)
      expect(url.protocol === 'https:' || url.hostname === 'localhost').toBe(true)
    }
  })
})

describe('the other headers', () => {
  const headers = securityHeaders({ apiOrigin: API, mode: 'production' })

  it('sets the referrer, content-type and permissions policies and HSTS', () => {
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Strict-Transport-Security']).toBe(HSTS)
    expect(HSTS).toMatch(/max-age=\d{8,}/)
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) {
      expect(headers['Permissions-Policy']).toContain(`${feature}=()`)
    }
  })

  it('leaves HSTS out of preview and development, which run over http', () => {
    expect(securityHeaders({ apiOrigin: API, mode: 'preview' })['Strict-Transport-Security']).toBeUndefined()
    expect(securityHeaders({ apiOrigin: API, mode: 'development' })['Strict-Transport-Security']).toBeUndefined()
  })

  it('keeps preview as strict as production, and relaxes only what dev needs', () => {
    const preview = directives(contentSecurityPolicy({ apiOrigin: API, mode: 'preview' }))
    expect(preview.get('script-src')).toEqual(["'self'"])
    const dev = directives(contentSecurityPolicy({ apiOrigin: API, mode: 'development' }))
    expect(dev.get('script-src')).toContain("'unsafe-inline'")
    expect(dev.get('connect-src')).toContain('ws://localhost:5173')
    expect(dev.get('frame-ancestors')).toEqual(["'none'"])
  })
})

describe('vercel.json', () => {
  const config = JSON.parse(readFileSync(join(shell, 'vercel.json'), 'utf8')) as {
    rewrites: unknown[]
    headers: unknown
  }

  it('carries exactly the production headers, for every path', () => {
    expect(config.headers).toEqual(vercelHeaders(PLACEHOLDER_API_ORIGIN, MODULE_ORIGINS))
  })

  it('still rewrites every path to the single page', () => {
    expect(config.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }])
  })
})

describe('the Vercel prebuild step', () => {
  function inTemporaryCopy(run: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'shell-headers-'))
    try {
      mkdirSync(join(dir, 'scripts'))
      mkdirSync(join(dir, 'src/security'), { recursive: true })
      cpSync(join(shell, 'scripts/write-vercel-headers.mjs'), join(dir, 'scripts/write-vercel-headers.mjs'))
      cpSync(join(shell, 'src/security/headers.ts'), join(dir, 'src/security/headers.ts'))
      cpSync(join(shell, 'src/security/moduleOrigins.ts'), join(dir, 'src/security/moduleOrigins.ts'))
      cpSync(join(shell, 'vercel.json'), join(dir, 'vercel.json'))
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
      run(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const run = (dir: string, env: Record<string, string>) =>
    spawnSync(process.execPath, [join(dir, 'scripts/write-vercel-headers.mjs')], {
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
    })

  it('does nothing outside Vercel', () => {
    inTemporaryCopy((dir) => {
      const before = readFileSync(join(dir, 'vercel.json'), 'utf8')
      expect(run(dir, { VITE_IDENTITY_API_URL: 'https://api.real.test' }).status).toBe(0)
      expect(readFileSync(join(dir, 'vercel.json'), 'utf8')).toBe(before)
    })
  })

  it('on Vercel, puts the real API origin in connect-src and nothing else changes', () => {
    inTemporaryCopy((dir) => {
      expect(run(dir, { VERCEL: '1', VITE_IDENTITY_API_URL: 'https://api.real.test' }).status).toBe(0)
      const written = JSON.parse(readFileSync(join(dir, 'vercel.json'), 'utf8')) as { headers: unknown; rewrites: unknown }
      expect(written.headers).toEqual(vercelHeaders('https://api.real.test', MODULE_ORIGINS))
      expect(JSON.stringify(written.headers)).not.toContain('identity.example.com')
    })
  })

  it.each(['', 'http://api.real.test', 'https://user:pw@api.real.test', 'https://api.real.test/v1', 'nonsense'])(
    'on Vercel, fails the build for VITE_IDENTITY_API_URL=%j',
    (value) => {
      inTemporaryCopy((dir) => {
        const result = run(dir, { VERCEL: '1', VITE_IDENTITY_API_URL: value })
        expect(result.status).toBe(1)
        expect(result.stderr).not.toContain('pw')
      })
    },
  )

  it('is wired as the build\'s prebuild step', () => {
    const scripts = (JSON.parse(readFileSync(join(shell, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts
    expect(scripts.prebuild).toBe('node scripts/write-vercel-headers.mjs')
  })
})
