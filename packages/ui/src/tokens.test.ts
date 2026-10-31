import { describe, expect, it } from 'vitest'
import { brand, contrastRatio, link, neutral, reviewStatus, status, statusBackground, theme, voyageFontFaces } from './index'

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
  })

  it('rejects colours it cannot read', () => {
    expect(() => contrastRatio('gold', '#FFFFFF')).toThrow()
  })
})

describe('tokens meet WCAG AA', () => {
  it('body text on every surface', () => {
    for (const bg of [neutral.surface, neutral.canvas, neutral.muted]) {
      expect(contrastRatio(neutral.ink, bg)).toBeGreaterThanOrEqual(7)
      expect(contrastRatio(neutral.inkSecondary, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('wine on amber and off-white on navy, including contained button hover', () => {
    expect(contrastRatio(brand.wine, brand.amber)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(brand.wine, theme.palette.primary.dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(brand.offWhite, brand.navy)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(brand.offWhite, theme.palette.secondary.dark)).toBeGreaterThanOrEqual(4.5)
  })

  it('status text on surfaces and its corresponding fill', () => {
    for (const key of Object.keys(status) as (keyof typeof status)[]) {
      expect(contrastRatio(status[key], neutral.surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(status[key], statusBackground[key])).toBeGreaterThanOrEqual(4.5)
    }
    for (const state of Object.values(reviewStatus)) {
      expect(contrastRatio(state.foreground, state.background)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('uses the darker blue for links; the raw brand blue is not AA text', () => {
    for (const surface of [brand.offWhite, brand.cream, brand.canvas]) {
      expect(contrastRatio(link.text, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(brand.wine, surface)).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrastRatio(brand.blue, brand.offWhite)).toBeLessThan(4.5)
  })
})

describe('voyageFontFaces', () => {
  it('declares both weights and trims trailing slashes', () => {
    const css = voyageFontFaces({ baseUrl: '/fonts//', display: 'optional' })
    expect(css.match(/@font-face/g)).toHaveLength(2)
    expect(css).toContain("url('/fonts/voyage-regular.otf')")
    expect(css).toContain('font-weight: 700')
    expect(css).toContain('font-display: optional')
  })
})
