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
import { MODULES, ENVIRONMENTS, modulesFor, originsOf } from '../modules/registry'

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

  it('frames nothing while no module is registered in a deployed build', () => {
    expect(originsOf(MODULES.preview)).toEqual([])
    expect(originsOf(MODULES.production)).toEqual([])
    expect(policy.get('frame-src')).toEqual(["'none'"])
  })

  it('registers the reference module in development only, so it can never be framed by a deployed shell', () => {
    expect(originsOf(MODULES.development)).toEqual(['http://localhost:5175'])
    for (const environment of ENVIRONMENTS) {
      const ids = MODULES[environment].map((entry) => entry.id)
      expect(ids.includes('reference'), environment).toBe(environment === 'development')
    }
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
    expect(config.headers).toEqual(vercelHeaders(PLACEHOLDER_API_ORIGIN, originsOf(modulesFor('production'))))
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
      mkdirSync(join(dir, 'src/modules'), { recursive: true })
      cpSync(join(app, 'scripts/write-vercel-headers.mjs'), join(dir, 'scripts/write-vercel-headers.mjs'))
      cpSync(join(app, 'src/security/headers.ts'), join(dir, 'src/security/headers.ts'))
      cpSync(join(app, 'src/modules/registry.ts'), join(dir, 'src/modules/registry.ts'))
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
      expect(written.headers).toEqual(vercelHeaders('https://identity.real.test', originsOf(modulesFor('production'))))
      expect(JSON.stringify(written.headers)).not.toContain('identity.example.com')
    })
  })

  /** An entry for the production registry of a temporary copy, to see the script follow the registry. */
  const withProductionEntry = (dir: string, fields: Partial<Record<string, string>> = {}) => {
    const entry = {
      id: 'vendor-admin',
      title: 'Vendor admin',
      description: 'Review vendors.',
      url: 'https://vendor-admin.shazlo.test/',
      origin: 'https://vendor-admin.shazlo.test',
      roles: "['vendor_reviewer']",
      audience: 'vendor-api',
      supportedVersions: '[1]',
      ...fields,
    }
    const text = Object.entries(entry)
      .map(([key, value]) => (key === 'roles' || key === 'supportedVersions' ? `${key}: ${value}` : `${key}: ${JSON.stringify(value)}`))
      .join(', ')
    const file = join(dir, 'src/modules/registry.ts')
    const source = readFileSync(file, 'utf8')
    expect(source).toContain('  production: [],')
    writeFileSync(file, source.replace('  production: [],', `  production: [{ ${text} }],`))
  }

  it('on Vercel, frame-src follows the registry: add a module and its origin is allowed, nothing else', () => {
    inTemporaryCopy((dir) => {
      withProductionEntry(dir)
      expect(run(dir, { VERCEL: '1', VITE_IDENTITY_API_URL: 'https://identity.real.test' }).status).toBe(0)
      const written = JSON.parse(readFileSync(join(dir, 'vercel.json'), 'utf8')) as {
        headers: Array<{ headers: Array<{ key: string; value: string }> }>
      }
      const csp = written.headers[0]!.headers.find((header) => header.key === 'Content-Security-Policy')!.value
      expect(directives(csp).get('frame-src')).toEqual(['https://vendor-admin.shazlo.test'])
    })
  })

  it.each([
    ['a wildcard origin', { origin: 'https://*.shazlo.test', url: 'https://vendor-admin.shazlo.test/' }, /wildcard/],
    ['a non-https origin', { origin: 'http://vendor-admin.shazlo.test', url: 'http://vendor-admin.shazlo.test/' }, /https outside development/],
    ['a url on another origin', { url: 'https://evil.test/' }, /url is not on the module origin/],
    ['an empty role list', { roles: '[]' }, /roles is empty/],
  ])('on Vercel, fails the build for a registry with %s, saying what is wrong', (_name, fields, message) => {
    inTemporaryCopy((dir) => {
      withProductionEntry(dir, fields)
      const result = run(dir, { VERCEL: '1', VITE_IDENTITY_API_URL: 'https://identity.real.test' })
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(message)
      expect(result.stderr).toContain('vendor-admin')
    })
  })

  it('on a Vercel preview deploy, uses the preview registry, not production', () => {
    inTemporaryCopy((dir) => {
      withProductionEntry(dir)
      expect(run(dir, { VERCEL: '1', VERCEL_ENV: 'preview', VITE_IDENTITY_API_URL: 'https://identity.real.test' }).status).toBe(0)
      const written = JSON.parse(readFileSync(join(dir, 'vercel.json'), 'utf8')) as {
        headers: Array<{ headers: Array<{ key: string; value: string }> }>
      }
      const csp = written.headers[0]!.headers.find((header) => header.key === 'Content-Security-Policy')!.value
      expect(directives(csp).get('frame-src')).toEqual(["'none'"])
    })
  })

  it.each(['', 'http://identity.real.test', 'https://user:pw@identity.real.test', 'https://identity.real.test/v1', 'https://identity.real.test;sandbox', 'nonsense'])(
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
