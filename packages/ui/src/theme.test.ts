import { describe, expect, it } from 'vitest'
import { createShazloTheme, emphasis, fontFamily, theme } from './index'

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
    const css = String(baselineStyles(theme))
    expect(css).not.toContain('@font-face')
    expect(css).not.toContain('voyage')
  })

  it('themes the browser surfaces: selection, focus ring and bold text', () => {
    const css = String(baselineStyles(theme))
    expect(css).toContain('::selection { background: #FFEDA3')
    expect(css).toContain(':focus-visible { outline: 2px solid #103C64')
    // Ovo has one weight, so emphasis switches to Bodoni Moda's real semibold instead of a synthesised bold.
    expect(css).toMatch(/b, strong \{ font-family: "Bodoni Moda"[^}]*font-weight: 600/)
    // A stray fontWeight: 'bold' on Ovo text must not fake a bold.
    expect(theme.typography.fontWeightBold).toBe(400)
  })

  it('exports emphasis styles that pair Bodoni Moda with its real weights', () => {
    expect(emphasis.semibold).toEqual({ fontFamily: fontFamily.display, fontWeight: 600 })
    expect(emphasis.bold).toEqual({ fontFamily: fontFamily.display, fontWeight: 700 })
  })

  it('shows hierarchy with real weights: labels, buttons and table headings in Bodoni Moda semibold', () => {
    for (const variant of ['subtitle1', 'subtitle2', 'button', 'overline'] as const) {
      expect(theme.typography[variant].fontFamily, variant).toMatch(/^"Bodoni Moda"/)
      expect(theme.typography[variant].fontWeight, variant).toBe(600)
    }
    // Running text stays in Ovo at its only weight.
    expect(theme.typography.body1.fontFamily).toMatch(/^"Ovo"/)
    expect(theme.typography.body1.fontWeight).toBe(400)
    const head = theme.components?.MuiTableCell?.styleOverrides?.head as Record<string, unknown>
    expect(head.fontFamily).toMatch(/^"Bodoni Moda"/)
    expect(head.fontWeight).toBe(600)
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
