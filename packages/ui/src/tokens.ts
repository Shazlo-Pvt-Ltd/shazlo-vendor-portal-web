// Design tokens shared by every Shazlo app.
// Palette and font roles: Penpot's Design language board, inspected 29 Oct 2026.
// See ../docs/penpot-design.md for source identity and implementation choices.

export const brand = {
  cream: '#FFEDA3',
  amber: '#FAB62A',
  brown: '#7A451E',
  blue: '#4281AA',
  navy: '#103C64',
  offWhite: '#FFFCE3',
  wine: '#620032',
  ink: '#17120E',
  canvas: '#FFF8E1',
} as const

// Raspberry belongs to design annotations, not application statuses or actions.
export const annotation = { raspberry: '#C2255C' } as const
export const link = { text: '#2E6A93' } as const

export const neutral = {
  ink: brand.ink,
  inkSecondary: brand.brown,
  inkTertiary: '#806F57',
  line: '#D9CAA8',
  lineStrong: '#A99572',
  surface: brand.offWhite,
  canvas: brand.canvas,
  muted: brand.cream,
  placeholder: '#F2E6C5',
} as const

// Text colours and supporting tints implement the board's status roles with AA contrast.
export const status = {
  success: link.text,
  warning: brand.brown,
  error: brand.wine,
  info: link.text,
} as const

export const statusBackground = {
  success: '#E5EFF5',
  warning: brand.cream,
  error: '#F6E5EC',
  info: '#E5EFF5',
} as const

// Product review states carry text/icon labels as well as colour (see the demo).
export const reviewStatus = {
  live: { foreground: link.text, background: statusBackground.success },
  pending: { foreground: brand.brown, background: brand.cream },
  sentBack: { foreground: brand.brown, background: '#FCE7D0' },
  suspended: { foreground: brand.wine, background: statusBackground.error },
} as const

export const fontFamily = {
  display: '"Bodoni Moda", Georgia, "Times New Roman", serif',
  body: '"Ovo", Georgia, "Times New Roman", serif',
  informal: '"Schoolbell", cursive',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const

export interface TypeStyle {
  family: keyof typeof fontFamily
  size: number
  lineHeight: number
  weight: 400 | 500 | 600 | 700
  letterSpacing: number
}

// Sizes are implementation choices retained from the original theme, not Penpot measurements.
// Ovo and Schoolbell ship a single regular weight; avoid synthetic bold for body text.
export const typeScale = {
  displayXl: { family: 'display', size: 64, lineHeight: 68, weight: 400, letterSpacing: -1 },
  displayL: { family: 'display', size: 40, lineHeight: 44, weight: 400, letterSpacing: -0.5 },
  h1: { family: 'display', size: 24, lineHeight: 32, weight: 600, letterSpacing: -0.4 },
  h2: { family: 'display', size: 18, lineHeight: 26, weight: 600, letterSpacing: -0.2 },
  h3: { family: 'display', size: 15, lineHeight: 22, weight: 600, letterSpacing: -0.1 },
  body: { family: 'body', size: 14, lineHeight: 20, weight: 400, letterSpacing: 0 },
  bodyStrong: { family: 'body', size: 14, lineHeight: 20, weight: 400, letterSpacing: 0 },
  small: { family: 'body', size: 13, lineHeight: 18, weight: 400, letterSpacing: 0 },
  smallStrong: { family: 'body', size: 13, lineHeight: 18, weight: 400, letterSpacing: 0 },
  caption: { family: 'body', size: 12, lineHeight: 16, weight: 400, letterSpacing: 0 },
  overline: { family: 'body', size: 11, lineHeight: 16, weight: 400, letterSpacing: 0.6 },
  stat: { family: 'display', size: 28, lineHeight: 34, weight: 600, letterSpacing: -0.6 },
  informal: { family: 'informal', size: 16, lineHeight: 24, weight: 400, letterSpacing: 0 },
  mono: { family: 'mono', size: 12, lineHeight: 16, weight: 400, letterSpacing: 0 },
} as const satisfies Record<string, TypeStyle>

// Retained geometry choices. MUI's theme.spacing(n) keeps its 8 px unit.
export const space = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const

export const radius = {
  control: 6,
  card: 8,
  sheet: 12,
  pill: 999,
} as const

export const shadow = {
  overlay: '0 4px 12px rgba(23, 18, 14, 0.18)',
} as const

export const tokens = { brand, annotation, link, neutral, status, statusBackground, reviewStatus, fontFamily, typeScale, space, radius, shadow } as const
