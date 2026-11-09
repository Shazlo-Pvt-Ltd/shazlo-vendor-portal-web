// Values measured from the Penpot "Kit / Components" board and the V-/A- screens
// (file "Shazlo", inspected 9 Nov 2026). These are the exact fills, strokes and text
// colours the wireframes use; tokens.ts keeps the brand palette they are built from.
import { brand, link } from './tokens'

export const kit = {
  canvas: brand.canvas, // page background (#FFF8E1)
  surface: '#FFFDF7', // cards, top bar, light sidebar, inputs
  line: '#EDE3CB', // card borders, dividers, the 1 px gaps between shell panes
  field: '#D9C9A3', // input, checkbox and secondary-button borders
  ink: brand.ink, // body text
  muted: '#5C4A3A', // secondary text
  subtle: '#7A6753', // captions, counts, timestamps
  placeholder: '#F3E5C0', // image placeholder fill
  chip: '#FDF1CF', // count chips, progress track, icon tiles
  error: '#A33A06', // field error border and helper text
  amber: brand.amber,
  amberEdge: '#D99A12', // primary button border
  amberHover: '#F0A915',
  wine: brand.wine,
  cream: brand.cream,
  brown: brand.brown,
  navy: brand.navy,
  navyHover: '#174A79',
  navText: '#B8C7D6', // inactive item text on the navy shell
  offWhite: brand.offWhite,
  link: link.text,
  focus: '#2E6A93',
} as const

export type BadgeTone = 'live' | 'approved' | 'pending' | 'sentBack' | 'rejected' | 'draft' | 'suspended' | 'publishing' | 'info' | 'failed'

// Status badge fills and text/glyph colours from the kit's Status badge component.
export const badgeTone: Record<BadgeTone, { background: string; foreground: string }> = {
  live: { background: '#E3EEF5', foreground: '#103C64' },
  approved: { background: '#E3EEF5', foreground: '#103C64' },
  info: { background: '#E3EEF5', foreground: '#103C64' },
  publishing: { background: '#E3EEF5', foreground: '#2B5E80' },
  pending: { background: '#FFEDA3', foreground: '#7A451E' },
  sentBack: { background: '#FDE5D2', foreground: '#8F3504' },
  rejected: { background: '#FDE5D2', foreground: '#8F3504' },
  failed: { background: '#FDE5D2', foreground: '#8F3504' },
  draft: { background: '#F1EADB', foreground: '#5C4A3A' },
  suspended: { background: '#F6DDE6', foreground: '#620032' },
}

export const kitFont = {
  display: '"Bodoni Moda", Georgia, "Times New Roman", serif',
  body: '"Ovo", Georgia, "Times New Roman", serif',
  informal: '"Schoolbell", cursive',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const

// Text styles used across the wireframes. Penpot line height is 1.2 for single lines;
// wrapped Ovo text sets 16 px lines at 13 px.
export const textStyle = {
  display: { fontFamily: kitFont.display, fontSize: 26, fontWeight: 600, letterSpacing: '-0.3px', lineHeight: 1.23 },
  heading: { fontFamily: kitFont.display, fontSize: 19, fontWeight: 600, letterSpacing: '-0.1px', lineHeight: 1.21 },
  title: { fontFamily: kitFont.display, fontSize: 16, fontWeight: 600, letterSpacing: 0, lineHeight: 1.25 },
  label: { fontFamily: kitFont.display, fontSize: 13, fontWeight: 600, letterSpacing: 0, lineHeight: 1.23 },
  button: { fontFamily: kitFont.display, fontSize: 14, fontWeight: 600, letterSpacing: 0, lineHeight: 1.2 },
  stat: { fontFamily: kitFont.display, fontSize: 30, fontWeight: 600, letterSpacing: '-0.4px', lineHeight: 1.2 },
  statSmall: { fontFamily: kitFont.display, fontSize: 19, fontWeight: 600, letterSpacing: '-0.1px', lineHeight: 1.2 },
  overline: { fontFamily: kitFont.display, fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', lineHeight: 1.27, textTransform: 'uppercase' as const },
  body: { fontFamily: kitFont.body, fontSize: 14, fontWeight: 400, letterSpacing: 0, lineHeight: 1.22 },
  small: { fontFamily: kitFont.body, fontSize: 13, fontWeight: 400, letterSpacing: 0, lineHeight: 1.23 },
  caption: { fontFamily: kitFont.body, fontSize: 12, fontWeight: 400, letterSpacing: '0.1px', lineHeight: 1.25 },
  mono: { fontFamily: kitFont.mono, fontSize: 12, fontWeight: 400, letterSpacing: 0, lineHeight: 1.25 },
  informal: { fontFamily: kitFont.informal, fontSize: 16, fontWeight: 400, letterSpacing: 0, lineHeight: 1.5 },
} as const

export type TextVariant = keyof typeof textStyle

export const textTone = {
  ink: kit.ink,
  muted: kit.muted,
  subtle: kit.subtle,
  link: kit.link,
  error: kit.error,
  wine: kit.wine,
  brown: kit.brown,
  inverse: kit.offWhite,
  navText: kit.navText,
  annotation: '#C2255C',
} as const

export type TextTone = keyof typeof textTone
