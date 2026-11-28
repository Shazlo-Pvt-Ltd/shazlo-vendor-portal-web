import { parseManifest, parseRegistry, type RegistryMode } from '@shazlo/shell-protocol'
import { Box, Inbox, LayoutDashboard } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { campaigns, catalogue } from '../test/modules'
import { currentLink, isModuleHome, isOnLink, moduleFor, modulePath, moduleTarget, registry, resolveModule } from './registry'

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

  it('takes the title, icon, home page and pages from the manifest', () => {
    const module = resolveModule(entry, catalogue.manifest)
    expect([module.title, module.home.label, module.home.path, module.home.icon]).toEqual(['Catalogue', 'Dashboard', '/dashboard', LayoutDashboard])
    expect(module.links.map((l) => [l.label, l.path])).toEqual([
      ['Review queue', '/queue'],
      ['All sellers', '/sellers'],
      ['Publishing', '/publishing'],
    ])
    expect(module.links[0]!.icon).toBe(Inbox)
    expect(module.links[0]!.also).toEqual(['/review'])
    // Trust stays with the registry.
    expect([module.origin, module.roles, module.audience]).toEqual([entry.origin, entry.roles, entry.audience])
  })

  it('gives the module, its home page and every page their own icon', () => {
    const module = resolveModule(entry, catalogue.manifest)
    const icons = [module.icon, module.home.icon, ...module.links.map((l) => l.icon)]
    expect(new Set(icons).size).toBe(icons.length)
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

describe('which module page is current', () => {
  const module = resolveModule(registry.find((m) => m.id === 'catalogue')!, catalogue.manifest)
  const current = (pathname: string) => currentLink(module, pathname)?.label ?? null

  it('finds the module path of a shell URL', () => {
    expect(modulePath(module, '/catalogue')).toBe('')
    expect(modulePath(module, '/catalogue/sellers/s_kalki')).toBe('/sellers/s_kalki')
    expect(modulePath(module, '/catalogueX')).toBeNull()
    expect(modulePath(module, '/')).toBeNull()
  })

  it('opens the bare base path on the module home, and any other URL on its own module path', () => {
    expect(moduleTarget(module, '/catalogue')).toBe('/dashboard')
    expect(moduleTarget(module, '/catalogue/')).toBe('/dashboard')
    expect(moduleTarget(module, '/catalogue/dashboard')).toBe('/dashboard')
    expect(moduleTarget(module, '/catalogue/sellers')).toBe('/sellers')
    expect(moduleTarget(module, '/catalogue/review/listing/l1')).toBe('/review/listing/l1')
    expect(moduleTarget(module, '/catalogueX')).toBeNull()
    expect(moduleTarget(module, '/')).toBeNull()
  })

  it('opens the module root while there is no manifest', () => {
    const bare = resolveModule(module.entry, null)
    expect(moduleTarget(bare, '/catalogue')).toBe('/')
    expect(isModuleHome(bare, '/catalogue')).toBe(true)
    expect(isModuleHome(bare, '/catalogue/queue')).toBe(false)
    expect(currentLink(bare, '/catalogue/queue')).toBeUndefined()
  })

  it('treats the bare base path and the home page as the module home', () => {
    for (const pathname of ['/catalogue', '/catalogue/', '/catalogue/dashboard']) {
      expect(isModuleHome(module, pathname), pathname).toBe(true)
      expect(current(pathname), pathname).toBeNull()
    }
    for (const pathname of ['/catalogue/sellers', '/catalogue/queue', '/catalogue/dashboardX', '/', '/admins']) expect(isModuleHome(module, pathname), pathname).toBe(false)
  })

  it('marks the page the URL is on, deeper pages included', () => {
    expect(current('/catalogue/queue')).toBe('Review queue')
    expect(current('/catalogue/review/listing/l1')).toBe('Review queue')
    expect(current('/catalogue/review/shop/s_kalki')).toBe('Review queue')
    expect(current('/catalogue/sellers')).toBe('All sellers')
    expect(current('/catalogue/sellers/s_kalki')).toBe('All sellers')
    expect(current('/catalogue/publishing')).toBe('Publishing')
  })

  it('does not match half a segment, or another module', () => {
    expect(current('/catalogue/sellersX')).toBeNull()
    expect(current('/catalogue/queued')).toBeNull()
    expect(current('/catalogue/reviews')).toBeNull()
    expect(current('/catalogueX/queue')).toBeNull()
    expect(current('/admins')).toBeNull()
  })

  it('marks the home page link when a module lists its home as one of its pages', () => {
    const drafts = resolveModule(registry.find((m) => m.id === 'campaigns')!, campaigns.manifest)
    expect(drafts.home.path).toBe('/drafts')
    expect(currentLink(drafts, '/campaigns')?.label).toBe('Drafts')
    expect(currentLink(drafts, '/campaigns/drafts')?.label).toBe('Drafts')
  })
})
