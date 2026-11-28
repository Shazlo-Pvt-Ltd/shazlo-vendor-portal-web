import { brand, neutral } from '@shazlo/ui'

// jsdom reports colours as rgb(); tokens are hex.
export function rgb(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

const style = (el: Element) => getComputedStyle(el)

// Bodoni Moda at a weight it really has: the emphasis the theme uses for labels and names.
export function isSemibold(el: Element): boolean {
  const s = style(el)
  return s.fontWeight === '600' && /Bodoni Moda/.test(s.fontFamily)
}

export function isBold(el: Element): boolean {
  const s = style(el)
  return s.fontWeight === '700' && /Bodoni Moda/.test(s.fontFamily)
}

// Supporting text: Ovo regular in the secondary (brown) ink.
export function isSecondary(el: Element): boolean {
  const s = style(el)
  return s.fontWeight !== '600' && s.fontWeight !== '700' && s.color === rgb(neutral.inkSecondary)
}

export const BROWN = rgb(brand.brown)
