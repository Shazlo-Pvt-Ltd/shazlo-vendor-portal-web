import { describe, expect, it } from 'vitest'
import { createShazloTheme, theme } from './index'

const baselineStyles = (t: typeof theme) => t.components?.MuiCssBaseline?.styleOverrides

describe('theme', () => {
  it('uses amber/wine actions and navy/off-white secondary actions', () => {
    expect(theme.palette.primary.main).toBe('#FAB62A')
    expect(theme.palette.primary.contrastText).toBe('#620032')
    expect(theme.palette.secondary.main).toBe('#103C64')
    expect(theme.palette.secondary.contrastText).toBe('#FFFCE3')
  })

  it('uses Bodoni Moda headings, Ovo formal body and Schoolbell informal body', () => {
    expect(theme.typography.display1.fontFamily).toMatch(/^"Bodoni Moda"/)
    expect(theme.typography.display2.fontFamily).toMatch(/^"Bodoni Moda"/)
    expect(theme.typography.fontFamily).toMatch(/^"Ovo"/)
    expect(theme.typography.h1.fontFamily).toMatch(/^"Bodoni Moda"/)
    expect(theme.typography.informal.fontFamily).toMatch(/^"Schoolbell"/)
  })

  it('retains the implemented sizes and non-uppercase button labels', () => {
    expect(theme.typography.h1.fontSize).toBe('1.5rem')
    expect(theme.typography.h1.fontWeight).toBe(600)
    expect(theme.typography.body1.fontSize).toBe('0.875rem')
    expect(theme.typography.button.textTransform).toBe('none')
  })

  it('uses the shared surfaces and radius', () => {
    expect(theme.palette.background.default).toBe('#FFF8E1')
    expect(theme.palette.background.paper).toBe('#FFFCE3')
    expect(theme.palette.divider).toBe('#D9CAA8')
    expect(theme.shape.borderRadius).toBe(6)
  })

  it('does not declare Voyage font files unless asked to', () => {
    expect(baselineStyles(theme)).toBeUndefined()
  })

  it('adds @font-face rules when a Voyage URL is given', () => {
    const t = createShazloTheme({ voyage: { baseUrl: 'https://cdn.shazlo.store/fonts/' } })
    const css = String(baselineStyles(t))
    expect(css).toContain("url('https://cdn.shazlo.store/fonts/voyage-regular.otf')")
    expect(css).toContain("url('https://cdn.shazlo.store/fonts/voyage-bold.otf')")
    expect(css).toContain('font-display: swap')
  })

  it('merges overrides over the defaults', () => {
    const t = createShazloTheme({ overrides: { palette: { primary: { main: '#222222' } } } })
    expect(t.palette.primary.main).toBe('#222222')
    expect(t.palette.secondary.main).toBe('#103C64')
  })
})
