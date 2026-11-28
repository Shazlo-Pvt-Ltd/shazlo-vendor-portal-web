import { describe, expect, it } from 'vitest'
import { demoPhotoPalette, garmentColour, multicolourSwatch } from './tokens'

describe('garment colours', () => {
  it('names each colour once, as a six-digit hex', () => {
    for (const hex of Object.values(garmentColour)) expect(hex).toMatch(/^#[0-9A-F]{6}$/)
    expect(new Set(Object.values(garmentColour)).size).toBe(Object.keys(garmentColour).length)
  })

  it('draws Multicolour from the named colours', () => {
    expect(multicolourSwatch).toBe('conic-gradient(#B3261E, #E07A2E, #EFC94C, #3E7B4F, #3466A8, #6A4C93, #B3261E)')
  })

  it('keeps every light demo ground among the grounds', () => {
    for (const ground of demoPhotoPalette.lightGrounds) expect(demoPhotoPalette.grounds).toContain(ground)
  })
})
