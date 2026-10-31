import { describe, expect, it } from 'vitest'
import { contrastRatio } from './index'

describe('WCAG contrast arithmetic', () => {
  it.each([
    ['#FF0000', '#FFFFFF', 3.99847677],
    ['#00FF00', '#FFFFFF', 1.37219028],
    ['#0000FF', '#FFFFFF', 8.59247136],
    ['#0A0A0A', '#FFFFFF', 19.79814571],
    ['#0B0B0B', '#FFFFFF', 19.68262765],
  ])('matches independent reference contrast for %s on %s', (foreground, background, ratio) => {
    expect(contrastRatio(foreground, background)).toBeCloseTo(ratio, 6)
    expect(contrastRatio(background, foreground)).toBeCloseTo(ratio, 6)
  })

  it('parses hexadecimal letters case-insensitively', () => {
    expect(contrastRatio('#aAbBcC', '#FFFFFF')).toBe(contrastRatio('#AABBCC', '#ffffff'))
  })

  it.each(['#FFF', '#12345678', '123456', '#GGGGGG', ' #000000', '#000000 '])('rejects malformed colour %j in either position', (colour) => {
    expect(() => contrastRatio(colour, '#FFFFFF')).toThrow(/#RRGGBB/)
    expect(() => contrastRatio('#FFFFFF', colour)).toThrow(/#RRGGBB/)
  })
})
