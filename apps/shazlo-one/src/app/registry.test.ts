import { parseManifest, parseRegistry, type RegistryMode } from '@shazlo/shell-protocol'
import { Box, Inbox } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { catalogue } from '../test/modules'
import { isOnLink, moduleFor, registry, resolveModule } from './registry'

// The committed registry files, as the build reads them (vite.config.ts).
const files = import.meta.glob<unknown>('../../registry/*.json', { import: 'default', eager: true })

describe('module registry files', () => {
  it('finds them', () => {
    expect(Object.keys(files).length).toBeGreaterThan(0)
  })

  it.each(Object.entries(files))('%s is a valid development registry', (_, raw) => {
    const mode: RegistryMode = 'development'
    expect(parseRegistry(raw, mode).length).toBeGreaterThan(0)
  })

  it('keeps localhost out of production: every committed file is for local use', () => {
    for (const raw of Object.values(files)) expect(() => parseRegistry(raw, 'production')).toThrow(/must be https outside development/)
  })
})

describe('resolveModule', () => {
  const entry = registry.find((m) => m.id === 'catalogue')!

  it('takes the title, icon and pages from the manifest', () => {
    const module = resolveModule(entry, catalogue.manifest)
    expect([module.title, module.icon, module.home.path]).toEqual(['Catalogue', module.icon, '/queue'])
    expect(module.links.map((l) => [l.label, l.path])).toEqual([
      ['Review queue', '/queue'],
      ['All sellers', '/sellers'],
      ['Publishing', '/publishing'],
    ])
    expect(module.links[0]!.icon).toBe(Inbox)
    // Trust stays with the registry.
    expect([module.origin, module.roles, module.audience]).toEqual([entry.origin, entry.roles, entry.audience])
  })

  it('falls back to the registry title, a box and no pages without a manifest', () => {
    const module = resolveModule(entry, null)
    expect([module.title, module.icon, module.home.path, module.links]).toEqual(['Catalogue', Box, '/', []])
  })

  it('draws an icon it does not know as a box', () => {
    const manifest = parseManifest({ ...catalogue.manifest, icon: 'rocket-ship' }, 'catalogue')
    expect(resolveModule(entry, manifest).icon).toBe(Box)
  })
})

describe('moduleFor and isOnLink', () => {
  const module = resolveModule(registry.find((m) => m.id === 'catalogue')!, catalogue.manifest)
  const queue = module.links[0]!

  it('finds the module of a path, and only on a whole segment', () => {
    expect(moduleFor('/catalogue')?.id).toBe('catalogue')
    expect(moduleFor('/catalogue/queue')?.id).toBe('catalogue')
    expect(moduleFor('/catalogues')).toBeUndefined()
    expect(moduleFor('/admins')).toBeUndefined()
  })

  it('marks a link current on its pages and the pages it lists in `also`', () => {
    expect(isOnLink('/catalogue/queue', module, queue)).toBe(true)
    expect(isOnLink('/catalogue/review/listing/l1', module, queue)).toBe(true)
    expect(isOnLink('/catalogue/queued', module, queue)).toBe(false)
    expect(isOnLink('/catalogue/sellers', module, queue)).toBe(false)
  })

  it('marks a link to the module root current only on the root', () => {
    const root = { path: '/', also: [] }
    expect(isOnLink('/catalogue', module, root)).toBe(true)
    expect(isOnLink('/catalogue/', module, root)).toBe(true)
    expect(isOnLink('/catalogue/queue', module, root)).toBe(false)
  })
})
