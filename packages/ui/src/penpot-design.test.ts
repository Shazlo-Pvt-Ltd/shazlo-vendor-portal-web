import { describe, expect, it } from 'vitest'
import design from '../docs/penpot-design.json'
import { annotation, brand, fontFamily, link, reviewStatus, theme } from './index'

// This is a manually transcribed external design contract, not generated from tokens.ts.

describe('inspected Penpot design contract', () => {
  it('preserves the source palette, link shade and annotation-only raspberry', () => {
    expect(brand).toEqual(design.palette)
    expect(link.text).toBe(design.linkText)
    expect(annotation).toEqual(design.annotation)
    for (const state of Object.values(reviewStatus)) {
      expect(state.foreground).not.toBe(design.annotation.raspberry)
      expect(state.background).not.toBe(design.annotation.raspberry)
    }
  })

  it('maps primary actions, admin actions and pending badges to the specified roles', () => {
    expect(theme.palette.primary.main).toBe(design.roles.primaryAction.background)
    expect(theme.palette.primary.contrastText).toBe(design.roles.primaryAction.text)
    expect(theme.palette.secondary.main).toBe(design.roles.adminShell.background)
    expect(theme.palette.secondary.contrastText).toBe(design.roles.adminShell.text)
    expect(reviewStatus.pending).toEqual({ foreground: design.roles.pending.text, background: design.roles.pending.background })
  })

  it('uses the three specified families for their actual typography roles', () => {
    expect(fontFamily.display.split(',')[0]).toBe(`"${design.fonts.heading}"`)
    expect(fontFamily.body.split(',')[0]).toBe(`"${design.fonts.formalBody}"`)
    expect(fontFamily.informal.split(',')[0]).toBe(`"${design.fonts.informalBody}"`)
    for (const variant of ['display1', 'display2', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
      expect(theme.typography[variant].fontFamily).toBe(fontFamily.display)
    }
    expect(theme.typography.body1.fontFamily).toBe(fontFamily.body)
    expect(theme.typography.informal.fontFamily).toBe(fontFamily.informal)
  })
})
