import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from '../security/headers'
import {
  ENVIRONMENTS,
  MODULES,
  RegistryError,
  SUPER_ADMIN,
  canOpen,
  environmentOf,
  modulesFor,
  originsOf,
  registryProblems,
  type ModuleEntry,
  type ModuleEnvironment,
} from './registry'
import { entry } from './testing'

const problems = (entries: ModuleEntry[], environment: ModuleEnvironment = 'production') => registryProblems(entries, environment)

describe('the committed registry', () => {
  it.each(ENVIRONMENTS)('is valid for %s', (environment) => {
    expect(registryProblems(MODULES[environment], environment)).toEqual([])
    expect(() => modulesFor(environment)).not.toThrow()
  })
})

describe('registry validation', () => {
  it('accepts a sound entry, and an empty registry', () => {
    expect(problems([entry()])).toEqual([])
    expect(problems([])).toEqual([])
  })

  it.each([
    ['a wildcard origin', 'https://*.shazlo.test'],
    ['a wildcard origin for the whole scheme', 'https://*'],
    ['a regular-expression origin', 'https://(vendor|other)\\.shazlo\\.test'],
    ['an origin with a pattern anchor', '^https://vendor-admin.shazlo.test$'],
  ])('refuses %s', (_name, origin) => {
    const found = problems([entry({ origin, url: 'https://vendor-admin.shazlo.test/' })])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/Module "vendor-admin" \(production\): origin must be one exact origin, not a wildcard or a pattern/)
  })

  it.each(['production', 'preview'] as const)('refuses a non-https origin in %s', (environment) => {
    const found = problems([entry({ origin: 'http://vendor-admin.shazlo.test', url: 'http://vendor-admin.shazlo.test/' })], environment)
    expect(found.join('\n')).toMatch(new RegExp(`must use https outside development \\(this is the ${environment} registry\\)`))
  })

  it('allows an http origin in development only', () => {
    const local = entry({ origin: 'http://localhost:5174', url: 'http://localhost:5174/' })
    expect(problems([local], 'development')).toEqual([])
    expect(problems([local], 'preview')).not.toEqual([])
  })

  it.each([
    ['another origin', 'https://evil.test/'],
    ['another port', 'https://vendor-admin.shazlo.test:8443/'],
    ['another scheme', 'http://vendor-admin.shazlo.test/'],
    ['a look-alike host', 'https://vendor-admin.shazlo.test.evil.test/'],
    ['a user name that hides the host', 'https://vendor-admin.shazlo.test@evil.test/'],
  ])('refuses a url on %s', (_name, url) => {
    expect(problems([entry({ url })]).join('\n')).toMatch(/url is not on the module origin/)
  })

  it('refuses a url that is not a URL', () => {
    expect(problems([entry({ url: 'not a url' })]).join('\n')).toMatch(/url is not a valid URL/)
  })

  it.each([
    ['a trailing slash', 'https://vendor-admin.shazlo.test/'],
    ['a path', 'https://vendor-admin.shazlo.test/app'],
    ['upper case', 'https://Vendor-Admin.shazlo.test'],
    ['a default port', 'https://vendor-admin.shazlo.test:443'],
    ['a user name', 'https://user@vendor-admin.shazlo.test'],
  ])('refuses an origin with %s (it must be exactly what the browser reports)', (_name, origin) => {
    expect(problems([entry({ origin })]).join('\n')).toMatch(/origin must be only the scheme, host and port/)
  })

  it.each([
    ['nothing', ''],
    ['a script URL', 'javascript:alert(1)'],
    ['not a URL', 'vendor-admin'],
    ['a file URL', 'file:///etc/passwd'],
  ])('refuses an origin that is %s', (_name, origin) => {
    expect(problems([entry({ origin })])).not.toEqual([])
  })

  it.each([
    ['a semicolon, which would end the frame-src directive', 'https://vendor-admin.shazlo.test;script-src'],
    ['a comma, which would start a second policy', 'https://vendor-admin.shazlo.test,x'],
    ['a quote, which would read as a CSP keyword', "https://vendor-admin.shazlo.test'x"],
  ])('refuses an origin whose host holds %s (the browser accepts it as an origin)', (_name, origin) => {
    expect(new URL(origin).origin).toBe(origin)
    const found = problems([entry({ origin, url: `${origin}/` })])
    expect(found.join('\n')).toMatch(/origin host may hold only letters, digits, dots and hyphens/)
  })

  it('still accepts an IPv4 address and a port', () => {
    expect(problems([entry({ origin: 'https://10.0.0.5:8443', url: 'https://10.0.0.5:8443/' })])).toEqual([])
  })

  it('refuses duplicate ids', () => {
    const found = problems([entry(), entry({ origin: 'https://other.shazlo.test', url: 'https://other.shazlo.test/' })])
    expect(found.join('\n')).toMatch(/id is used by another module/)
  })

  it('refuses duplicate origins', () => {
    const found = problems([entry(), entry({ id: 'second' })])
    expect(found.join('\n')).toMatch(/Module "second" \(production\): origin is used by another module/)
  })

  it('refuses an empty role list, and a role that is a wildcard or blank', () => {
    expect(problems([entry({ roles: [] })]).join('\n')).toMatch(/roles is empty/)
    expect(problems([entry({ roles: ['*'] })]).join('\n')).toMatch(/roles must be role names/)
    expect(problems([entry({ roles: [''] })]).join('\n')).toMatch(/roles must be role names/)
  })

  it('refuses ids that cannot be an address, a missing title, a missing audience and no protocol version', () => {
    expect(problems([entry({ id: 'Vendor Admin' })]).join('\n')).toMatch(/id must be lower-case/)
    expect(problems([entry({ id: '../admin' })]).join('\n')).toMatch(/id must be lower-case/)
    expect(problems([entry({ title: ' ' })]).join('\n')).toMatch(/title is missing/)
    expect(problems([entry({ audience: '' })]).join('\n')).toMatch(/audience is missing/)
    expect(problems([entry({ audience: 'identity-api' })]).join('\n')).toMatch(/never identity-api/)
    expect(problems([entry({ supportedVersions: [] })]).join('\n')).toMatch(/supportedVersions must list/)
    expect(problems([entry({ supportedVersions: [0, 1.5] })]).join('\n')).toMatch(/supportedVersions must list/)
  })

  it('reports every problem at once, each naming its module and environment', () => {
    const found = problems([entry({ roles: [] }), entry({ id: 'second', origin: 'https://*.x.test', url: 'https://x.test/' })], 'preview')
    expect(found).toHaveLength(2)
    expect(found.every((text) => text.includes('(preview)'))).toBe(true)
    expect(found.some((text) => text.startsWith('Module "vendor-admin"'))).toBe(true)
    expect(found.some((text) => text.startsWith('Module "second"'))).toBe(true)
  })

  it('throws a RegistryError that lists the problems, rather than return a bad registry', () => {
    const bad = { development: [], preview: [], production: [entry({ roles: [] })] }
    expect(() => modulesFor('production', bad)).toThrow(RegistryError)
    try {
      modulesFor('production', bad)
    } catch (error) {
      expect((error as RegistryError).problems).toHaveLength(1)
      expect((error as RegistryError).message).toContain('roles is empty')
    }
    expect(modulesFor('development', bad)).toEqual([])
  })
})

