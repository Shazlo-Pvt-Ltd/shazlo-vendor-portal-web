import { describe, expect, it } from 'vitest'
import { modules } from './registry'

describe('module registry', () => {
  it('gives every module and every deep link its own icon', () => {
    for (const m of modules) {
      expect(m.icon).toBeTruthy()
      expect(m.links.length).toBeGreaterThan(0)
      for (const link of m.links) expect(link.icon, `${m.title} › ${link.label}`).toBeTruthy()
      const icons = [m.icon, ...m.links.map((l) => l.icon)]
      expect(new Set(icons).size).toBe(icons.length)
    }
  })

  it('lists the Vendors pages in sidebar order', () => {
    const vendors = modules.find((m) => m.id === 'vendor-admin')!
    expect(vendors.links.map((l) => [l.label, l.path])).toEqual([
      ['Review queue', '/queue'],
      ['All vendors', '/vendors'],
      ['Publishing', '/publishing'],
    ])
  })
})
