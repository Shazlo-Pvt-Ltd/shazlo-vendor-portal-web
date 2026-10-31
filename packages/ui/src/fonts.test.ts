import { describe, expect, it } from 'vitest'
import { createShazloTheme, theme, voyageFontFaces } from './index'

describe('voyageFontFaces input checks', () => {
  it.each(['/', '/fonts', '/fonts/', 'https://cdn.shazlo.store/fonts', 'fonts'])('accepts %s', (baseUrl) => {
    expect(() => voyageFontFaces({ baseUrl })).not.toThrow()
  })

  it('rejects an empty base URL', () => {
    expect(() => voyageFontFaces({ baseUrl: '' })).toThrow(/baseUrl/)
    expect(() => voyageFontFaces({ baseUrl: '   ' })).toThrow(/baseUrl/)
  })

  // baseUrl is written into url('...'); these characters would end the string or the rule.
  it.each(["/fonts');x{}", '/fonts")', '/fon ts', '/fonts\n', '/fonts\\', '/fonts;'])('rejects %j', (baseUrl) => {
    expect(() => voyageFontFaces({ baseUrl })).toThrow(/baseUrl/)
  })

  it('fails early when the theme is given a bad URL', () => {
    expect(() => createShazloTheme({ voyage: { baseUrl: "x');" } })).toThrow(/baseUrl/)
  })

  it.each([
    ['/', ''],
    ['////', ''],
    ['/fonts', '/fonts'],
    ['https://cdn.shazlo.store/fonts///', 'https://cdn.shazlo.store/fonts'],
    ['/fonts//nested///', '/fonts//nested'],
  ])('normalizes only the trailing slashes in %s', (baseUrl, expectedBase) => {
    const css = voyageFontFaces({ baseUrl })
    expect(css).toContain(`url('${expectedBase}/voyage-regular.otf')`)
    expect(css).toContain(`url('${expectedBase}/voyage-bold.otf')`)
  })

  it('removes a long trailing slash run without changing the folder', () => {
    const css = voyageFontFaces({ baseUrl: `/fonts${'/'.repeat(100_000)}` })
    expect(css).toContain("url('/fonts/voyage-regular.otf')")
    expect(css).toContain("url('/fonts/voyage-bold.otf')")
  })

  it('preserves a long internal slash run followed by a non-slash character', () => {
    // This shape caused regex backtracking. CodeQL checks computational safety;
    // the unit assertion checks exact output without a machine-speed threshold.
    const baseUrl = `/${'/'.repeat(100_000)}x`
    const css = voyageFontFaces({ baseUrl })
    expect(css).toContain(`url('${baseUrl}/voyage-regular.otf')`)
    expect(css).toContain(`url('${baseUrl}/voyage-bold.otf')`)
  })
})

describe('createShazloTheme', () => {
  it('returns a new theme each time and never changes the default one', () => {
    const custom = createShazloTheme({ overrides: { palette: { primary: { main: '#222222' } } } })
    expect(custom).not.toBe(theme)
    expect(theme.palette.primary.main).toBe('#FAB62A')
    expect(createShazloTheme().palette.primary.main).toBe('#FAB62A')
  })
})
