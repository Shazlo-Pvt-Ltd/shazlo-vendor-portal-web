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

const app = fileURLToPath(new URL('../../', import.meta.url))
const API = 'https://identity.shazlo.test'
const MODULE = 'https://vendor-admin.shazlo.test'

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

  it('lets the page talk only to identity-api', () => {
    expect(policy.get('connect-src')).toEqual([API])
  })

  it('loads images and fonts only from the app itself', () => {
    expect(policy.get('img-src')).toEqual(["'self'"])
    expect(policy.get('font-src')).toEqual(["'self'"])
  })

  it('never lets anything frame the shell, in any mode and with modules registered', () => {
    for (const mode of ['production', 'preview', 'development'] as const) {
      const text = contentSecurityPolicy({ apiOrigin: API, mode, moduleOrigins: [MODULE] })
      expect(directives(text).get('frame-ancestors')).toEqual(["'none'"])
    }
  })

  it('is never framed, and allows no plugin, new <base> or form post elsewhere', () => {
    expect(policy.get('frame-ancestors')).toEqual(["'none'"])
    expect(policy.get('object-src')).toEqual(["'none'"])
    expect(policy.get('base-uri')).toEqual(["'self'"])
    expect(policy.get('form-action')).toEqual(["'self'"])
  })

  it('frames nothing while no module is registered', () => {
    expect(MODULE_ORIGINS).toEqual([])
    expect(policy.get('frame-src')).toEqual(["'none'"])
  })

  it('frames only the registered module origins, and nothing else gains them', () => {
    const text = contentSecurityPolicy({ apiOrigin: API, mode: 'production', moduleOrigins: [MODULE] })
    const withModule = directives(text)
    expect(withModule.get('frame-src')).toEqual([MODULE])
    expect(withModule.get('connect-src')).toEqual([API])
    expect(withModule.get('frame-ancestors')).toEqual(["'none'"])
    // Counted by splitting on the literal text: no regular expression to escape.
    expect(text.split(MODULE).length - 1).toBe(1)
  })

  it('upgrades insecure requests and allows no wildcard, data: or blob: source', () => {
    expect(policy.has('upgrade-insecure-requests')).toBe(true)
    expect(contentSecurityPolicy({ apiOrigin: API, mode: 'production' })).not.toMatch(/\*|data:|blob:|http:/)
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
  const config = JSON.parse(readFileSync(join(app, 'vercel.json'), 'utf8')) as {
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
      cpSync(join(app, 'scripts/write-vercel-headers.mjs'), join(dir, 'scripts/write-vercel-headers.mjs'))
      cpSync(join(app, 'src/security/headers.ts'), join(dir, 'src/security/headers.ts'))
      cpSync(join(app, 'src/security/moduleOrigins.ts'), join(dir, 'src/security/moduleOrigins.ts'))
      cpSync(join(app, 'vercel.json'), join(dir, 'vercel.json'))
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
      expect(run(dir, { VITE_IDENTITY_API_URL: 'https://identity.real.test' }).status).toBe(0)
      expect(readFileSync(join(dir, 'vercel.json'), 'utf8')).toBe(before)
    })
  })

  it('on Vercel, puts the real API origin in connect-src and nothing else changes', () => {
    inTemporaryCopy((dir) => {
      expect(run(dir, { VERCEL: '1', VITE_IDENTITY_API_URL: 'https://identity.real.test' }).status).toBe(0)
      const written = JSON.parse(readFileSync(join(dir, 'vercel.json'), 'utf8')) as {
        headers: unknown
        rewrites: unknown
      }
      expect(written.headers).toEqual(vercelHeaders('https://identity.real.test', MODULE_ORIGINS))
      expect(JSON.stringify(written.headers)).not.toContain('identity.example.com')
    })
  })

  it.each(['', 'http://identity.real.test', 'https://user:pw@identity.real.test', 'https://identity.real.test/v1', 'nonsense'])(
    'on Vercel, fails the build for VITE_IDENTITY_API_URL=%j',
    (value) => {
      inTemporaryCopy((dir) => {
        const result = run(dir, { VERCEL: '1', VITE_IDENTITY_API_URL: value })
        expect(result.status).toBe(1)
        expect(result.stderr).not.toContain('pw')
      })
    },
  )

  it("is wired as the build's prebuild step", () => {
    const scripts = (JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as { scripts: Record<string, string> })
      .scripts
    expect(scripts.prebuild).toBe('node scripts/write-vercel-headers.mjs')
  })
})
