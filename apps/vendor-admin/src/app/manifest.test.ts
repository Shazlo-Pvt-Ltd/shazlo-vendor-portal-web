import { MANIFEST_PATH, parseManifest } from '@shazlo/shell-protocol'
import { matchRoutes } from 'react-router'
import { describe, expect, it } from 'vitest'
import manifestText from '../../public/shazlo-module.json?raw'
import { routes } from './routes'

// ADR 0011: Shazlo One draws this module's row and pages in its sidebar from this file, served at
// /shazlo-module.json. A manifest the shell cannot read leaves the module with no pages there, so it
// is checked here with the shell's own parser, and every page it names must be a page of the module.
const raw: unknown = JSON.parse(manifestText)
const manifest = parseManifest(raw, 'vendor-admin')

// The routes the module renders for a path, other than its "not found" page.
const pageFor = (path: string) => (matchRoutes(routes, path.split('?')[0]!) ?? []).filter((m) => m.route.path && m.route.path !== '*')

describe('shazlo-module.json', () => {
  it('is served where the shell looks for it', () => {
    expect(MANIFEST_PATH).toBe('/shazlo-module.json')
  })

  it('is a manifest the shell reads, for this module', () => {
    expect(manifest).not.toBeNull()
    expect(manifest).toMatchObject({ id: 'vendor-admin', title: 'Vendors', icon: 'store' })
    // Nothing dropped: every icon is one the shell knows.
    expect(manifest).toEqual(raw)
  })

  it('names only pages the module has', () => {
    const paths = [manifest!.home.path, ...manifest!.links.map((l) => l.path)]
    for (const path of paths) expect(pageFor(path), path).not.toHaveLength(0)
    expect(pageFor('/review/product/p1')).not.toHaveLength(0)
    expect(pageFor('/no-such-page')).toHaveLength(0)
  })

  it('opens on the vendor dashboard, which is not one of the listed pages', () => {
    expect(manifest!.home).toEqual({ label: 'Dashboard', path: '/dashboard', icon: 'layout-dashboard' })
    expect(manifest!.links.map((l) => l.path)).not.toContain('/dashboard')
  })

  it('lists the pages in sidebar order', () => {
    expect(manifest!.links.map((l) => [l.label, l.path])).toEqual([
      ['Review queue', '/queue'],
      ['All vendors', '/vendors'],
      ['Publishing', '/publishing'],
    ])
  })
})
