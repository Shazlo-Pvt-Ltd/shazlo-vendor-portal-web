import { describe, expect, it } from 'vitest'

type Package = { dependencies: Record<string, string>; devDependencies: Record<string, string>; scripts: Record<string, string> }
const [pkgText] = Object.values(import.meta.glob<string>('../../package.json', { query: '?raw', import: 'default', eager: true }))
const pkg = JSON.parse(pkgText!) as Package

// ADR 0011: Shazlo One knows no module's code. It reaches a module only through the registry, the
// module's manifest and its summary, so a module ships without a shell release. This fails on the
// ways the shell used to know the Vendors module: its API client and types, its routes, its pages
// and its mock.
//
// identity-api's own names may appear: the `vendor_reviewer` role and the `vendor-api` audience
// a token is exchanged for are identity data (roles, AUDIENCE_ROLES), not module code.

const sources = import.meta.glob<string>(['../**/*.{ts,tsx,json}', '!../**/noVendorCode.test.ts'], { query: '?raw', import: 'default', eager: true })

const FORBIDDEN: [RegExp, string][] = [
  [/mock-vendor-api/, 'the vendor-api mock'],
  [/from ['"][^'"]*vendor[^'"]*['"]/i, 'an import of vendor code or types'],
  [/\/v1\/admin\//, 'a vendor-api admin route'],
  [/vendorApi|VENDOR_API|__VENDOR/i, 'a vendor-api client or setting'],
  [/['"`]\/vendors\b/, 'a Vendors module page'],
  [/VendorCards|VendorSummary|vendor-summary/, 'the vendor Home cards'],
]

describe('Shazlo One knows no module code', () => {
  it('reads the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30)
  })

  it('has no file named for vendors', () => {
    expect(Object.keys(sources).filter((path) => /vendor/i.test(path))).toEqual([])
  })

  it('has no vendor client, route, page or mock in its sources', () => {
    const offenders = Object.entries(sources).flatMap(([path, text]) =>
      FORBIDDEN.flatMap(([pattern, what]) =>
        text
          .split('\n')
          .map((line, i) => [line, i + 1] as const)
          .filter(([line]) => pattern.test(line))
          .map(([, n]) => `${path}:${n}: ${what}`),
      ),
    )
    expect(offenders).toEqual([])
  })

  it('depends on no module package and generates no module types', () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(deps.filter((d) => /vendor/i.test(d))).toEqual([])
    expect(Object.values(pkg.scripts).filter((s) => /vendor-api/.test(s))).toEqual([])
  })
})
