import { describe, expect, it } from 'vitest'
import { createShazloTheme, theme, tokens } from '@shazlo/ui'

describe('vendor-portal', () => {
  it('uses the shared Shazlo theme', () => {
    expect(theme.palette.primary.main).toBe('#FAB62A')
    expect(theme.palette.secondary.main).toBe('#103C64')
  })

  it('gets the custom typography variants and tokens', () => {
    expect(theme.typography.display1.fontFamily).toMatch(/^"Bodoni Moda"/)
    expect(theme.typography.stat.fontSize).toBe('1.75rem')
    expect(tokens.radius.card).toBe(8)
  })

  it('can host Voyage itself', () => {
    const t = createShazloTheme({ voyage: { baseUrl: '/fonts' } })
    expect(String(t.components?.MuiCssBaseline?.styleOverrides)).toContain('/fonts/voyage-regular.otf')
  })
})