describe('which registry a build uses', () => {
  it.each([
    [{ dev: true }, 'development'],
    [{ dev: true, target: 'preview' }, 'development'],
    [{ dev: false, target: 'preview' }, 'preview'],
    [{ dev: false, target: 'production' }, 'production'],
    [{ dev: false }, 'production'],
    [{ dev: false, target: 'nonsense' }, 'production'],
  ] as const)('%j is %s', (options, expected) => {
    expect(environmentOf(options)).toBe(expected)
  })
})

describe('the Content-Security-Policy follows the registry', () => {
  const frameSrc = (entries: ModuleEntry[]) =>
    contentSecurityPolicy({ apiOrigin: 'https://identity.shazlo.test', mode: 'production', moduleOrigins: originsOf(entries) })
      .split('; ')
      .find((directive) => directive.startsWith('frame-src'))

  it('frames nothing for an empty registry', () => {
    expect(frameSrc([])).toBe("frame-src 'none'")
  })

  it('allows exactly the registered origins, each once, and nothing else', () => {
    const entries = [
      entry(),
      entry({ id: 'reference', origin: 'https://reference.shazlo.test', url: 'https://reference.shazlo.test/' }),
    ]
    expect(frameSrc(entries)).toBe('frame-src https://vendor-admin.shazlo.test https://reference.shazlo.test')
    expect(originsOf([...entries, entries[0]!])).toEqual(['https://vendor-admin.shazlo.test', 'https://reference.shazlo.test'])
  })

  it('grows by one entry and nothing else: adding a module is the only change', () => {
    const before = frameSrc([entry()])
    const after = frameSrc([entry(), entry({ id: 'third', origin: 'https://third.shazlo.test', url: 'https://third.shazlo.test/' })])
    expect(after).toBe(`${before} https://third.shazlo.test`)
  })
})

describe('who may open a module', () => {
  it('lets a role in its list open it', () => {
    expect(canOpen(entry(), ['vendor_reviewer'])).toBe(true)
  })

  it('lets a super admin open every module, whatever its roles say', () => {
    expect(canOpen(entry({ roles: ['someone_else'] }), [SUPER_ADMIN])).toBe(true)
  })

  it('refuses any other role, and an admin with none', () => {
    expect(canOpen(entry(), ['catalog_editor'])).toBe(false)
    expect(canOpen(entry(), [])).toBe(false)
  })
})
