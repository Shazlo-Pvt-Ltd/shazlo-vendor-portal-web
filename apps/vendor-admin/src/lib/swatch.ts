import type * as M from '../api/model'

// vendor-api stores a colour's name only, so the screen decides what swatch it gets. These are the
// natural-dye names brands pick most; anything else gets a neutral swatch (the name is always shown
// beside it). "Multicolour" has no single colour and keeps the striped swatch.
const HEX: Record<string, string> = {
  indigo: '#2E3F6E',
  'madder red': '#8C2F25',
  rust: '#A4502B',
  ivory: '#EFE6D2',
  mustard: '#C99A2E',
  black: '#2B2522',
  olive: '#5C6B4E',
  'rani pink': '#B0306A',
  maroon: '#6B1F2A',
  white: '#FFFFFF',
  red: '#B3261E',
  pink: '#E58AA8',
  blue: '#2F5DA8',
  green: '#3E7D4A',
  yellow: '#E5C130',
  orange: '#D9742B',
  brown: '#6B4A32',
  grey: '#8A8680',
  gray: '#8A8680',
  beige: '#D9C3A0',
  cream: '#F3E9D2',
  navy: '#1F2A44',
  teal: '#2A7F7A',
  purple: '#6B3FA0',
}
const UNKNOWN_HEX = '#BDB6AB'

export function colourOf(name: string): M.Colour {
  const key = name.trim().toLowerCase()
  if (key === 'multicolour' || key === 'multicolor' || key === 'multi') return { name: name.trim(), hex: null }
  return { name: name.trim(), hex: HEX[key] ?? UNKNOWN_HEX }
}
