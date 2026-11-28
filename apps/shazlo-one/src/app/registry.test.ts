import { describe, expect, it } from 'vitest'
import { currentLink, isModuleHome, moduleFor, modulePath, modules, moduleTarget } from './registry'

const vendors = modules.find((m) => m.id === 'vendor-admin')!

describe('module registry', () => {
  it('gives every module, its dashboard and every deep link its own icon', () => {
    for (const m of modules) {
      expect(m.icon).toBeTruthy()
      expect(m.home.icon, `${m.title} › ${m.home.label}`).toBeTruthy()
      expect(m.links.length).toBeGreaterThan(0)
      for (const link of m.links) expect(link.icon, `${m.title} › ${link.label}`).toBeTruthy()
      const icons = [m.icon, m.home.icon, ...m.links.map((l) => l.icon)]
      expect(new Set(icons).size).toBe(icons.length)
    }
  })

  it('lists the Vendors pages in sidebar order', () => {
    expect(vendors.links.map((l) => [l.label, l.path])).toEqual([
      ['Review queue', '/queue'],
      ['All vendors', '/vendors'],
      ['Publishing', '/publishing'],
    ])
  })

  it('opens Vendors on its dashboard', () => {
    expect(vendors.home).toMatchObject({ label: 'Dashboard', path: '/dashboard' })
  })
})

describe('which module page is current', () => {
  const current = (pathname: string) => currentLink(vendors, pathname)?.label ?? null

  it('finds the module of a shell URL, and its module path', () => {
    expect(moduleFor('/vendors')).toBe(vendors)
    expect(moduleFor('/vendors/queue')).toBe(vendors)
    expect(moduleFor('/vendorsX')).toBeUndefined()
    expect(moduleFor('/admins')).toBeUndefined()
    expect(modulePath(vendors, '/vendors')).toBe('')
    expect(modulePath(vendors, '/vendors/vendors/v_kalki')).toBe('/vendors/v_kalki')
    expect(modulePath(vendors, '/')).toBeNull()
  })

  it('opens the bare base path on the module home, and any other URL on its own module path', () => {
    expect(moduleTarget(vendors, '/vendors')).toBe('/dashboard')
    expect(moduleTarget(vendors, '/vendors/')).toBe('/dashboard')
    expect(moduleTarget(vendors, '/vendors/dashboard')).toBe('/dashboard')
    expect(moduleTarget(vendors, '/vendors/vendors')).toBe('/vendors')
    expect(moduleTarget(vendors, '/vendors/review/product/p_x')).toBe('/review/product/p_x')
    expect(moduleTarget(vendors, '/vendorsX')).toBeNull()
    expect(moduleTarget(vendors, '/')).toBeNull()
  })

  it('treats the bare base path and the dashboard as the module home', () => {
    for (const pathname of ['/vendors', '/vendors/', '/vendors/dashboard']) {
      expect(isModuleHome(vendors, pathname), pathname).toBe(true)
      expect(current(pathname), pathname).toBeNull()
    }
    for (const pathname of ['/vendors/vendors', '/vendors/queue', '/vendors/dashboardX', '/', '/admins']) expect(isModuleHome(vendors, pathname), pathname).toBe(false)
  })

  it('marks the page the URL is on, deeper pages included', () => {
    expect(current('/vendors/queue')).toBe('Review queue')
    expect(current('/vendors/review/product/p_x')).toBe('Review queue')
    expect(current('/vendors/review/brand/v_kalki')).toBe('Review queue')
    expect(current('/vendors/vendors')).toBe('All vendors')
    expect(current('/vendors/vendors/v_kalki')).toBe('All vendors')
    expect(current('/vendors/publishing')).toBe('Publishing')
  })

  it('does not confuse the base path with the All vendors page, or match half a segment', () => {
    expect(current('/vendors')).toBeNull()
    expect(current('/vendors/vendorsX')).toBeNull()
    expect(current('/vendors/queued')).toBeNull()
    expect(current('/vendors/reviews')).toBeNull()
    expect(current('/vendorsX/queue')).toBeNull()
    expect(current('/admins')).toBeNull()
  })
})
